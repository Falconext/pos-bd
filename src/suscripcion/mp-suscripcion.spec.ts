/**
 * El débito automático con Mercado Pago.
 *
 * Lo que se protege acá es el dinero que entra solo, sin que nadie mire:
 *
 *  1. Una cuota cobrada tiene que quedar registrada como cualquier otro pago —
 *     por la MISMA función que usa el botón del panel. Si el webhook llevara su
 *     propia contabilidad, un mes cobrado por MP no aparecería en los ingresos.
 *  2. Una cuota rechazada no puede tocar nada. MP reintenta por su cuenta y la
 *     ventana de gracia cubre ese tiempo.
 *  3. Activar no es estar activo: hasta que MP diga "authorized", la empresa
 *     sigue como estaba.
 */
import axios from 'axios';
import { MpSuscripcionService } from './mp-suscripcion.service';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

const EMPRESA = {
  id: 90,
  razonSocial: 'IRBA',
  resellerId: null,
  mpPreapprovalId: null,
  plan: { nombre: 'CORPORATIVO', costo: 99.9 },
  usuarios: [{ email: 'dueno@irba.pe' }],
};

const montar = (over: any = {}) => {
  const prisma = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue(over.empresa ?? EMPRESA),
      findFirst: jest.fn().mockResolvedValue(over.empresaPorPreapproval ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    cobroEmpresa: {
      findFirst: jest.fn().mockResolvedValue(over.cobroPendiente ?? null),
    },
  };
  const cobros = {
    registrarPago: jest.fn().mockResolvedValue({}),
    generarCobrosDelCiclo: jest.fn().mockResolvedValue({ emitidos: 1 }),
  };
  return { service: new MpSuscripcionService(prisma as any, cobros as any), prisma, cobros };
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MP_ACCESS_TOKEN_PLATAFORMA = 'APP_USR-token-de-prueba';
});

