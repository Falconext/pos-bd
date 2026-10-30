import { EmpresaService } from './empresa.service';

const QPSE_DEMO = { external_id: 'x1', ruc: '20123456789', environment: 'demo', username: 'DEMOUSR', password: 'DEMOPWD' };

function armar(opciones: { qpseFalla?: boolean; empresa?: any } = {}) {
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(2),
    empresaSerie: { updateMany: jest.fn() },
    empresa: { update: jest.fn() },
  };
  const prisma: any = {
    empresa: {
      // Por RUC: no existe todavía. Por id: la empresa recién creada (o la del caso).
      findUnique: jest.fn(async ({ where }: any) =>
        where.ruc ? null : (opciones.empresa ?? { id: 7, ruc: '20123456789', usaDemo: true, tipoEmpresa: 'FORMAL', billingProvider: 'QPSE' }),
      ),
      update: jest.fn(),
    },
    usuario: { findUnique: jest.fn().mockResolvedValue(null) },
    plan: { findUnique: jest.fn().mockResolvedValue({ id: 3, nombre: 'CORPORATIVO', producto: 'facturacion', duracionDias: 30 }) },
    $queryRawUnsafe: jest.fn().mockResolvedValue([
      { hija: 'DetalleComprobante', columna: 'comprobanteId', padre: 'Comprobante', padreColumna: 'id', regla: 'RESTRICT' },
    ]),
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const qpse: any = {
    cuentaEmpresas: opciones.qpseFalla
      ? jest.fn().mockRejectedValue(new Error('QPSE: caído'))
      : jest.fn().mockResolvedValue([QPSE_DEMO]),
    cuentaCrearEmpresa: jest.fn(),
    cuentaPasarAProduccion: jest.fn(),
  };
  const service = new EmpresaService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, qpse);
  jest.spyOn(service, 'consultarRuc').mockResolvedValue({
    nombre_o_razon_social: 'ACME SAC',
    direccion_completa: 'AV. LIMA 123',
    ubigeo: ['15', '1501', '150101'],
    estado: 'ACTIVO',
  });
  const crear = jest.spyOn(service, 'crear').mockResolvedValue({ id: 7, usuarios: [{ id: 1 }] } as any);
  jest.spyOn(service, 'registrarLog').mockResolvedValue(undefined as any);
  return { service, prisma, qpse, crear, tx };
}

const DEMO = { ruc: '20123456789', email: 'Dueno@Acme.pe', celular: '999888777', rubroId: 2, planId: 3 };

describe('demo rápida', () => {
  it('crea en demo con los datos de SUNAT, contraseña generada y credenciales PSE de prueba', async () => {
    const { service, crear, prisma } = armar();
    const r = await service.crearDemoRapida(DEMO as any, 'krezka', 99);
    const enviado = crear.mock.calls[0][0] as any;
    expect(enviado).toMatchObject({ razonSocial: 'ACME SAC', ubigeo: '150101', usaDemo: true, planId: 3 });
    expect(enviado.usuario.email).toBe('dueno@acme.pe');
    expect(enviado.usuario.password).toBe(r.password);
    expect(r.password).toHaveLength(10);
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { usuarioPse: 'DEMOUSR', contrasenaPse: 'DEMOPWD' },
    });
    expect(r.pse.ok).toBe(true);
  });

  it('si el PSE falla la demo se crea igual y avisa', async () => {
    const { service } = armar({ qpseFalla: true });
    const r = await service.crearDemoRapida(DEMO as any, 'krezka', 99);
    expect(r.empresaId).toBe(7);
    expect(r.pse).toEqual({ ok: false, mensaje: expect.stringContaining('caído') });
  });
});

