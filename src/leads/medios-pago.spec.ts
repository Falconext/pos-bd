/**
 * Los medios de pago, cuando hay adelanto.
 *
 * Decisión del negocio (10-10, por audio): *"los medios de cobro para
 * provincia o reserva que queden ya automatizados […] igual que le dé luz
 * verde, porque igual queda pendiente la verificación antes de mandarlo.
 * Siempre de manera humana, cuando ya está agendado yo lo verifico"*.
 *
 * Eso fija tres cosas: la IA los da sola, NO espera el comprobante para
 * confirmar el pedido, y la validación sigue siendo humana antes de
 * despachar — que es el candado del punto 26 del anexo.
 *
 * Y son dato de CADA empresa: los de una no pueden salir en el chat de otra.
 */
import { LeadsPedidoService } from './leads-pedido.service';

const MEDIOS = 'Yape: 955 947 892 · Cuenta BCP: 191 99295336017';

const servicio = (config: unknown) =>
  new LeadsPedidoService(
    {
      empresa: {
        findUnique: jest.fn().mockResolvedValue({ iaVentasConfigJson: config }),
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );

describe('los medios de pago son de cada empresa', () => {
  it('una empresa sin configurarlos no tiene ninguno', async () => {
    const c = await servicio(null).configDe(99);
    expect(c.mediosPago).toBeUndefined();
  });

  it('y la que los configuró recibe LOS SUYOS', async () => {
    const c = await servicio({ mediosPago: MEDIOS }).configDe(89);
    expect(c.mediosPago).toBe(MEDIOS);
  });
});

describe('qué recibe el asistente al registrar el pedido', () => {
  // Se arma la respuesta tal como la devuelve registrarPedido, para fijar el
  // contrato sin montar todo el flujo (eso lo cubre qa-registrar-pedido-real).
  const respuesta = (adelanto: number, mediosPago?: string) => ({
    registrado: true,
    pedido: 'NV01-00000001',
    montoAPagar: 93,
    ...(adelanto > 0 ? { adelanto } : {}),
    ...(adelanto > 0 && mediosPago
      ? {
          mediosPago,
          instruccion:
            'Confirma el pedido con su número. Luego, UNA sola vez, dile el monto del adelanto y los medios de pago, y pídele que mande el comprobante por aquí. No insistas después ni vuelvas a repetirlos si no te los pide.',
        }
      : {}),
  });

  it('con adelanto, le llegan los medios de pago y la instrucción', () => {
    const r = respuesta(46.5, MEDIOS);
    expect(r.mediosPago).toBe(MEDIOS);
    expect(r.instruccion).toMatch(/UNA sola vez/);
    // El flujo del cliente prohíbe insistir con el comprobante.
    expect(r.instruccion).toMatch(/no insistas/i);
  });

  it('sin adelanto (Lima, contraentrega) NO se los dice', () => {
    // Darle una cuenta bancaria a quien paga al recibir solo confunde.
    const r = respuesta(0, MEDIOS);
    expect(r).not.toHaveProperty('mediosPago');
    expect(r).not.toHaveProperty('adelanto');
  });

  it('con adelanto pero sin medios configurados, no inventa ninguno', () => {
    const r = respuesta(46.5, undefined);
    expect(r).not.toHaveProperty('mediosPago');
    expect(r.adelanto).toBe(46.5);
  });

  it('el pedido queda confirmado igual: la IA no espera el voucher', () => {
    // "Igual que le dé luz verde, porque igual queda pendiente la
    // verificación antes de mandarlo."
    const r = respuesta(46.5, MEDIOS);
    expect(r.registrado).toBe(true);
    expect(r.pedido).toBe('NV01-00000001');
  });
});
