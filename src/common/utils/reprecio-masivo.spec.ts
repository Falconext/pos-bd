import {
  calcularPrecioNuevo,
  calcularPrecioPack,
  costoConIgv,
  esGravado,
  precioDesdeUtilidad,
  utilidadSobreCosto,
} from './reprecio-masivo';

/**
 * Reprecio masivo.
 *
 * Es la pantalla donde un error cuesta caro: un signo cambiado o un IGV mal
 * restado reprecia 200 productos de golpe y nadie lo nota hasta cuadrar el mes.
 */
describe('Costo con IGV', () => {
  it('re-agrega el IGV al costo, que se guarda neto', () => {
    // Caso real de Casa Market: costo unit 46.61 -> P. Costo 55.00
    expect(costoConIgv(46.61, true, 18)).toBe(55.0);
  });

  it('un producto exonerado no suma IGV al costo', () => {
    expect(costoConIgv(46.61, false, 18)).toBe(46.61);
  });

  it('respeta un IGV distinto de 18', () => {
    expect(costoConIgv(100, true, 10)).toBe(110);
  });

  it('sin costo cargado devuelve 0, no NaN', () => {
    expect(costoConIgv(null, true)).toBe(0);
    expect(costoConIgv(0, true)).toBe(0);
  });

  it('reconoce las afectaciones gravadas del catálogo 07', () => {
    expect(esGravado('10')).toBe(true);
    expect(esGravado('17')).toBe(true);
    expect(esGravado('20')).toBe(false); // exonerado
    expect(esGravado('30')).toBe(false); // inafecto
    expect(esGravado(null)).toBe(false);
  });
});

describe('Utilidad sobre el costo', () => {
  it('reproduce las cifras de Casa Market', () => {
    // Jägermeister: costo 55.00, venta 80.00 -> su columna dice 45.46
    expect(utilidadSobreCosto(80, 55)).toBeCloseTo(45.45, 1);
    // Inkachips: costo 1.71, venta 2.50 -> 46.29
    expect(utilidadSobreCosto(2.5, 1.71)).toBeCloseTo(46.2, 1);
  });

  it('un producto sin precio da -100%: se está regalando el costo entero', () => {
    expect(utilidadSobreCosto(0, 55)).toBe(-100);
  });

  it('es utilidad sobre COSTO, no margen sobre venta', () => {
    // El mismo producto da 45.45 acá y 31.25 en el margen de la ficha.
    // Si alguien cambia esta fórmula por la otra, los precios quedan bajos.
    expect(utilidadSobreCosto(80, 55)).not.toBeCloseTo(31.25, 1);
  });

  it('sin costo no inventa un número', () => {
    expect(utilidadSobreCosto(80, 0)).toBeNull();
  });
});

describe('Precio desde una utilidad objetivo', () => {
  it('fija el precio que deja esa utilidad', () => {
    expect(precioDesdeUtilidad(55, 45.45)).toBeCloseTo(80, 1);
  });

  it('ida y vuelta: el precio calculado devuelve la misma utilidad', () => {
    const precio = precioDesdeUtilidad(20, 35)!;
    expect(utilidadSobreCosto(precio, 20)).toBeCloseTo(35, 1);
  });

  it('sin costo no se puede calcular', () => {
    expect(precioDesdeUtilidad(0, 40)).toBeNull();
  });
});