describe('Activar el débito', () => {
  it('crea la suscripción y devuelve el enlace para autorizar', async () => {
    const { service, prisma } = montar();
    http.post.mockResolvedValue({
      data: { id: 'pre-123', status: 'pending', init_point: 'https://mp.pe/autorizar' },
    } as any);

    const r = await service.crearSuscripcion(90);

    expect(r.urlAutorizacion).toBe('https://mp.pe/autorizar');
    const cuerpo = http.post.mock.calls[0][1] as any;
    // El id de la empresa viaja en external_reference: es lo que permite
    // conciliar aunque se pierda el vínculo con el preapproval.
    expect(cuerpo.external_reference).toBe('90');
    expect(cuerpo.auto_recurring).toMatchObject({
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: 99.9,
      currency_id: 'PEN',
    });
    // Crear no activa: sigue en false hasta que MP lo autorice.
    expect(prisma.empresa.update.mock.calls[0][0].data.cobroAutomatico).toBe(false);
  });

  it('no se le ofrece a un cliente de reseller', async () => {
    const { service } = montar({ empresa: { ...EMPRESA, resellerId: 3 } });
    await expect(service.crearSuscripcion(90)).rejects.toThrow(/distribuidor/i);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('sin el token de la cuenta de Falconext, avisa en vez de fallar feo', async () => {
    process.env.MP_ACCESS_TOKEN_PLATAFORMA = '';
    const { service } = montar();
    await expect(service.crearSuscripcion(90)).rejects.toThrow(/no está configurado/i);
  });

  it('si MP rechaza el correo, lo dice en claro y no "no se pudo activar"', async () => {
    const { service } = montar();
    // Lo que de verdad contesta MP: un 400 sin detalle. Probado en producción
    // con un correo que no le sirvió.
    http.post.mockRejectedValue({
      response: { status: 400, data: { message: 'User bad request', status: 400 } },
    });

    await expect(service.crearSuscripcion(90)).rejects.toThrow(/correo dueno@irba\.pe/i);
  });

  it('un error pasajero de MP no se confunde con un dato malo', async () => {
    const { service } = montar();
    http.post.mockRejectedValue({ response: { status: 500, data: {} } });
    await expect(service.crearSuscripcion(90)).rejects.toThrow(/en unos minutos/i);
  });

  it('un plan sin costo no genera suscripción', async () => {
    const { service } = montar({ empresa: { ...EMPRESA, plan: { nombre: 'DEMO', costo: 0 } } });
    await expect(service.crearSuscripcion(90)).rejects.toThrow(/costo/i);
  });
});

describe('Webhook: cambió el estado de la suscripción', () => {
  it('cuando MP la autoriza, recién ahí queda activa', async () => {
    const { service, prisma } = montar({
      empresaPorPreapproval: { id: 90, mpPreapprovalId: 'pre-123' },
    });
    http.get.mockResolvedValue({
      data: { id: 'pre-123', status: 'authorized', external_reference: '90' },
    } as any);

    await service.procesarCambioDeSuscripcion('pre-123');

    const ultima = prisma.empresa.update.mock.calls.at(-1)![0].data;
    expect(ultima.cobroAutomatico).toBe(true);
    expect(ultima.mpPreapprovalEstado).toBe('authorized');
  });

  it('si la cancelan desde la app de MP, se apaga acá también', async () => {
    const { service, prisma } = montar({
      empresaPorPreapproval: { id: 90, mpPreapprovalId: 'pre-123' },
    });
    http.get.mockResolvedValue({
      data: { id: 'pre-123', status: 'cancelled', external_reference: '90' },
    } as any);

    await service.procesarCambioDeSuscripcion('pre-123');

    const ultima = prisma.empresa.update.mock.calls.at(-1)![0].data;
    expect(ultima.cobroAutomatico).toBe(false);
    expect(ultima.mpPreapprovalId).toBeNull();
  });
});

describe('Webhook: MP cobró una cuota', () => {
  const cuota = (status: string, extra: any = {}) => ({
    data: {
      id: 'cuota-1',
      status,
      preapproval_id: 'pre-123',
      external_reference: '90',
      transaction_amount: 99.9,
      payment: { id: 55551111 },
      ...extra,
    },
  });

  it('una cuota aprobada se registra por el mismo camino que un pago a mano', async () => {
    const { service, cobros } = montar({
      empresaPorPreapproval: { id: 90, mpPreapprovalId: 'pre-123' },
      cobroPendiente: { id: 7 },
    });
    http.get.mockResolvedValue(cuota('processed') as any);

    await service.procesarCuota('cuota-1');

    expect(cobros.registrarPago).toHaveBeenCalledWith(7, {
      medioPago: 'MERCADO_PAGO',
      referencia: '55551111',
      monto: 99.9,
    });
  });

  it('una cuota rechazada no toca nada', async () => {
    const { service, cobros, prisma } = montar({
      empresaPorPreapproval: { id: 90, mpPreapprovalId: 'pre-123' },
      cobroPendiente: { id: 7 },
    });
    http.get.mockResolvedValue(cuota('rejected') as any);

    await service.procesarCuota('cuota-1');

    expect(cobros.registrarPago).not.toHaveBeenCalled();
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('si MP cobró antes de que el cron emitiera, se emite para poder anotarlo', async () => {
    const { service, cobros, prisma } = montar({
      empresaPorPreapproval: { id: 90, mpPreapprovalId: 'pre-123' },
      cobroPendiente: null,
    });
    http.get.mockResolvedValue(cuota('processed') as any);
    // Primera búsqueda vacía; tras emitir, aparece.
    prisma.cobroEmpresa.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 12 });

    await service.procesarCuota('cuota-1');

    expect(cobros.generarCobrosDelCiclo).toHaveBeenCalledWith(expect.any(Date), expect.any(Number));
    expect(cobros.registrarPago).toHaveBeenCalledWith(12, expect.anything());
  });

  it('ubica la empresa por external_reference si se perdió el vínculo', async () => {
    const { service, cobros, prisma } = montar({
      empresaPorPreapproval: null, // no la encuentra por preapprovalId
      cobroPendiente: { id: 7 },
    });
    prisma.empresa.findUnique.mockResolvedValue({ id: 90, mpPreapprovalId: null });
    http.get.mockResolvedValue(cuota('processed') as any);

    await service.procesarCuota('cuota-1');

    expect(prisma.empresa.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 90 } }),
    );
    expect(cobros.registrarPago).toHaveBeenCalled();
  });
});
