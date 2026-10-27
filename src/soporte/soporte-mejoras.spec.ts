/**
 * Mejoras del chat de soporte: doble check real, documentos, respuesta fuera
 * de horario y ficha de la empresa para el equipo.
 */
import { BadRequestException } from '@nestjs/common';
import { SoporteService } from './soporte.service';
import { AUTOR_AUTOMATICO, proximaAtencion, textoFueraDeHorario } from './soporte-aviso';

const lima = (iso: string) => new Date(`${iso}-05:00`);

function armar(extra: { automaticoReciente?: boolean } = {}) {
  const creados: any[] = [];
  const eventos: { usuarios: number[]; evento: string; payload: any }[] = [];
  const prisma: any = {
    soporteConversacion: {
      findUnique: jest.fn(async () => ({ id: 7, empresaId: 5, estado: 'ABIERTA', noLeidosEmpresa: 1, empresa: { brand: 'krezka', razonSocial: 'Bodega Ana SAC', nombreComercial: null } })),
      update: jest.fn(async () => ({ id: 7, noLeidosSistema: 1 })),
    },
    soporteMensaje: {
      create: jest.fn(async ({ data }: any) => {
        creados.push(data);
        return { id: 100 + creados.length, ...data };
      }),
      findFirst: jest.fn(async () => (extra.automaticoReciente ? { id: 1 } : null)),
      findMany: jest.fn(async (q: any) => (q?.distinct ? [{ autorNombre: 'Ana' }] : [])),
    },
    usuario: {
      findUnique: jest.fn(async () => ({ nombre: 'Ana' })),
      findMany: jest.fn(async (q: any) =>
        q?.where?.rol === 'ADMIN_SISTEMA' ? [{ id: 900 }] : q?.select?.email ? [{ nombre: 'Ana', email: 'a@b.pe', celular: '999' }] : [{ id: 1 }],
      ),
    },
    empresa: {
      findUnique: jest.fn(async () => ({
        brand: 'krezka',
        ruc: '20123456789',
        razonSocial: 'Bodega Ana SAC',
        nombreComercial: 'Bodega Ana',
        estado: 'ACTIVO',
        fechaExpiracion: new Date('2026-12-01'),
        plan: { nombre: 'NEGOCIO' },
        rubro: { nombre: 'Bodega' },
      })),
    },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  };
  const notificaciones: any = {
    emitirEventoAUsuarios: jest.fn((usuarios: number[], evento: string, payload: any) => eventos.push({ usuarios, evento, payload })),
  };
  const s3 = { uploadPDF: jest.fn(async (_b: Buffer, key: string, _t?: string) => `https://s3/${key}`) };
  const servicio = new SoporteService(prisma, notificaciones, { responder: async () => null } as any, undefined, s3 as any);
  return { servicio, prisma, creados, eventos, s3 };
}

afterEach(() => jest.useRealTimers());

describe('doble check real', () => {
  it('cuando el empresario abre el chat, Krezka recibe "soporte-leido" con la hora', async () => {
    const { servicio, prisma, eventos } = armar();
    await servicio.listarMensajes(5);
    expect(prisma.soporteConversacion.update.mock.calls[0][0].data).toMatchObject({ noLeidosEmpresa: 0 });
    expect(prisma.soporteConversacion.update.mock.calls[0][0].data.leidoPorEmpresaEn).toBeInstanceOf(Date);
    const ev = eventos.find((e) => e.evento === 'soporte-leido')!;
    expect(ev.usuarios).toEqual([900]);
    expect(ev.payload).toMatchObject({ conversacionId: 7, lado: 'EMPRESA' });
  });

  it('cuando Krezka abre la consulta, el empresario lo sabe y ve la ficha', async () => {
    const { servicio, eventos } = armar();
    const r: any = await servicio.obtenerConversacionSistema(7, null);
    expect(eventos.find((e) => e.evento === 'soporte-leido')!.payload.lado).toBe('SISTEMA');
    expect(r.ficha).toMatchObject({ ruc: '20123456789', plan: 'NEGOCIO', escribieron: ['Ana'] });
    expect(r.ficha.administradores[0]).toMatchObject({ email: 'a@b.pe' });
  });
});

describe('documentos', () => {
  it('un PDF se sube con su nombre y queda como [Archivo]', async () => {
    const { servicio, creados, s3 } = armar();
    await servicio.enviarAdjuntoEmpresa(5, 1, 'archivo', {
      buffer: Buffer.from('%PDF'),
      mimetype: 'application/pdf',
      size: 4,
      originalname: 'Factura F001-23.pdf',
    });
    expect(s3.uploadPDF.mock.calls[0][1]).toMatch(/Factura-F001-23\.pdf$/);
    expect(creados[0]).toMatchObject({ contenido: '[Archivo] Factura F001-23.pdf', archivoNombre: 'Factura F001-23.pdf' });
  });

  it('un ejecutable se rechaza', async () => {
    const { servicio } = armar();
    await expect(
      servicio.enviarAdjuntoEmpresa(5, 1, 'archivo', { buffer: Buffer.from('MZ'), mimetype: 'application/octet-stream', size: 2, originalname: 'virus.exe' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('respuesta fuera de horario', () => {
  it('un domingo contesta sola, una vez, diciendo cuándo vuelven', async () => {
    jest.useFakeTimers({ now: lima('2026-11-01T11:00:00'), doNotFake: ['nextTick', 'setImmediate'] });
    const { servicio, creados } = armar();
    await servicio.enviarMensajeEmpresa(5, 1, 'No me deja emitir');
    const auto = creados.find((c) => c.autorNombre === AUTOR_AUTOMATICO);
    expect(auto).toMatchObject({ rol: 'SISTEMA' });
    // Domingo: el próximo turno es el lunes, o sea "mañana".
    expect(auto.contenido).toContain('Te respondemos mañana desde las 9:00 a. m.;');
    expect(auto.contenido).not.toContain('a. m..');
  });

  it('si ya contestó hace poco, no repite', async () => {
    jest.useFakeTimers({ now: lima('2026-11-01T11:00:00'), doNotFake: ['nextTick', 'setImmediate'] });
    const { servicio, creados } = armar({ automaticoReciente: true });
    await servicio.enviarMensajeEmpresa(5, 1, 'otra cosa');
    expect(creados.filter((c) => c.autorNombre === AUTOR_AUTOMATICO)).toHaveLength(0);
  });

  it('en horario no contesta nada automático', async () => {
    jest.useFakeTimers({ now: lima('2026-10-27T11:00:00'), doNotFake: ['nextTick', 'setImmediate'] });
    const { servicio, creados } = armar();
    await servicio.enviarMensajeEmpresa(5, 1, 'hola');
    expect(creados.filter((c) => c.autorNombre === AUTOR_AUTOMATICO)).toHaveLength(0);
  });

  it('el texto dice el próximo turno', () => {
    expect(proximaAtencion(lima('2026-10-27T20:00:00'))).toBe('mañana desde las 9:00 a. m.');
    expect(proximaAtencion(lima('2026-10-31T14:00:00'))).toBe('el lunes desde las 9:00 a. m.');
    expect(proximaAtencion(lima('2026-10-28T07:00:00'))).toBe('hoy desde las 9:00 a. m.');
    expect(textoFueraDeHorario(lima('2026-10-31T14:00:00'))).toContain('sábados de 9:00 a. m. a 1:00 p. m.');
  });
});
