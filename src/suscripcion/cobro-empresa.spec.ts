/**
 * El ciclo de cobro de los clientes directos.
 *
 * Lo que de verdad importa acá no es que se emita un cobro, sino las tres cosas
 * que pueden costarle plata o clientes a Falconext si se hacen mal:
 *
 *  1. No cobrar dos veces el mismo mes. El cron corre todos los días; si cada
 *     corrida emitiera una mensualidad, un cliente vería 30 deudas en un mes.
 *  2. No extender la suscripción de quien no pagó, ni perderle días a quien
 *     pagó tarde.
 *  3. No suspender a nadie antes de que se acabe la gracia.
 */
import { CobroEmpresaService } from './cobro-empresa.service';
import { evaluarGracia, finDeGracia } from '../common/utils/gracia-suscripcion';

const HOY = new Date('2026-10-15T12:00:00.000Z');

const notificaciones = { crearNotificacion: jest.fn().mockResolvedValue({}) };

const prismaBase = () => ({
  empresa: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  cobroEmpresa: {
    create: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  ingresoSistema: { create: jest.fn().mockResolvedValue({}) },
  usuario: { findMany: jest.fn().mockResolvedValue([{ id: 7 }]) },
  $transaction: jest.fn(),
});

const montar = (prisma: any) => {
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return new CobroEmpresaService(prisma, notificaciones as any);
};

beforeEach(() => jest.clearAllMocks());

describe('Emitir la mensualidad', () => {
  const EMPRESA = {
    id: 90,
    razonSocial: 'DISTRIBUCIONES VETERINARIAS IRBA S.A.C.',
    fechaExpiracion: new Date('2026-10-18T12:00:00.000Z'),
    plan: { nombre: 'CORPORATIVO', costo: 99.9 },
  };

  it('emite con anticipación al vencimiento y congela el plan y el monto', async () => {
    const prisma = prismaBase();
    prisma.empresa.findMany.mockResolvedValue([EMPRESA]);
    prisma.cobroEmpresa.create.mockResolvedValue({ id: 1 });

    const res = await montar(prisma).generarCobrosDelCiclo(HOY);

    expect(res.emitidos).toBe(1);
    const data = prisma.cobroEmpresa.create.mock.calls[0][0].data;
    expect(data.periodo).toBe('2026-10');
    expect(data.estado).toBe('PENDIENTE');
    expect(data.planNombre).toBe('CORPORATIVO');
    expect(Number(data.monto)).toBe(99.9);
    // Emitir no mueve la suscripción: solo registra lo que se debe.
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('si el mes ya fue emitido no cobra de nuevo', async () => {
    const prisma = prismaBase();
    prisma.empresa.findMany.mockResolvedValue([EMPRESA]);
    // El índice único [empresaId, periodo] es quien lo impide de verdad.
    prisma.cobroEmpresa.create.mockRejectedValue({ code: 'P2002' });

    const res = await montar(prisma).generarCobrosDelCiclo(HOY);

    expect(res.emitidos).toBe(0);
    expect(res.omitidos).toBe(1);
  });

  it('no le cobra a un plan de costo cero', async () => {
    const prisma = prismaBase();
    prisma.empresa.findMany.mockResolvedValue([
      { ...EMPRESA, plan: { nombre: 'DEMO', costo: 0 } },
    ]);

    const res = await montar(prisma).generarCobrosDelCiclo(HOY);

    expect(res.emitidos).toBe(0);
    expect(prisma.cobroEmpresa.create).not.toHaveBeenCalled();
  });

  it('deja fuera a los clientes de reseller y a las demos', async () => {
    const prisma = prismaBase();
    await montar(prisma).generarCobrosDelCiclo(HOY);
    const where = prisma.empresa.findMany.mock.calls[0][0].where;
    // Su ciclo vive en ResellerService.processMonthlyRenewals: cobrarlos acá
    // también les descontaría dos veces.
    expect(where.resellerId).toBeNull();
    expect(where.usaDemo).toBe(false);
  });
});

describe('Registrar el pago', () => {
  const cobro = (over: any = {}) => ({
    id: 5,
    empresaId: 90,
    periodo: '2026-10',
    planNombre: 'CORPORATIVO',
    monto: 99.9,
    estado: 'PENDIENTE',
    medioPago: null,
    referencia: null,
    empresa: {
      id: 90,
      razonSocial: 'IRBA',
      fechaExpiracion: new Date('2026-10-18T12:00:00.000Z'),
      estado: 'ACTIVO',
      planId: 27,
      plan: { nombre: 'CORPORATIVO', duracionDias: 30 },
    },
    ...over,
  });

  it('extiende desde el vencimiento, no desde hoy: pagar tarde no quita días', async () => {
    const prisma = prismaBase();
    // Venció el 13 y paga el 15, dentro de la gracia.
    prisma.cobroEmpresa.findUnique.mockResolvedValue(
      cobro({
        empresa: {
          ...cobro().empresa,
          fechaExpiracion: new Date('2026-10-13T12:00:00.000Z'),
        },
      }),
    );
    prisma.cobroEmpresa.update.mockImplementation(({ data }: any) =>
      Promise.resolve(data),
    );

    await montar(prisma).registrarPago(5, {
      medioPago: 'YAPE',
      fechaCobro: HOY,
    });

    const nuevaFecha =
      prisma.empresa.update.mock.calls[0][0].data.fechaExpiracion;
    expect(nuevaFecha.toISOString().slice(0, 10)).toBe('2026-11-12'); // 13/10 + 30
  });

  it('si la cuenta llevaba mucho suspendida, el periodo arranca hoy', async () => {
    const prisma = prismaBase();
    prisma.cobroEmpresa.findUnique.mockResolvedValue(
      cobro({
        empresa: {
          ...cobro().empresa,
          fechaExpiracion: new Date('2026-08-01T12:00:00.000Z'),
          estado: 'INACTIVO',
        },
      }),
    );
    prisma.cobroEmpresa.update.mockImplementation(({ data }: any) =>
      Promise.resolve(data),
    );

    await montar(prisma).registrarPago(5, { fechaCobro: HOY });

    const update = prisma.empresa.update.mock.calls[0][0].data;
    expect(update.fechaExpiracion.toISOString().slice(0, 10)).toBe(
      '2026-11-14',
    ); // 15/10 + 30
    // Y la cuenta vuelve a estar activa.
    expect(update.estado).toBe('ACTIVO');
  });

  it('el consumo de la API no alarga el plan ni se asienta como mensualidad', async () => {
    const prisma = prismaBase();
    prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro({ concepto: 'API_FACTURACION', monto: 5.9 }));
    prisma.cobroEmpresa.update.mockImplementation(({ data }: any) => Promise.resolve(data));

    await montar(prisma).registrarPago(5, { medioPago: 'MERCADO_PAGO', fechaCobro: HOY });

    expect(prisma.empresa.update).not.toHaveBeenCalled();
    expect(prisma.cobroEmpresa.update.mock.calls[0][0].data.cubreHasta).toBeNull();
    const ingreso = prisma.ingresoSistema.create.mock.calls[0][0].data;
    expect(ingreso.tipo).toBe('API_FACTURACION');
    expect(ingreso.concepto).toMatch(/^API de facturación 2026-10/);
  });

  it('después del pago avisa a quien se registró (la factura de la API)', async () => {
    const prisma = prismaBase();
    prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro({ concepto: 'API_FACTURACION' }));
    prisma.cobroEmpresa.update.mockImplementation(({ data }: any) => Promise.resolve(data));
    const service = montar(prisma);
    const hook = jest.fn().mockResolvedValue(undefined);
    service.registrarAlPagar(hook);
    await service.registrarPago(5, { fechaCobro: HOY });
    expect(hook).toHaveBeenCalledWith({ id: 5, empresaId: 90, concepto: 'API_FACTURACION' });
  });

  it('si lo de después del pago falla, el pago queda igual', async () => {
    const prisma = prismaBase();
    prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro());
    prisma.cobroEmpresa.update.mockImplementation(({ data }: any) => Promise.resolve(data));
    const service = montar(prisma);
    service.registrarAlPagar(jest.fn().mockRejectedValue(new Error('SUNAT caído')));
    await expect(service.registrarPago(5, { fechaCobro: HOY })).resolves.toMatchObject({ estado: 'APLICADO' });
  });

  it('deja el ingreso ligado a la empresa y al cobro', async () => {
    const prisma = prismaBase();
    prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro());
    prisma.cobroEmpresa.update.mockImplementation(({ data }: any) =>
      Promise.resolve(data),
    );

    await montar(prisma).registrarPago(5, {
      medioPago: 'TRANSFERENCIA',
      referencia: 'OP-123',
    });

    const ingreso = prisma.ingresoSistema.create.mock.calls[0][0].data;
    expect(ingreso.tipo).toBe('SUSCRIPCION');
    expect(ingreso.empresaId).toBe(90);
    expect(ingreso.cobroEmpresaId).toBe(5);
    expect(Number(ingreso.monto)).toBe(99.9);
  });

  it('no deja registrar dos veces el mismo pago', async () => {
    const prisma = prismaBase();
    prisma.cobroEmpresa.findUnique.mockResolvedValue(
      cobro({ estado: 'APLICADO' }),
    );

    await expect(montar(prisma).registrarPago(5)).rejects.toThrow(
      /ya figura como pagado/i,
    );
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });
});

