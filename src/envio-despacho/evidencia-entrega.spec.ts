/**
 * D3 — evidencia de entrega.
 *
 * El reclamo "no me llegó" es la discusión más cara del reparto: el negocio
 * reenvía y pierde el margen, o discute y pierde al cliente. Lo que se prueba
 * aquí es que la foto quede guardada de verdad, con su hora, y que no se pueda
 * hacer desaparecer sin rastro — si cualquiera la borra, no prueba nada.
 */
import { ValidationPipe } from '@nestjs/common';
import { EvidenciaEntregaService } from './evidencia-entrega.service';
import { RegistrarEvidenciaDto } from './dto/evidencia-entrega.dto';

/**
 * Las MISMAS opciones que main.ts. Con un pipe "limpio" este archivo pasaba
 * en verde mientras la aplicación real hacía lo contrario: el
 * `enableImplicitConversion` convierte "false" en true antes de cualquier
 * transform, y el test no lo veía.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const comoLlegaDelFormulario = (body: Record<string, unknown>) =>
  pipe.transform(body, {
    type: 'body',
    metatype: RegistrarEvidenciaDto,
  }) as Promise<RegistrarEvidenciaDto>;

const foto = (nombre = 'entrega.jpg'): Express.Multer.File =>
  ({
    originalname: nombre,
    mimetype: 'image/jpeg',
    buffer: Buffer.from('bytes de la foto'),
    size: 16,
  }) as Express.Multer.File;

/** Prisma de mentira, con solo lo que toca este servicio. */
function prismaFalso(over: Record<string, unknown> = {}) {
  const creadas: Record<string, unknown>[] = [];
  const actualizadas: Record<string, unknown>[] = [];
  return {
    creadas,
    actualizadas,
    evidenciaEntrega: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: any) => {
        creadas.push(data);
        return { id: creadas.length, url: data.url };
      }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 7, anuladaEn: null }),
      update: jest.fn(async ({ data }: any) => {
        actualizadas.push(data);
        return {};
      }),
    },
    envioDespacho: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 10, estado: 'EN_CAMINO', repartidorId: 3 }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: any) => {
        actualizadas.push(data);
        return {};
      }),
    },
    ...over,
  } as any;
}

const s3Falso = (habilitado = true) =>
  ({
    isEnabled: () => habilitado,
    generateEvidenciaEntregaKey: (e: number, d: number) =>
      `entregas/empresa-${e}/despacho-${d}/evidencia-1.webp`,
    uploadImage: jest
      .fn()
      .mockResolvedValue('https://s3/entregas/evidencia-1.webp'),
  }) as any;

const despachosFalso = () => ({ update: jest.fn().mockResolvedValue({}) }) as any;

const USUARIO = { id: 5, nombre: 'ANA (ALMACÉN)', rol: 'USUARIO_EMPRESA' };
const ADMIN = { id: 1, nombre: 'DUEÑO', rol: 'ADMIN_EMPRESA' };

describe('"marcar entregado" llegando del formulario', () => {
  it('"false" en texto NO marca entregado', async () => {
    // Boolean('false') es true: la conversión ingenua marcaría entregados
    // justo los despachos que pidieron no marcarse.
    const dto = await comoLlegaDelFormulario({ marcarEntregado: 'false' });
    expect(dto.marcarEntregado).toBe(false);
  });

  it('"true" y "1" sí lo marcan', async () => {
    expect((await comoLlegaDelFormulario({ marcarEntregado: 'true' })).marcarEntregado).toBe(true);
    expect((await comoLlegaDelFormulario({ marcarEntregado: '1' })).marcarEntregado).toBe(true);
  });

  it('si no viene, queda sin definir y no se toca el estado', async () => {
    const dto = await comoLlegaDelFormulario({ nota: 'dejado con el portero' });
    expect(dto.marcarEntregado).toBeUndefined();
  });
});

