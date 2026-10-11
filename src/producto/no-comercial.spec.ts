/**
 * Agotado y descontinuado no son lo mismo.
 *
 * El negocio pidió cuatro estados, no tres: *"NO DISPONIBLE sin stock"* y
 * *"NO COMERCIAL (ya no se venderán)"*. La diferencia no es cosmética —
 * decide si al cliente se le promete un aviso:
 *
 * - Agotado puede volver → entra en la lista de espera y se le avisa (33.1).
 * - Descontinuado no va a volver → prometerle "te aviso cuando llegue" es
 *   una promesa que nadie va a cumplir.
 */
import {
  leerDisponibilidad,
  textoParaElCliente,
  disponibilidadEfectiva,
} from './disponibilidad.util';

describe('los cuatro estados del negocio', () => {
  it.each([
    ['INMEDIATA', 'INMEDIATA'],
    ['BAJO RESERVA', 'BAJO_PEDIDO'],
    ['NO DISPONIBLE', 'NO_DISPONIBLE'],
    ['NO COMERCIAL', 'NO_COMERCIAL'],
  ])('lee "%s" del Excel', (texto, esperado) => {
    expect(leerDisponibilidad(texto)).toBe(esperado);
  });

  it('también entiende cómo lo escribe la gente', () => {
    expect(leerDisponibilidad('descontinuado')).toBe('NO_COMERCIAL');
    expect(leerDisponibilidad('ya no se vende')).toBe('NO_COMERCIAL');
    expect(leerDisponibilidad('agotado')).toBe('NO_DISPONIBLE');
    expect(leerDisponibilidad('sin stock')).toBe('NO_DISPONIBLE');
  });
});

describe('qué se le dice al cliente', () => {
  it('de lo agotado SÍ se puede prometer aviso', () => {
    const t = textoParaElCliente('NO_DISPONIBLE');
    expect(t).toMatch(/agotado/i);
    expect(t).toMatch(/le avisamos cuando vuelva/i);
  });

  it('de lo descontinuado NO: no va a volver', () => {
    const t = textoParaElCliente('NO_COMERCIAL');
    expect(t).toMatch(/ya no se vende/i);
    expect(t).toMatch(/no.*prometas avisar/i);
    // Y se le ofrece algo en su lugar, en vez de dejarlo sin salida.
    expect(t).toMatch(/alternativa/i);
  });

  it('nunca aparece un número de stock', () => {
    for (const d of ['INMEDIATA', 'BAJO_PEDIDO', 'NO_DISPONIBLE', 'NO_COMERCIAL'] as const) {
      expect(textoParaElCliente(d)).not.toMatch(/\d+\s*(unidades|en stock)/i);
    }
  });

  it('"bajo reserva" se dice como lo dice el negocio, no "bajo pedido"', () => {
    expect(textoParaElCliente('BAJO_PEDIDO')).toMatch(/bajo reserva/i);
  });
});

describe('lo descontinuado con stock en la base', () => {
  it('sigue siendo descontinuado, aunque queden unidades', () => {
    // Puede quedar mercadería de la última compra y aun así no venderse más.
    // La marca explícita manda sobre el número.
    expect(
      disponibilidadEfectiva({ disponibilidad: 'NO_COMERCIAL', stock: 12 }),
    ).toBe('NO_COMERCIAL');
  });

  it('y sin marca explícita, el stock sigue decidiendo', () => {
    expect(disponibilidadEfectiva({ disponibilidad: null, stock: 3 })).toBe(
      'INMEDIATA',
    );
    expect(disponibilidadEfectiva({ disponibilidad: null, stock: 0 })).toBe(
      'NO_DISPONIBLE',
    );
  });
});