/**
 * Cargar el historial hacia atrás.
 *
 * Las renovaciones de los últimos años se cobraron por Yape y no quedaron en
 * ningún lado, así que el historial de cada empresa arranca vacío. Esto deja
 * anotarlas — con una regla que no se puede romper: un mes que ya se consumió
 * NO extiende la suscripción. Si la extendiera, cargar un año de historial le
 * regalaría un año de sistema al cliente.
 */
describe('Pago histórico', () => {
  const EMPRESA = {
    id: 90,
    razonSocial: 'IRBA',
    plan: { nombre: 'CORPORATIVO' },
  };

  const montarHistorico = (over: any = {}) => {
    const prisma = prismaBase();
    prisma.empresa.findUnique.mockResolvedValue(over.empresa ?? EMPRESA);
    prisma.cobroEmpresa.findFirst.mockResolvedValue(over.yaExiste ?? null);
    prisma.cobroEmpresa.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 100, ...data }),
    );
    return { service: montar(prisma), prisma };
  };

  const datos = (over: any = {}) => ({
    empresaId: 90,
    periodo: '2026-07',
    monto: 99.9,
    fechaCobro: new Date('2026-07-05T12:00:00.000Z'),
    medioPago: 'YAPE',
    ...over,
  });

  it('NO toca la fecha de vencimiento', async () => {
    const { service, prisma } = montarHistorico();
    await service.registrarPagoHistorico(datos());
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('queda como pagado y suma a los ingresos del sistema', async () => {
    const { service, prisma } = montarHistorico();
    await service.registrarPagoHistorico(datos({ referencia: 'OP-7' }));

    const cobro = prisma.cobroEmpresa.create.mock.calls[0][0].data;
    expect(cobro.estado).toBe('APLICADO');
    expect(cobro.periodo).toBe('2026-07');
    // El vencimiento del periodo es el último día de ese mes.
    expect(cobro.fechaVencimiento.toISOString().slice(0, 10)).toBe('2026-07-31');

    const ingreso = prisma.ingresoSistema.create.mock.calls[0][0].data;
    expect(ingreso.empresaId).toBe(90);
    expect(ingreso.tipo).toBe('SUSCRIPCION');
  });

  it('no deja cargar dos veces el mismo mes', async () => {
    const { service } = montarHistorico({ yaExiste: { id: 3, estado: 'APLICADO' } });
    await expect(service.registrarPagoHistorico(datos())).rejects.toThrow(/ya tiene un cobro/i);
  });

  it('rechaza un periodo mal escrito', async () => {
    const { service } = montarHistorico();
    await expect(service.registrarPagoHistorico(datos({ periodo: '07-2026' }))).rejects.toThrow(/AAAA-MM/);
  });

  it('rechaza un monto en cero', async () => {
    const { service } = montarHistorico();
    await expect(service.registrarPagoHistorico(datos({ monto: 0 }))).rejects.toThrow(/mayor a cero/i);
  });
});