describe('registrar la evidencia', () => {
  it('sube la foto y la guarda colgada del despacho', async () => {
    const prisma = prismaFalso();
    const s3 = s3Falso();
    const srv = new EvidenciaEntregaService(prisma, s3, despachosFalso());

    const r = await srv.registrar(99, 89, [foto()], {}, USUARIO);

    expect(r.registradas).toBe(1);
    expect(s3.uploadImage).toHaveBeenCalledTimes(1);
    expect(prisma.creadas[0]).toMatchObject({
      despachoId: 10,
      empresaId: 89,
      url: 'https://s3/entregas/evidencia-1.webp',
      usuarioNombre: 'ANA (ALMACÉN)',
      // Hereda el repartidor del despacho: ya se sabe quién fue.
      repartidorId: 3,
    });
  });

  it('sin almacenamiento configurado falla, en vez de decir que guardó', async () => {
    const prisma = prismaFalso();
    const srv = new EvidenciaEntregaService(
      prisma,
      s3Falso(false),
      despachosFalso(),
    );
    await expect(srv.registrar(99, 89, [foto()], {}, USUARIO)).rejects.toThrow(
      /no se puede guardar/i,
    );
    // Y no deja una fila que apunte a un archivo inexistente.
    expect(prisma.creadas).toHaveLength(0);
  });

  it('no acepta una entrega fechada en el futuro', async () => {
    const srv = new EvidenciaEntregaService(
      prismaFalso(),
      s3Falso(),
      despachosFalso(),
    );
    const manana = new Date(Date.now() + 86_400_000).toISOString();
    await expect(
      srv.registrar(99, 89, [foto()], { tomadaEn: manana }, USUARIO),
    ).rejects.toThrow(/futuro/i);
  });

  it('respeta la hora real de la entrega, no la de la subida', async () => {
    // El motorizado sube las fotos del día al volver: si se guardara la hora
    // de subida, la prueba contradiría al cliente por unas horas.
    const prisma = prismaFalso();
    const srv = new EvidenciaEntregaService(prisma, s3Falso(), despachosFalso());
    const entrega = new Date(Date.now() - 4 * 3600_000);

    await srv.registrar(
      99,
      89,
      [foto()],
      { tomadaEn: entrega.toISOString() },
      USUARIO,
    );
    expect((prisma.creadas[0].tomadaEn as Date).getTime()).toBe(
      entrega.getTime(),
    );
  });

  it('corta cuando la entrega ya acumuló el máximo de fotos', async () => {
    const prisma = prismaFalso();
    prisma.evidenciaEntrega.count.mockResolvedValue(6);
    const srv = new EvidenciaEntregaService(prisma, s3Falso(), despachosFalso());
    await expect(srv.registrar(99, 89, [foto()], {}, USUARIO)).rejects.toThrow(
      /máximo es 6/i,
    );
  });

  it('sin fotos adjuntas no hace nada', async () => {
    const srv = new EvidenciaEntregaService(
      prismaFalso(),
      s3Falso(),
      despachosFalso(),
    );
    await expect(srv.registrar(99, 89, [], {}, USUARIO)).rejects.toThrow(
      /ninguna foto/i,
    );
  });

  it('sin despacho creado avisa, en vez de crear evidencia huérfana', async () => {
    const prisma = prismaFalso();
    prisma.envioDespacho.findFirst.mockResolvedValue(null);
    const srv = new EvidenciaEntregaService(prisma, s3Falso(), despachosFalso());
    await expect(srv.registrar(99, 89, [foto()], {}, USUARIO)).rejects.toThrow(
      /no existe seguimiento/i,
    );
  });
});

describe('marcar entregado al subir la foto', () => {
  it('pasa por update() para que salga el aviso al cliente y se sincronice el pedido', async () => {
    const prisma = prismaFalso();
    const despachos = despachosFalso();
    const srv = new EvidenciaEntregaService(prisma, s3Falso(), despachos);

    await srv.registrar(99, 89, [foto()], { marcarEntregado: true }, USUARIO);

    expect(despachos.update).toHaveBeenCalledWith(
      99,
      89,
      { estado: 'ENTREGADO' },
      5,
    );
    // Y la hora de entrega queda sellada en el despacho.
    expect(prisma.actualizadas.some((d) => 'entregadoEn' in d)).toBe(true);
  });

  it('no vuelve a marcar uno que ya está entregado', async () => {
    const prisma = prismaFalso();
    prisma.envioDespacho.findFirst.mockResolvedValue({
      id: 10,
      estado: 'ENTREGADO',
      repartidorId: 3,
    });
    const despachos = despachosFalso();
    const srv = new EvidenciaEntregaService(prisma, s3Falso(), despachos);

    await srv.registrar(99, 89, [foto()], { marcarEntregado: true }, USUARIO);
    // Volver a avisarle al cliente que su pedido fue entregado es un mensaje
    // que no se puede deshacer.
    expect(despachos.update).not.toHaveBeenCalled();
  });

  it('subir una foto NO marca entregado por su cuenta', async () => {
    const despachos = despachosFalso();
    const srv = new EvidenciaEntregaService(
      prismaFalso(),
      s3Falso(),
      despachos,
    );
    // Puede estar documentando un intento fallido o una entrega parcial.
    await srv.registrar(99, 89, [foto()], {}, USUARIO);
    expect(despachos.update).not.toHaveBeenCalled();
  });
});

