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
  nivelDeRecomendacion,
  textoParaElCliente,
  valorDeColumna,
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
  // Cuatro niveles: el negocio pidió sumar BAJA, que antes no existía y
  // dejaba a un producto "de poco empuje" igual que a uno sin preferencia.
  it.each([
    ['MUY ALTA', 4],
    ['muy alta', 4],
    ['Alta', 3],
    ['media', 2],
    ['BAJA', 1],
    ['4', 4],
    [2, 2],
  ])('entiende %p', (entrada, esperado) => {
    expect(leerPrioridadVenta(entrada)).toBe(esperado);
  });

  it.each([
    ['', null],
    ['altísima', null],
    [9, null],
    [0, null],
    [5, null],
  ])('ignora %p', (entrada, esperado) => {
    expect(leerPrioridadVenta(entrada)).toBe(esperado);
  });

  it('va y vuelve del Excel sin perder nada', () => {
    for (const texto of ['MUY ALTA', 'ALTA', 'MEDIA', 'BAJA']) {
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

describe('nivelDeRecomendacion: la escala de 4 niveles que lee la IA', () => {
  it('cada número dice su nivel, en el orden del Excel', () => {
    expect(nivelDeRecomendacion(4)).toBe('muy alta');
    expect(nivelDeRecomendacion(3)).toBe('alta');
    expect(nivelDeRecomendacion(2)).toBe('media');
    expect(nivelDeRecomendacion(1)).toBe('baja');
  });

  it('sin prioridad no inventa un nivel', () => {
    expect(nivelDeRecomendacion(null)).toBeNull();
    expect(nivelDeRecomendacion(undefined)).toBeNull();
    expect(nivelDeRecomendacion(0)).toBeNull();
  });

  it('ida y vuelta con el Excel: lo que se lee es lo que la IA ve', () => {
    for (const t of ['MUY ALTA', 'alta', 'Media', 'baja']) {
      expect(nivelDeRecomendacion(leerPrioridadVenta(t))).toBe(t.toLowerCase());
    }
  });
});

describe('valorDeColumna: el encabezado como lo escribió el negocio', () => {
  it('"Prioridad de venta" (catálogo de Hierba Sana) se reconoce', () => {
    const fila = { SKU: 'PROD-0001', 'Prioridad de venta': 'media', disponibilidad: 'INMEDIATA' };
    expect(valorDeColumna(fila, ['PRIORIDAD DE VENTA'])).toBe('media');
    expect(valorDeColumna(fila, ['DISPONIBILIDAD'])).toBe('INMEDIATA');
  });

  it('ignora tildes y espacios de más', () => {
    expect(valorDeColumna({ ' Recomendación ': 'alta' }, ['RECOMENDACION'])).toBe('alta');
  });

  it('sin la columna devuelve undefined', () => {
    expect(valorDeColumna({ SKU: 'x' }, ['PRIORIDAD'])).toBeUndefined();
  });
});

describe('lo que la IA dice de cada disponibilidad (definición de Hierba Sana, 20-10)', () => {
  it('bajo reserva: hay que pagar antes', () => {
    expect(textoParaElCliente('BAJO_PEDIDO')).toMatch(/pagar antes/);
    expect(textoParaElCliente('BAJO_PEDIDO')).toMatch(/no lo registres sin ese pago/);
  });

  it('no comercial: se avisa que se retira del catálogo', () => {
    expect(textoParaElCliente('NO_COMERCIAL')).toMatch(/se retira del catálogo/);
  });
});
