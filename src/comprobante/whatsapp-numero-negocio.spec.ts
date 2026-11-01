/**
 * El PDF del comprobante sale por el número del negocio por QR (Evolution →
 * Takiy) antes que por Meta, y el "enviar al emitir" funciona también con
 * Evolution conectado (antes solo con Takiy activo).
 */
jest.mock('archiver', () => () => ({
  append: () => undefined,
  finalize: () => undefined,
  pipe: () => undefined,
}));

import { BadRequestException } from '@nestjs/common';
import { ComprobanteService } from './comprobante.service';

const stub = new Proxy({}, { get: () => async () => ({ id: 1 }) }) as any;

function armar(o: {
  disponible: boolean;
  envio?: any;
  empresa?: any;
  comp?: any;
}) {
  const whatsAppEnvio: any[] = [];
  const prisma = {
    empresa: {
      findUnique: jest.fn(async () => ({
        whatsappProvider: 'EMPRESA',
        whatsappApiToken: 'meta-token',
        whatsappPhoneNumberId: '123',
        whatsappActivo: true,
        ...(o.empresa ?? {}),
      })),
    },
    comprobante: {
      findUnique: jest.fn(async () => ({
        tipoDoc: 'BOLETA',
        estadoEnvioSunat: 'EMITIDO',
        empresaId: 1,
        cliente: { telefono: '987654321' },
        empresa: { takiyEnviarComprobante: true },
        ...(o.comp ?? {}),
      })),
    },
    whatsAppEnvio: {
      create: jest.fn(async ({ data }: any) => whatsAppEnvio.push(data)),
    },
  };
  const numeroNegocio = {
    disponible: jest.fn(async () => o.disponible),
    enviar: jest.fn(async () => o.envio ?? { success: true, via: 'EVOLUTION' }),
  };
  const svc = new ComprobanteService(
    prisma as any,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    numeroNegocio as any,
  ) as any;
  return { svc, prisma, numeroNegocio, whatsAppEnvio };
}

describe('credenciales de WhatsApp del comprobante', () => {
  it('con número por QR disponible → NUMERO_NEGOCIO (no Meta)', async () => {
    const { svc } = armar({ disponible: true });
    expect(await svc.getWhatsAppCredentials(1)).toEqual({
      source: 'NUMERO_NEGOCIO',
    });
  });

  it('sin número por QR → Meta como siempre', async () => {
    const { svc } = armar({ disponible: false });
    expect(await svc.getWhatsAppCredentials(1)).toMatchObject({
      source: 'EMPRESA',
      token: 'meta-token',
    });
  });

  it('sin el servicio inyectado → Meta', async () => {
    const { prisma } = armar({ disponible: true });
    const svc = new ComprobanteService(
      prisma as any,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
    ) as any;
    expect((await svc.getWhatsAppCredentials(1)).source).toBe('EMPRESA');
  });
});

describe('envío del PDF por el número del negocio', () => {
  function conComprobante(o: Parameters<typeof armar>[0]) {
    const a = armar(o);
    a.svc.cargarComprobanteCompleto = async () => ({
      empresaId: 1,
      tipoDoc: 'BOLETA',
      serie: 'B001',
      correlativo: 25,
      mtoImpVenta: 50,
      cliente: { nombre: 'Ana' },
      empresa: { razonSocial: 'BODEGA ANA SAC' },
    });
    a.svc.generarYSubirPdf = async () => 'https://s3/b001-25.pdf';
    return a;
  }

  it('manda el PDF como adjunto con nombre y registra el envío', async () => {
    const { svc, numeroNegocio, whatsAppEnvio } = conComprobante({
      disponible: true,
    });
    await svc.enviarWhatsAppComprobante(9, '987654321', {
      usuarioId: 3,
      empresaId: 1,
    });
    expect(numeroNegocio.enviar).toHaveBeenCalledWith(1, {
      numero: '51987654321',
      mensaje: expect.stringContaining('B001-00000025'),
      archivoUrl: 'https://s3/b001-25.pdf',
      nombreArchivo: 'BOLETA_B001-00000025.pdf',
    });
    expect(whatsAppEnvio[0]).toMatchObject({
      estado: 'ENVIADO',
      costoUSD: 0,
      numeroDestino: '51987654321',
    });
  });

  it('si falla: queda FALLIDO y el error dice dónde revisar según la vía', async () => {
    const { svc, whatsAppEnvio } = conComprobante({
      disponible: true,
      envio: {
        success: false,
        via: 'EVOLUTION',
        error: 'El WhatsApp del negocio no está conectado.',
      },
    });
    const e = await svc
      .enviarWhatsAppComprobante(9, '987654321', { usuarioId: 3, empresaId: 1 })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toMatch(/Configuración → WhatsApp/);
    expect(whatsAppEnvio[0].estado).toBe('FALLIDO');
  });
});

describe('enviar al emitir', () => {
  const esperar = () => new Promise((r) => setTimeout(r, 5));

  it('con Evolution conectado y la opción activa → manda', async () => {
    const { svc } = armar({ disponible: true });
    const spy = jest
      .spyOn(svc, 'enviarWhatsAppComprobante')
      .mockResolvedValue(undefined);
    svc.enviarComprobanteAutomatico(9, { id: 3, empresaId: 1 });
    await esperar();
    expect(spy).toHaveBeenCalledWith(
      9,
      '987654321',
      expect.objectContaining({ usuarioId: 3 }),
    );
  });

  it('sin número por QR → no manda (aunque la opción esté activa)', async () => {
    const { svc } = armar({ disponible: false });
    const spy = jest
      .spyOn(svc, 'enviarWhatsAppComprobante')
      .mockResolvedValue(undefined);
    svc.enviarComprobanteAutomatico(9, { id: 3, empresaId: 1 });
    await esperar();
    expect(spy).not.toHaveBeenCalled();
  });

  it('opción apagada → no manda ni consulta la conexión', async () => {
    const { svc, numeroNegocio } = armar({
      disponible: true,
      comp: { empresa: { takiyEnviarComprobante: false } },
    });
    const spy = jest
      .spyOn(svc, 'enviarWhatsAppComprobante')
      .mockResolvedValue(undefined);
    svc.enviarComprobanteAutomatico(9, { id: 3, empresaId: 1 });
    await esperar();
    expect(spy).not.toHaveBeenCalled();
    expect(numeroNegocio.disponible).not.toHaveBeenCalled();
  });
});