describe('pasar a producción', () => {
  const demo = { id: 7, ruc: '20123456789', usaDemo: true, producto: 'facturacion', billingProvider: 'QPSE' };

  it('sin confirmar no toca QPSE', async () => {
    const { service, qpse } = armar({ empresa: demo });
    await expect(service.pasarAProduccion(7, { planId: 3, confirmar: false } as any)).rejects.toThrow(/no se puede deshacer/);
    expect(qpse.cuentaPasarAProduccion).not.toHaveBeenCalled();
  });

  it('pasa en QPSE, borra las pruebas, reinicia correlativos y deja la empresa en vivo', async () => {
    const { service, qpse, tx } = armar({ empresa: demo });
    qpse.cuentaEmpresas
      .mockResolvedValueOnce([QPSE_DEMO])
      .mockResolvedValueOnce([{ ...QPSE_DEMO, environment: 'production', username: 'PRODUSR', password: 'PRODPWD' }]);
    await service.pasarAProduccion(7, { planId: 3, confirmar: true, borrarPruebas: true }, 99);
    expect(qpse.cuentaPasarAProduccion).toHaveBeenCalledWith('x1');
    const sqls = tx.$executeRawUnsafe.mock.calls.map((c: any[]) => c[0]);
    expect(sqls[0]).toMatch(/DELETE FROM "DetalleComprobante"/);
    expect(sqls.some((s: string) => /DELETE FROM "Comprobante" WHERE "empresaId" = \$1/.test(s))).toBe(true);
    expect(tx.empresaSerie.updateMany).toHaveBeenCalledWith({ where: { empresaId: 7 }, data: { correlativo: 1 } });
    expect(tx.empresa.update.mock.calls[0][0].data).toMatchObject({
      usaDemo: false,
      usuarioPse: 'PRODUSR',
      contrasenaPse: 'PRODPWD',
      planId: 3,
    });
  });

  it('sin borrar pruebas no ejecuta borrados', async () => {
    const { service, qpse, tx } = armar({ empresa: demo });
    qpse.cuentaEmpresas.mockResolvedValue([{ ...QPSE_DEMO, environment: 'production' }]);
    await service.pasarAProduccion(7, { planId: 3, confirmar: true }, 99);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(tx.empresaSerie.updateMany).not.toHaveBeenCalled();
    expect(qpse.cuentaPasarAProduccion).not.toHaveBeenCalled();
  });

  it('una empresa que ya está en producción no se toca', async () => {
    const { service, qpse } = armar({ empresa: { ...demo, usaDemo: false } });
    await expect(service.pasarAProduccion(7, { planId: 3, confirmar: true } as any)).rejects.toThrow(/ya está en producción/);
    expect(qpse.cuentaEmpresas).not.toHaveBeenCalled();
  });
});

describe('traer credenciales del PSE', () => {
  const empresa = (extra: any = {}) => ({ id: 7, ruc: '20123456789', usaDemo: true, tipoEmpresa: 'FORMAL', billingProvider: 'QPSE', ...extra });

  it('registra el RUC si falta y guarda las claves del ambiente de la empresa', async () => {
    const { service, qpse, prisma } = armar({ empresa: empresa() });
    qpse.cuentaEmpresas.mockResolvedValueOnce([]).mockResolvedValueOnce([QPSE_DEMO]);
    const r = await service.vincularPse(7);
    expect(qpse.cuentaCrearEmpresa).toHaveBeenCalledWith('20123456789');
    expect(prisma.empresa.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { usuarioPse: 'DEMOUSR', contrasenaPse: 'DEMOPWD' } });
    expect(r).toMatchObject({ ok: true, ambiente: 'demo', usuarioPse: 'DEMOUSR' });
  });

  it('empresa en producción con el RUC en prueba en QPSE: no guarda claves de prueba ni pasa nada a producción', async () => {
    const { service, qpse, prisma } = armar({ empresa: empresa({ usaDemo: false }) });
    const r = await service.vincularPse(7);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Pasar a producción/);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
    expect(qpse.cuentaPasarAProduccion).not.toHaveBeenCalled();
  });

  it('demo con el RUC ya en producción en QPSE: avisa y no toca', async () => {
    const { service, qpse, prisma } = armar({ empresa: empresa() });
    qpse.cuentaEmpresas.mockResolvedValue([{ ...QPSE_DEMO, environment: 'production' }]);
    const r = await service.vincularPse(7);
    expect(r).toMatchObject({ ok: false, ambiente: 'production' });
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('empresas informales o de otro proveedor no van al PSE', async () => {
    const informal = armar({ empresa: empresa({ tipoEmpresa: 'INFORMAL' }) });
    await expect(informal.service.vincularPse(7)).rejects.toThrow(/formales/);
    const jamble = armar({ empresa: empresa({ billingProvider: 'JAMBLE' }) });
    await expect(jamble.service.vincularPse(7)).rejects.toThrow(/QPSE/);
    expect(jamble.qpse.cuentaEmpresas).not.toHaveBeenCalled();
  });
});
