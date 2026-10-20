/**
 * Cancelar un pedido ya registrado, a pedido del cliente.
 *
 * Prueba del 20-10: el bot contestaba "queda cancelado" y la nota seguía
 * viva con su despacho, así que el motorizado podía salir igual. Lo que se
 * defiende acá: sin pagos y sin despacho en camino se anula sola; con plata
 * de por medio o con el paquete ya en camino la ve una persona.
 */
import { LeadsPedidoService } from './leads-pedido.service';
import { afirmaCancelacion } from './confirmacion-falsa';

const EMPRESA = 89;
const CONV = 300;

function armar(opciones: {
  comprobanteId?: number | null;
  pagos?: number;
  despacho?: string | null;
  estadoPago?: string;
  anularFalla?: boolean;
} = {}) {
  const avisos: any[] = [];
  const prisma: any = {
    leadPedidoBorrador: {
      findUnique: jest.fn().mockResolvedValue({
        nombre: 'Sofía Ramos Peña',
        comprobanteId: opciones.comprobanteId === undefined ? 501 : opciones.comprobanteId,
      }),
    },
    comprobante: {
      findUnique: jest.fn().mockResolvedValue({
        id: 501,
        empresaId: EMPRESA,
        serie: 'NV01',
        correlativo: 21,
        estadoPago: opciones.estadoPago ?? 'PENDIENTE_PAGO',
        estadoEnvioSunat: 'NO_APLICA',
        envioDespacho:
          opciones.despacho === null ? null : { estado: opciones.despacho ?? 'PREPARANDO' },
      }),
    },
    pago: { count: jest.fn().mockResolvedValue(opciones.pagos ?? 0) },
  };
  const comprobante: any = {
    anularComprobante: opciones.anularFalla
      ? jest.fn().mockRejectedValue(new Error('boom'))
      : jest.fn().mockResolvedValue({}),
  };
  const notificaciones: any = {
    notificarAdminsEmpresa: jest.fn((a: any) => {
      avisos.push(a);
      return Promise.resolve();
    }),
  };
  const servicio = new LeadsPedidoService(prisma, comprobante, {} as never, notificaciones);
  return {
    cancelar: () => servicio.cancelarPedido(EMPRESA, CONV, 'ya no lo necesita'),
    comprobante,
    avisos,
  };
}

describe('cancelar un pedido registrado', () => {
  it('sin pagos y sin salir, anula la nota y avisa al equipo', async () => {
    const { cancelar, comprobante, avisos } = armar();
    const res = await cancelar();

    expect(res).toEqual({ cancelado: true, pedido: 'NV01-00000021' });
    expect(comprobante.anularComprobante).toHaveBeenCalledWith(
      501,
      expect.stringContaining('ya no lo necesita'),
      EMPRESA,
    );
    expect(avisos[0].titulo).toContain('NV01-00000021');
  });

  it('un recojo (sin despacho) también se anula', async () => {
    const { cancelar } = armar({ despacho: null });
    expect((await cancelar()).cancelado).toBe(true);
  });

  it('una nota ya anulada no se anula dos veces', async () => {
    const { cancelar, comprobante } = armar({ estadoPago: 'ANULADO' });
    expect((await cancelar()).cancelado).toBe(true);
    expect(comprobante.anularComprobante).not.toHaveBeenCalled();
  });

  describe('lo que la ve una persona', () => {
    it('si ya pagó algo', async () => {
      const { cancelar, comprobante } = armar({ pagos: 1 });
      const res = await cancelar();

      expect(res.cancelado).toBeUndefined();
      expect(res.derivar).toMatch(/derivar_a_asesor/);
      expect(comprobante.anularComprobante).not.toHaveBeenCalled();
    });

    it('si el paquete ya salió', async () => {
      const { cancelar, comprobante } = armar({ despacho: 'EN_CAMINO' });
      const res = await cancelar();

      expect(res.derivar).toMatch(/ya salió/);
      expect(comprobante.anularComprobante).not.toHaveBeenCalled();
    });

    it('si el sistema no la pudo anular', async () => {
      const { cancelar } = armar({ anularFalla: true });
      const res = await cancelar();

      expect(res.cancelado).toBeUndefined();
      expect(res.derivar).toMatch(/derivar_a_asesor/);
    });
  });

  it('si solo estaba cotizado, no hay nada que anular', async () => {
    const { cancelar, comprobante } = armar({ comprobanteId: null });
    const res = await cancelar();

    expect(res.error).toMatch(/solo estaba cotizado/);
    expect(comprobante.anularComprobante).not.toHaveBeenCalled();
  });
});

describe('afirmaCancelacion', () => {
  it.each([
    'Entiendo perfectamente. Queda cancelado por ahora.',
    'Tu pedido ha quedado cancelado.',
    'Listo, tu pedido fue anulado.',
  ])('detecta "%s"', (t) => expect(afirmaCancelacion(t)).toBe(true));

  it.each([
    '¿Deseas que cancele tu pedido?',
    'Puedes cancelar el saldo al llegar a la agencia.',
  ])('no confunde "%s"', (t) => expect(afirmaCancelacion(t)).toBe(false));
});
