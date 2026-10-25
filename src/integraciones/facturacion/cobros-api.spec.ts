import { CobrosApiService, PREFIJO_COBRO_API } from './cobros-api.service';

/**
 * El cobro mensual de la API, del lado del integrador. Lo que no puede fallar:
 * dar por pagado algo que no se pagó entero, aplicar dos veces el mismo pago,
 * o dejar que un integrador vea o pague el cobro de otro.
 */
describe('CobrosApiService', () => {
  let prisma: any;
  let mp: any;
  let cobros: any;
  let svc: CobrosApiService;
  const cobro = (over: any = {}) => ({
    id: 11,
    empresaId: 1,
    periodo: '2026-10',
    concepto: 'API_FACTURACION',
    monto: 5.9,
    estado: 'PENDIENTE',
    descripcion: 'API de facturación 2026-10 — 30 comprobantes aceptados',
    fechaVencimiento: new Date('2026-11-17T12:00:00Z'),
    fechaCobro: null,
    medioPago: null,
    ...over,
  });
  const pago = (over: any = {}) => ({
    id: 987,
    status: 'approved',
    external_reference: `${PREFIJO_COBRO_API}11`,
    transaction_amount: 5.9,
    date_approved: '2026-11-03T15:00:00Z',
    ...over,
  });

  beforeEach(() => {
    prisma = {
      cobroEmpresa: { findUnique: jest.fn(async () => cobro()), findFirst: jest.fn(async () => cobro()), findMany: jest.fn(async () => [cobro()]) },
      usuario: { findFirst: jest.fn(async () => ({ email: 'dev@ejemplo.com' })) },
    };
    mp = {
      registrarReceptor: jest.fn(),
      plataformaConfigurada: jest.fn(() => true),
      crearCobroPlataforma: jest.fn(async () => ({ preferenceId: 'p1', initPoint: 'https://mp/pagar' })),
      pagosPlataforma: jest.fn(async () => [pago()]),
    };
    cobros = { registrarPago: jest.fn(async () => ({})) };
    svc = new CobrosApiService(prisma, mp, cobros);
  });

  it('se registra en el webhook de Mercado Pago con su prefijo', () => {
    svc.onModuleInit();
    expect(mp.registrarReceptor).toHaveBeenCalledWith(PREFIJO_COBRO_API, expect.any(Function));
  });

  it('un pago aprobado por el total salda el cobro', async () => {
    await svc.pagoRecibido(pago());
    expect(cobros.registrarPago).toHaveBeenCalledWith(11, expect.objectContaining({ medioPago: 'MERCADO_PAGO', referencia: '987', monto: 5.9 }));
  });

  it('un pago por menos de lo debido no lo da por pagado', async () => {
    await svc.pagoRecibido(pago({ transaction_amount: 3 }));
    expect(cobros.registrarPago).not.toHaveBeenCalled();
  });

  it('un pago no aprobado no hace nada', async () => {
    await svc.pagoRecibido(pago({ status: 'pending' }));
    expect(cobros.registrarPago).not.toHaveBeenCalled();
  });

  it('webhook y retorno a la vez: el segundo no rompe', async () => {
    cobros.registrarPago.mockRejectedValueOnce(new Error('Este cobro ya figura como pagado'));
    await expect(svc.pagoRecibido(pago())).resolves.toBeUndefined();
  });

  it('un cobro ya aplicado no se vuelve a aplicar', async () => {
    prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro({ estado: 'APLICADO' }));
    await svc.pagoRecibido(pago());
    expect(cobros.registrarPago).not.toHaveBeenCalled();
  });

  it('una mensualidad del ERP no se paga por este camino', async () => {
    prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro({ concepto: 'MENSUALIDAD' }));
    await svc.pagoRecibido(pago());
    expect(cobros.registrarPago).not.toHaveBeenCalled();
  });

  it('el link solo sale para un cobro propio y pendiente', async () => {
    const r = await svc.linkDePago(1, 11);
    expect(r.url).toBe('https://mp/pagar');
    expect(prisma.cobroEmpresa.findFirst).toHaveBeenCalledWith({ where: { id: 11, empresaId: 1, concepto: 'API_FACTURACION' } });
    expect(mp.crearCobroPlataforma).toHaveBeenCalledWith(expect.objectContaining({ referencia: `${PREFIJO_COBRO_API}11`, total: 5.9 }));

    prisma.cobroEmpresa.findFirst.mockResolvedValueOnce(null);
    await expect(svc.linkDePago(2, 11)).rejects.toMatchObject({ status: 404 });

    prisma.cobroEmpresa.findFirst.mockResolvedValueOnce(cobro({ estado: 'APLICADO' }));
    await expect(svc.linkDePago(1, 11)).rejects.toMatchObject({ status: 409 });
  });

  it('al volver del pago confirma sin esperar el webhook', async () => {
    prisma.cobroEmpresa.findFirst
      .mockResolvedValueOnce(cobro())
      .mockResolvedValueOnce(cobro({ estado: 'APLICADO' }));
    const r = await svc.verificar(1, 11, '987');
    expect(mp.pagosPlataforma).toHaveBeenCalledWith(`${PREFIJO_COBRO_API}11`, '987');
    expect(cobros.registrarPago).toHaveBeenCalled();
    expect(r.status).toBe('paid');
  });

  it('la lista dice si está vencido y si se puede pagar en línea', async () => {
    const r = await svc.listar(1);
    expect(r.online_payment).toBe(true);
    expect(r.data[0]).toMatchObject({ id: 11, period: '2026-10', amount: 5.9, status: 'pending' });
    expect(typeof r.data[0].overdue).toBe('boolean');
  });
});