describe('Operaciones del reprecio', () => {
  const base = { precioActual: 100, costoConIgv: 60 };

  it('aumentar por monto', () => {
    expect(calcularPrecioNuevo({ ...base, operacion: 'AUMENTAR', modo: 'MONTO', valor: 15 })).toBe(115);
  });

  it('aumentar por porcentaje', () => {
    expect(calcularPrecioNuevo({ ...base, operacion: 'AUMENTAR', modo: 'PORCENTAJE', valor: 10 })).toBe(110);
  });

  it('disminuir por monto', () => {
    expect(calcularPrecioNuevo({ ...base, operacion: 'DISMINUIR', modo: 'MONTO', valor: 15 })).toBe(85);
  });

  it('disminuir por porcentaje', () => {
    expect(calcularPrecioNuevo({ ...base, operacion: 'DISMINUIR', modo: 'PORCENTAJE', valor: 10 })).toBe(90);
  });

  it('reemplazar por monto fija el precio', () => {
    expect(calcularPrecioNuevo({ ...base, operacion: 'REEMPLAZAR', modo: 'MONTO', valor: 42 })).toBe(42);
  });

  it('reemplazar por porcentaje fija la UTILIDAD, no el precio', () => {
    // Es para lo que sirve "calcular por último costo": costo 60 + 50% = 90.
    expect(calcularPrecioNuevo({ ...base, operacion: 'REEMPLAZAR', modo: 'PORCENTAJE', valor: 50 })).toBe(90);
  });

  it('reemplazar por utilidad sin costo no adivina: devuelve null', () => {
    expect(
      calcularPrecioNuevo({ precioActual: 100, costoConIgv: 0, operacion: 'REEMPLAZAR', modo: 'PORCENTAJE', valor: 50 }),
    ).toBeNull();
  });

  it('nunca deja el precio en cero o negativo', () => {
    // Bajar 200% o restar más de lo que vale regalaría el producto.
    expect(calcularPrecioNuevo({ ...base, operacion: 'DISMINUIR', modo: 'PORCENTAJE', valor: 200 })).toBeNull();
    expect(calcularPrecioNuevo({ ...base, operacion: 'DISMINUIR', modo: 'MONTO', valor: 100 })).toBeNull();
    expect(calcularPrecioNuevo({ ...base, operacion: 'REEMPLAZAR', modo: 'MONTO', valor: 0 })).toBeNull();
  });

  it('un valor no numérico no reprecia nada', () => {
    expect(calcularPrecioNuevo({ ...base, operacion: 'AUMENTAR', modo: 'MONTO', valor: NaN })).toBeNull();
  });

  it('redondea a dos decimales', () => {
    expect(calcularPrecioNuevo({ precioActual: 10, costoConIgv: 5, operacion: 'AUMENTAR', modo: 'PORCENTAJE', valor: 3.333 })).toBe(10.33);
  });
});

describe('calcularPrecioPack — el pack se mueve con la unidad', () => {
  const pack = { precioActual: 35, costoUnidadConIgv: 4, unidades: 6 };

  it('% sube el pack en la misma proporción que la unidad', () => {
    expect(calcularPrecioPack({ ...pack, operacion: 'AUMENTAR', modo: 'PORCENTAJE', valor: 10 })).toBe(38.5);
    expect(calcularPrecioPack({ ...pack, operacion: 'DISMINUIR', modo: 'PORCENTAJE', valor: 10 })).toBe(31.5);
  });

  it('S/ sube el monto por unidad × las unidades del pack', () => {
    expect(calcularPrecioPack({ ...pack, operacion: 'AUMENTAR', modo: 'MONTO', valor: 1 })).toBe(41);
    expect(calcularPrecioPack({ ...pack, operacion: 'DISMINUIR', modo: 'MONTO', valor: 0.5 })).toBe(32);
  });

  it('fijar utilidad va sobre el costo del pack, no de la unidad', () => {
    // 6 × 4 = 24 de costo; 40% → 33.60
    expect(calcularPrecioPack({ ...pack, operacion: 'REEMPLAZAR', modo: 'PORCENTAJE', valor: 40 })).toBe(33.6);
  });

  it('sin costo no se fija utilidad', () => {
    expect(calcularPrecioPack({ ...pack, costoUnidadConIgv: 0, operacion: 'REEMPLAZAR', modo: 'PORCENTAJE', valor: 40 })).toBeNull();
  });

  it('un precio fijo no se le pone a un pack', () => {
    expect(calcularPrecioPack({ ...pack, operacion: 'REEMPLAZAR', modo: 'MONTO', valor: 49.9 })).toBeNull();
  });

  it('nunca deja el pack en cero o negativo', () => {
    expect(calcularPrecioPack({ ...pack, operacion: 'DISMINUIR', modo: 'MONTO', valor: 10 })).toBeNull();
  });

  it('sin unidades válidas no calcula', () => {
    expect(calcularPrecioPack({ ...pack, unidades: 0, operacion: 'AUMENTAR', modo: 'PORCENTAJE', valor: 10 })).toBeNull();
  });
});