describe('anular una evidencia', () => {
  it('un usuario común no puede', async () => {
    const srv = new EvidenciaEntregaService(
      prismaFalso(),
      s3Falso(),
      despachosFalso(),
    );
    await expect(srv.anular(7, 89, USUARIO)).rejects.toThrow(
      /administrador/i,
    );
  });

  it('el administrador la anula, pero la fila queda con quién lo hizo', async () => {
    const prisma = prismaFalso();
    const srv = new EvidenciaEntregaService(prisma, s3Falso(), despachosFalso());

    await srv.anular(7, 89, ADMIN);

    const cambio = prisma.actualizadas[0];
    expect(cambio.anuladaEn).toBeInstanceOf(Date);
    expect(cambio.anuladaPor).toBe('DUEÑO');
    // Nunca un delete: el rastro de lo que se anuló es parte de la prueba.
    expect((prisma.evidenciaEntrega as any).delete).toBeUndefined();
  });

  it('una evidencia de otra empresa no existe', async () => {
    const prisma = prismaFalso();
    prisma.evidenciaEntrega.findFirst.mockResolvedValue(null);
    const srv = new EvidenciaEntregaService(prisma, s3Falso(), despachosFalso());
    await expect(srv.anular(7, 89, ADMIN)).rejects.toThrow(/no encontrada/i);
  });
});

describe('el hueco: entregas sin ninguna prueba', () => {
  it('pide solo las ENTREGADO sin evidencia vigente y suma el monto en juego', async () => {
    const prisma = prismaFalso();
    prisma.envioDespacho.findMany.mockResolvedValue([
      {
        id: 10,
        comprobanteId: 99,
        entregadoEn: new Date('2026-10-05T18:00:00.000Z'),
        creadoEn: new Date('2026-10-05T12:00:00.000Z'),
        transportista: 'PROPIOS',
        distrito: 'SJL',
        montoCOD: 139,
        repartidor: { nombre: 'GORENZA' },
        comprobante: {
          serie: 'NV01',
          correlativo: '8',
          mtoImpVenta: 139,
          cliente: { nombre: 'ROSA QUISPE', telefono: '999888777' },
        },
      },
      {
        id: 11,
        comprobanteId: 100,
        entregadoEn: null,
        creadoEn: new Date('2026-10-06T12:00:00.000Z'),
        transportista: 'SHALOM',
        distrito: null,
        montoCOD: 0,
        repartidor: null,
        comprobante: {
          serie: 'B001',
          correlativo: '21',
          mtoImpVenta: 61,
          cliente: { nombre: 'LUIS ROJAS', telefono: null },
        },
      },
    ]);
    const srv = new EvidenciaEntregaService(prisma, s3Falso(), despachosFalso());

    const r = await srv.entregasSinEvidencia(89, {});

    const filtro = prisma.envioDespacho.findMany.mock.calls[0][0].where;
    expect(filtro.estado).toBe('ENTREGADO');
    // "none con anuladaEn null": una evidencia anulada no tapa el hueco.
    expect(filtro.evidencias).toEqual({ none: { anuladaEn: null } });

    expect(r.total).toBe(2);
    expect(r.montoEnRiesgo).toBe(200);
    expect(r.entregas[0]).toMatchObject({
      comprobante: 'NV01-8',
      cliente: 'ROSA QUISPE',
      repartidor: 'GORENZA',
      contraentrega: true,
    });
    // Sin repartidor propio cae el transportista, y sin fecha de entrega
    // sellada se usa la de creación: la lista nunca sale con huecos.
    expect(r.entregas[1].repartidor).toBe('SHALOM');
    expect(r.entregas[1].entregadoEn).toEqual(
      new Date('2026-10-06T12:00:00.000Z'),
    );
    expect(r.entregas[1].contraentrega).toBe(false);
  });
});
