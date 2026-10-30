import { FinDePruebaService } from './fin-de-prueba.service';

/**
 * Quien paga al terminar la prueba gratis tiene que poder facturar de verdad
 * ese mismo día. Antes, elegir plan le apagaba el demo sin credenciales de
 * producción y sus boletas fallaban hasta que alguien lo pasara a mano.
 */

const RUC = '20123456789';

function armar(over: { usaDemo?: boolean; delRegistro?: boolean; qpse?: any; borrarFalla?: number[] } = {}) {
  const prisma = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({ id: 5, ruc: RUC, razonSocial: 'FERRETERIA LUCHO', usaDemo: over.usaDemo ?? true, brand: 'krezka' }),
      update: jest.fn(),
    },
    empresaSerie: { updateMany: jest.fn() },
    empresaLog: {
      findFirst: jest.fn().mockResolvedValue(over.delRegistro === false ? null : { id: 1 }),
      create: jest.fn(),
    },
    comprobante: {
      findMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(where.tipoDoc.in.includes('07') ? [{ id: 30 }] : [{ id: 21 }, { id: 20 }]),
      ),
    },
    usuario: {
      findFirst: jest.fn().mockResolvedValue({ nombre: 'Luis', email: 'luis@correo.pe' }),
      findMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(where.rol === 'ADMIN_EMPRESA' ? [{ id: 11 }] : [{ id: 1 }]),
      ),
    },
  };
  const notificaciones = { crearNotificacion: jest.fn() };
  const borrados: number[] = [];
  const comprobantes = {
    eliminarComprobante: jest.fn().mockImplementation(async (id: number) => {
      if (over.borrarFalla?.includes(id)) throw new Error('fk');
      borrados.push(id);
    }),
  };
  const qpse = over.qpse ?? {
    cuentaEmpresas: jest
      .fn()
      .mockResolvedValueOnce([{ ruc: RUC, environment: 'demo', external_id: 'ext-1', username: 'demo', password: 'demo' }])
      .mockResolvedValue([{ ruc: RUC, environment: 'production', external_id: 'ext-1', username: 'prod-u', password: 'prod-p' }]),
    cuentaPasarAProduccion: jest.fn().mockResolvedValue({}),
    cuentaCrearEmpresa: jest.fn(),
  };
  const service = new FinDePruebaService(prisma as any, notificaciones as any, comprobantes as any, qpse as any);
  return { prisma, notificaciones, comprobantes, borrados, qpse, service };
}

describe('fin de la prueba gratis al pagar', () => {
  it('borra las notas antes que sus boletas y facturas, y deja las notas de venta', async () => {
    const { prisma, borrados, service } = armar();
    const r = await service.pasarAProduccion(5);
    expect(borrados).toEqual([30, 21, 20]);
    const tipos = prisma.comprobante.findMany.mock.calls.map((c) => c[0].where.tipoDoc.in);
    expect(tipos).toEqual([['07', '08'], ['01', '03']]);
    expect(tipos.flat()).not.toContain('NV');
    expect(r).toMatchObject({ paso: true, comprobantesBorrados: 3, facturacionLista: true });
  });

  it('pasa el RUC a producción en QPSE y guarda las credenciales de producción', async () => {
    const { prisma, qpse, service, notificaciones } = armar();
    await service.pasarAProduccion(5);
    expect(qpse.cuentaPasarAProduccion).toHaveBeenCalledWith('ext-1');
    expect(prisma.empresa.update.mock.calls[0][0].data).toMatchObject({
      usaDemo: false,
      usuarioPse: 'prod-u',
      contrasenaPse: 'prod-p',
      apiEmisorEstado: 'pendiente',
    });
    expect(prisma.empresaLog.create.mock.calls[0][0].data.accion).toBe('QPSE_PRODUCCION');
    // Solo el cliente se entera; el equipo no tiene nada que hacer.
    expect(notificaciones.crearNotificacion).toHaveBeenCalledTimes(1);
    expect(notificaciones.crearNotificacion.mock.calls[0][0].titulo).toBe('Tu facturación real ya está activa');
  });

  it('si QPSE falla, sale de demo sin credenciales y el equipo recibe el aviso', async () => {
    const qpse = {
      cuentaEmpresas: jest.fn().mockResolvedValue([{ ruc: RUC, environment: 'demo', external_id: 'ext-1', username: 'demo', password: 'demo' }]),
      cuentaPasarAProduccion: jest.fn().mockRejectedValue(new Error('QPSE: servicio no disponible')),
      cuentaCrearEmpresa: jest.fn(),
    };
    const { prisma, service, notificaciones } = armar({ qpse });
    const r = await service.pasarAProduccion(5);
    expect(prisma.empresa.update.mock.calls[0][0].data).toEqual({ usaDemo: false, usuarioPse: null, contrasenaPse: null });
    expect(r).toMatchObject({ paso: true, facturacionLista: false });
    const titulos = notificaciones.crearNotificacion.mock.calls.map((c) => c[0].titulo);
    expect(titulos).toEqual(['Estamos activando tu facturación real', 'Pasar a producción a mano']);
  });

  it('un comprobante que no se puede borrar no detiene el resto', async () => {
    const { borrados, service } = armar({ borrarFalla: [21] });
    const r = await service.pasarAProduccion(5);
    expect(borrados).toEqual([30, 20]);
    expect(r).toMatchObject({ comprobantesBorrados: 2, noBorrados: 1 });
  });

  it('no hace nada si ya salió de demo (reintento del webhook) o si no nació en el autoregistro', async () => {
    const yaPaso = armar({ usaDemo: false });
    expect(await yaPaso.service.pasarAProduccion(5)).toEqual({ paso: false });
    expect(yaPaso.comprobantes.eliminarComprobante).not.toHaveBeenCalled();

    const demoDelEquipo = armar({ delRegistro: false });
    expect(await demoDelEquipo.service.pasarAProduccion(5)).toEqual({ paso: false });
    expect(demoDelEquipo.prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('reinicia los correlativos de boletas, facturas y notas solo si borró todo', async () => {
    const ok = armar();
    await ok.service.pasarAProduccion(5);
    expect(ok.prisma.empresaSerie.updateMany).toHaveBeenCalledWith({
      where: { empresaId: 5, tipoDoc: { in: ['07', '08', '01', '03'] } },
      data: { correlativo: 1 },
    });
    const parcial = armar({ borrarFalla: [21] });
    await parcial.service.pasarAProduccion(5);
    expect(parcial.prisma.empresaSerie.updateMany).not.toHaveBeenCalled();
  });
});
