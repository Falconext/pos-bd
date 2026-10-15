/**
 * Cuándo el heurístico anti-doble-submit ayuda y cuándo estorba.
 *
 * Rechaza un comprobante idéntico emitido hace segundos. En el panel acierta:
 * ahí eso es un doble clic. En una API se equivoca, porque dos ventas reales
 * iguales seguidas son normales —dos cafés al mismo cliente por el mismo
 * monto— y el integrador recibiría un error por una venta que sí quiere.
 *
 * La regla: el heurístico corre solo cuando no hay una garantía mejor.
 */
import { debeRevisarDobleSubmit } from './anti-doble-submit';

describe('cuándo corre el heurístico', () => {
  it('en el panel sí: es la única defensa contra el doble clic', () => {
    expect(debeRevisarDobleSubmit({ clienteId: 42 })).toBe(true);
  });

  it('sin cliente no corre: no hay con qué comparar', () => {
    expect(debeRevisarDobleSubmit({ clienteId: null })).toBe(false);
    expect(debeRevisarDobleSubmit({})).toBe(false);
    expect(debeRevisarDobleSubmit({ clienteId: 0 })).toBe(false);
  });
});

describe('cuándo se apaga porque hay algo mejor', () => {
  it('con clave de idempotencia de la API', () => {
    // El integrador ya dijo cuándo es la misma operación; adivinar al lado de
    // una certeza solo puede equivocarse.
    expect(
      debeRevisarDobleSubmit({ clienteId: 42, claveIdempotencia: 'ORD-10482' }),
    ).toBe(false);
  });

  it('con uuid del sync offline, como ya era', () => {
    expect(debeRevisarDobleSubmit({ clienteId: 42, origenSyncUuid: 'abc-123' })).toBe(false);
  });

  it('una clave vacía no cuenta como garantía', () => {
    // Si contara, bastaría mandar la cabecera en blanco para desactivar las
    // dos protecciones a la vez.
    for (const vacia of ['', '   ', null, undefined]) {
      expect(debeRevisarDobleSubmit({ clienteId: 42, claveIdempotencia: vacia })).toBe(true);
    }
  });

  it('dos ventas idénticas seguidas por API se permiten', () => {
    // El caso real que el heurístico rompía: mismo cliente, mismo monto,
    // segundos de diferencia, claves distintas porque son ventas distintas.
    const venta = (clave: string) => debeRevisarDobleSubmit({ clienteId: 42, claveIdempotencia: clave });
    expect(venta('venta-1')).toBe(false);
    expect(venta('venta-2')).toBe(false);
  });
});