describe('Vencidos sin pagar', () => {
  const pendiente = (fechaExpiracion: Date, over: any = {}) => ({
    id: 9,
    empresaId: 90,
    periodo: '2026-10',
    monto: 99.9,
    estado: 'PENDIENTE',
    fechaVencimiento: fechaExpiracion,
    empresa: {
      id: 90,
      razonSocial: 'IRBA',
      estado: 'ACTIVO',
      fechaExpiracion,
      resellerId: null,
      usaDemo: false,
    },
    ...over,
  });

  it('dentro de la gracia avisa pero no suspende', async () => {
    const prisma = prismaBase();
    prisma.cobroEmpresa.findMany.mockResolvedValue([
      pendiente(new Date('2026-10-14T12:00:00.000Z')), // venció ayer
    ]);

    const res = await montar(prisma).procesarVencidos(HOY);

    expect(res.avisados).toBe(1);
    expect(res.suspendidas).toBe(0);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('pasada la gracia suspende la cuenta y marca el cobro', async () => {
    const prisma = prismaBase();
    prisma.cobroEmpresa.findMany.mockResolvedValue([
      pendiente(new Date('2026-10-01T12:00:00.000Z')),
    ]);

    const res = await montar(prisma).procesarVencidos(HOY);

    expect(res.suspendidas).toBe(1);
    expect(prisma.empresa.update.mock.calls[0][0].data.estado).toBe('INACTIVO');
    expect(prisma.cobroEmpresa.update.mock.calls[0][0].data.estado).toBe(
      'RECHAZADO',
    );
  });

  it('si le movieron el vencimiento a mano, no se toca la cuenta', async () => {
    const prisma = prismaBase();
    const c = pendiente(new Date('2026-10-01T12:00:00.000Z'));
    c.empresa.fechaExpiracion = new Date('2026-11-30T12:00:00.000Z'); // ya le renovaron
    prisma.cobroEmpresa.findMany.mockResolvedValue([c]);

    const res = await montar(prisma).procesarVencidos(HOY);

    expect(res.suspendidas).toBe(0);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('si la empresa pasó a ser de un reseller, deja de ser asunto de este ciclo', async () => {
    const prisma = prismaBase();
    const c = pendiente(new Date('2026-10-01T12:00:00.000Z'));
    c.empresa.resellerId = 3;
    prisma.cobroEmpresa.findMany.mockResolvedValue([c]);

    const res = await montar(prisma).procesarVencidos(HOY);

    expect(res.suspendidas).toBe(0);
  });
});

/**
 * El día de vencimiento es del cliente.
 *
 * Caso real (EILEEN SHOP, 15 de octubre): el panel de empresas decía "Vence
 * hoy" y al mismo tiempo el login respondía "Tu plan venció". La fecha se
 * guarda como medianoche UTC del día que vence, y esa medianoche en Lima son
 * las 7 p.m. del día ANTERIOR — así que el corte se adelantaba y el cliente
 * perdía su último día entero de trabajo.
 */
describe('El vencimiento respeta el día completo en Lima', () => {
  // El dato exacto de producción: vence el 15/10.
  const VENCE_15 = new Date('2026-10-15T00:00:00.000Z');

  it('a las 11 de la mañana de su día de vencimiento, sigue adentro', () => {
    // 16:23 UTC = 11:23 a. m. en Lima del 15, que fue cuando falló de verdad.
    const g = evaluarGracia(VENCE_15, new Date('2026-10-15T16:23:00.000Z'));
    expect(g.vencida).toBe(false);
    expect(g.bloqueada).toBe(false);
  });

  it('a las 11 de la noche de su día, todavía está adentro', () => {
    // 04:00 UTC del 16 = 11 p. m. del 15 en Lima.
    expect(evaluarGracia(VENCE_15, new Date('2026-10-16T04:00:00.000Z')).vencida).toBe(false);
  });

  it('pasada la medianoche de Lima, recién vence', () => {
    // 05:01 UTC del 16 = 00:01 del 16 en Lima.
    const g = evaluarGracia(VENCE_15, new Date('2026-10-16T05:01:00.000Z'));
    expect(g.vencida).toBe(true);
    expect(g.enGracia).toBe(true); // vencida, pero con sus días de gracia
  });

  it('la víspera a las 7 p. m. de Lima no lo saca (era el bug)', () => {
    // 00:00 UTC del 15 = 7 p. m. del 14 en Lima: el instante exacto guardado.
    expect(evaluarGracia(VENCE_15, new Date('2026-10-15T00:00:01.000Z')).vencida).toBe(false);
  });

  it('la gracia se cuenta desde el final de su día, no desde la medianoche UTC', () => {
    // 3 días de gracia tras el 15 → entra hasta el final del 18 en Lima.
    expect(evaluarGracia(VENCE_15, new Date('2026-10-19T04:00:00.000Z')).bloqueada).toBe(false);
    // 00:30 del 19 en Lima: se acabó.
    expect(evaluarGracia(VENCE_15, new Date('2026-10-19T05:30:00.000Z')).bloqueada).toBe(true);
  });
});

describe('Vencidos sin pagar: no tocar a quien aún tiene su día', () => {
  it('no suspende a una empresa en su propio día de vencimiento', async () => {
    const prisma = prismaBase();
    const vence = new Date('2026-10-15T00:00:00.000Z');
    prisma.cobroEmpresa.findMany.mockResolvedValue([
      {
        id: 9,
        empresaId: 79,
        periodo: '2026-10',
        monto: 99.9,
        estado: 'PENDIENTE',
        // El cobro se emite por adelantado, así que su fechaVencimiento ya
        // "pasó" en términos crudos cuando el cron corre ese mismo día.
        fechaVencimiento: vence,
        empresa: { id: 79, razonSocial: 'EILEEN SHOP', estado: 'ACTIVO', fechaExpiracion: vence, resellerId: null, usaDemo: false },
      },
    ]);

    const res = await montar(prisma).procesarVencidos(new Date('2026-10-15T16:23:00.000Z'));

    expect(res.suspendidas).toBe(0);
    expect(res.avisados).toBe(0);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });
});

describe('La ventana de gracia', () => {
  it('no venció: entra sin aviso', () => {
    const g = evaluarGracia(new Date('2026-10-20T12:00:00.000Z'), HOY);
    expect(g).toMatchObject({
      vencida: false,
      enGracia: false,
      bloqueada: false,
    });
  });

  it('venció hace poco: entra y se le avisa', () => {
    const g = evaluarGracia(new Date('2026-10-14T12:00:00.000Z'), HOY);
    expect(g.enGracia).toBe(true);
    expect(g.bloqueada).toBe(false);
    // Venció el 14, así que tuvo todo el 14 y le quedan el 15, 16 y 17.
    expect(g.diasRestantes).toBe(3);
  });

  it('se acabó la ventana: no entra', () => {
    const g = evaluarGracia(new Date('2026-10-01T12:00:00.000Z'), HOY);
    expect(g.bloqueada).toBe(true);
    expect(g.diasRestantes).toBe(0);
  });

  it('una empresa sin fecha de expiración no se bloquea por esto', () => {
    expect(evaluarGracia(null, HOY).bloqueada).toBe(false);
  });

  it('la ventana son los días configurados después del vencimiento', () => {
    // Vence el 10: trabaja todo el 10 y después tiene 11, 12 y 13 de gracia.
    // El corte es al terminar el 13 en Lima, que en UTC ya es el 14 a las 04:59.
    const fin = finDeGracia(new Date('2026-10-10T12:00:00.000Z'), 3);
    expect(fin.toISOString()).toBe('2026-10-14T04:59:59.999Z');
  });
});
