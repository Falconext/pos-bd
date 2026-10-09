/**
 * El empresario no escribe enums. Lo que importa aquí es que la columna del
 * Excel se entienda escrita como la escriba, y que una celda rara nunca
 * rompa la importación: se ignora y se deduce del stock.
 */
import {
  disponibilidadEfectiva,
  escribirPrioridadVenta,
  leerDisponibilidad,
  leerPrioridadVenta,
  textoParaElCliente,
} from './disponibilidad.util';

describe('leerDisponibilidad', () => {
  it.each([
    ['INMEDIATA', 'INMEDIATA'],
    ['inmediata', 'INMEDIATA'],
    ['Disponible', 'INMEDIATA'],
    ['BAJO PEDIDO', 'BAJO_PEDIDO'],
    ['bajo_pedido', 'BAJO_PEDIDO'],
    ['Bajo Pedido', 'BAJO_PEDIDO'],
    // El anexo de la propuesta lo llama "bajo reserva"; sus textos, "bajo
    // pedido". Se aceptan los dos para que nadie tenga que reeditar el Excel.
    ['BAJO RESERVA', 'BAJO_PEDIDO'],
    ['por encargo', 'BAJO_PEDIDO'],
    ['NO DISPONIBLE', 'NO_DISPONIBLE'],
    ['agotado', 'NO_DISPONIBLE'],
  ])('entiende "%s"', (entrada, esperado) => {
    expect(leerDisponibilidad(entrada)).toBe(esperado);
  });

  it.each([
    ['', null],
    [null, null],
    [undefined, null],
    ['cualquier cosa', null],
  ])('devuelve null con %p para que mande el stock', (entrada, esperado) => {
    expect(leerDisponibilidad(entrada)).toBe(esperado);
  });
});

describe('leerPrioridadVenta', () => {
  it.each([
    ['MUY ALTA', 3],
    ['muy alta', 3],
    ['Alta', 2],
    ['media', 1],
    ['3', 3],
    [2, 2],
  ])('entiende %p', (entrada, esperado) => {
    expect(leerPrioridadVenta(entrada)).toBe(esperado);
  });

  it.each([
    ['', null],
    ['altísima', null],
    [9, null],
    [0, null],
  ])('ignora %p', (entrada, esperado) => {
    expect(leerPrioridadVenta(entrada)).toBe(esperado);
  });

  it('va y vuelve del Excel sin perder nada', () => {
    for (const texto of ['MUY ALTA', 'ALTA', 'MEDIA']) {
      expect(escribirPrioridadVenta(leerPrioridadVenta(texto))).toBe(texto);
    }
    expect(escribirPrioridadVenta(null)).toBe('');
  });
});

describe('disponibilidadEfectiva', () => {
  it('la deduce del stock cuando nadie la fijó', () => {
    expect(disponibilidadEfectiva({ stock: 12 })).toBe('INMEDIATA');
    expect(disponibilidadEfectiva({ stock: 0 })).toBe('NO_DISPONIBLE');
  });

  it('lo puesto a mano manda sobre el stock', () => {
    // El caso de Hierba Sana: no lleva inventario, su stock es ficticio.
    expect(
      disponibilidadEfectiva({ disponibilidad: 'BAJO_PEDIDO', stock: 50 }),
    ).toBe('BAJO_PEDIDO');
    expect(
      disponibilidadEfectiva({ disponibilidad: 'INMEDIATA', stock: 0 }),
    ).toBe('INMEDIATA');
  });
});

describe('textoParaElCliente', () => {
  it('nunca menciona un número de stock', () => {
    for (const d of ['INMEDIATA', 'BAJO_PEDIDO', 'NO_DISPONIBLE'] as const) {
      expect(textoParaElCliente(d)).not.toMatch(/\d/);
    }
  });

  it('no promete fecha en lo que va bajo pedido', () => {
    const texto = textoParaElCliente('BAJO_PEDIDO');
    expect(texto).toContain('sin fecha prometida');
  });
});
