/**
 * Fotos en el chat (Hierba Sana, 20-10).
 *
 * El cliente pidió ver lo que iba a recibir, el producto no tenía foto, y el
 * bot contestó dos veces "no contamos con una imagen registrada". El negocio
 * tampoco podía mandarla: desde el panel solo salía texto.
 *
 * Ahora el bot le pide la foto al negocio (una vez por producto) y el
 * vendedor la manda desde el chat del panel.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import sharp from 'sharp';
import { BadRequestException } from '@nestjs/common';
import { LeadsMessageProcessor } from './leads-message.processor';
import { LeadsService } from './leads.service';
import { HERRAMIENTA_ENVIAR_FOTO } from './leads-herramientas';

describe('el bot cuando el producto no tiene foto', () => {
  function armar(opts: { imagenUrl?: string | null; previos?: unknown[]; avisoFalla?: boolean } = {}) {
    const prisma = {
      producto: {
        findFirst: jest.fn().mockResolvedValue({
          descripcion: 'CANDIDA CLEANSE - PURE PEAK ( 60 CAPSULAS )',
          imagenUrl: opts.imagenUrl ?? null,
          precioUnitario: 60,
          moneda: 'PEN',
        }),
      },
      leadMensaje: { findMany: jest.fn().mockResolvedValue(opts.previos ?? []) },
    };
    const whatsapp = { enviarImagenUrl: jest.fn().mockResolvedValue({ success: true }) };
    const notificaciones = {
      notificarAdminsEmpresa: opts.avisoFalla
        ? jest.fn().mockRejectedValue(new Error('caído'))
        : jest.fn().mockResolvedValue({}),
    };
    const processor = new LeadsMessageProcessor(
      prisma as never,
      {} as never,
      {} as never,
      whatsapp as never,
      notificaciones as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const ejecutor = (processor as any).crearEjecutor(89, 500, '584245130712', new Set());
    return { ejecutor, notificaciones, whatsapp };
  }

  it('le pide la foto al negocio y le dice al modelo que la va a recibir', async () => {
    const { ejecutor, notificaciones, whatsapp } = armar();
    const r = await ejecutor(HERRAMIENTA_ENVIAR_FOTO, { productoId: 1180 });

    expect(whatsapp.enviarImagenUrl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ enviada: false, fotoPedidaAlEquipo: true });
    expect(r.motivo).toMatch(/le compartimos la foto por aquí/);
    expect(r.motivo).toMatch(/No digas que el sistema no tiene la imagen/);
    const aviso = notificaciones.notificarAdminsEmpresa.mock.calls[0][0];
    expect(aviso).toMatchObject({ empresaId: 89, tipo: 'WARNING' });
    expect(aviso.titulo).toContain('CANDIDA CLEANSE');
    expect(aviso.mensaje).toContain('584245130712');
  });

  it('si el cliente la vuelve a pedir, no avisa otra vez', async () => {
    const { ejecutor, notificaciones } = armar({
      previos: [
        {
          herramientasJson: [
            {
              nombre: HERRAMIENTA_ENVIAR_FOTO,
              argumentos: { productoId: 1180 },
              resultado: { enviada: false, fotoPedidaAlEquipo: true },
            },
          ],
        },
      ],
    });
    const r = await ejecutor(HERRAMIENTA_ENVIAR_FOTO, { productoId: 1180 });
    expect(r.fotoPedidaAlEquipo).toBe(true);
    expect(notificaciones.notificarAdminsEmpresa).not.toHaveBeenCalled();
  });

  it('si no se pudo avisar, el bot no promete la foto', async () => {
    const { ejecutor } = armar({ avisoFalla: true });
    const r = await ejecutor(HERRAMIENTA_ENVIAR_FOTO, { productoId: 1180 });
    expect(r.fotoPedidaAlEquipo).toBeUndefined();
    expect(r.motivo).toMatch(/No le prometas una/);
  });

  it('con foto en el catálogo la manda como siempre', async () => {
    const { ejecutor, whatsapp, notificaciones } = armar({ imagenUrl: 'https://s3/candida.jpg' });
    const r = await ejecutor(HERRAMIENTA_ENVIAR_FOTO, { productoId: 1180 });
    expect(r).toEqual({ enviada: true });
    expect(whatsapp.enviarImagenUrl).toHaveBeenCalled();
    expect(notificaciones.notificarAdminsEmpresa).not.toHaveBeenCalled();
  });
});

describe('mandar una imagen desde el chat del panel', () => {
  async function png() {
    return sharp({
      create: { width: 40, height: 30, channels: 3, background: '#7c3aed' },
    })
      .png()
      .toBuffer();
  }

  function armar(opts: { envio?: { success: boolean; error?: string }; conv?: any } = {}) {
    const prisma: any = {
      leadConversacion: {
        findFirst: jest.fn().mockResolvedValue(
          opts.conv === undefined
            ? { id: 500, telefonoProspecto: '584245130712', botActivo: true, prospecto: { id: 9 } }
            : opts.conv,
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      leadMensaje: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      },
      leadProspecto: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    const whatsapp: any = {
      enviarImagenUrl: jest.fn().mockResolvedValue(opts.envio ?? { success: true }),
    };
    const s3: any = {
      uploadPDF: jest.fn((_b: Buffer, key: string) => Promise.resolve(`https://s3/${key}`)),
    };
    const service = new LeadsService(prisma, {} as any, {} as any, whatsapp, s3);
    return { service, prisma, whatsapp, s3 };
  }

  it('sube la imagen como JPG, la manda con su pie, la deja en el historial y toma el chat', async () => {
    const { service, prisma, whatsapp, s3 } = armar();
    const buffer = await png();
    const r = await service.enviarImagenManual(
      89,
      500,
      { buffer, mimetype: 'image/png', size: buffer.length },
      'Así viene el Candida Cleanse',
    );

    const [subido, key, tipo] = s3.uploadPDF.mock.calls[0];
    expect(key).toMatch(/^ia-ventas\/empresa-89\/chat\/500-\d+\.jpg$/);
    expect(tipo).toBe('image/jpeg');
    expect((await sharp(subido).metadata()).format).toBe('jpeg');

    expect(whatsapp.enviarImagenUrl).toHaveBeenCalledWith(
      '584245130712',
      expect.stringMatching(/\.jpg$/),
      'Así viene el Candida Cleanse',
      89,
    );
    expect(prisma.leadMensaje.create.mock.calls[0][0].data).toMatchObject({
      conversacionId: 500,
      rol: 'SISTEMA',
      contenido: '📷 [Imagen] Así viene el Candida Cleanse',
      imagenUrl: expect.stringMatching(/\.jpg$/),
    });
    expect(r.botPausado).toBe(true);
  });

  it('sin pie, el historial igual dice que se mandó una imagen', async () => {
    const { service, prisma, whatsapp } = armar();
    const buffer = await png();
    await service.enviarImagenManual(89, 500, { buffer, mimetype: 'image/png', size: buffer.length });
    expect(whatsapp.enviarImagenUrl.mock.calls[0][2]).toBeUndefined();
    expect(prisma.leadMensaje.create.mock.calls[0][0].data.contenido).toBe('📷 [Imagen]');
  });

  it('si WhatsApp no la acepta, no queda en el historial', async () => {
    const { service, prisma } = armar({ envio: { success: false, error: 'fuera de la ventana de 24 h' } });
    const buffer = await png();
    await expect(
      service.enviarImagenManual(89, 500, { buffer, mimetype: 'image/png', size: buffer.length }),
    ).rejects.toThrow('fuera de la ventana de 24 h');
    expect(prisma.leadMensaje.create).not.toHaveBeenCalled();
  });

  it('rechaza lo que no es imagen y lo que no se puede leer', async () => {
    const { service, whatsapp } = armar();
    await expect(
      service.enviarImagenManual(89, 500, { buffer: Buffer.from('%PDF'), mimetype: 'application/pdf', size: 4 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.enviarImagenManual(89, 500, { buffer: Buffer.from('basura'), mimetype: 'image/jpeg', size: 6 }),
    ).rejects.toThrow('No se pudo leer la imagen');
    expect(whatsapp.enviarImagenUrl).not.toHaveBeenCalled();
  });

  it('no manda a una conversación de otra empresa', async () => {
    const { service, whatsapp } = armar({ conv: null });
    const buffer = await png();
    await expect(
      service.enviarImagenManual(90, 500, { buffer, mimetype: 'image/png', size: buffer.length }),
    ).rejects.toThrow('Conversación no encontrada');
    expect(whatsapp.enviarImagenUrl).not.toHaveBeenCalled();
  });
});
