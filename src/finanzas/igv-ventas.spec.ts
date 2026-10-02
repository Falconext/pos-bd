/**
 * El criterio del IGV en las ventas.
 *
 * Reportado por OWENSOFT: "los reportes no están cuadrando y por ende el
 * resumen financiero tampoco". Sus dos pantallas daban S/124.02 y S/96.41 para
 * el mismo mes, y la diferencia era exactamente el IGV de sus boletas.
 *
 * La causa: el resumen de e-commerce restaba el costo —que SIEMPRE se guarda
 * sin IGV, es el unitario de la compra— del precio CON IGV. Con su TINTA 504
 * YELLOW: precio 35.00, costo 23.4831, y mostraba 11.52 de ganancia cuando la
 * real es 6.18.
 *
 * Estas pruebas fijan la regla que ahora comparten el Análisis Financiero y el
 * resumen de e-commerce.
 */
import {
  CRITERIO_IGV_LABEL,
  TIPOS_DOC_ELECTRONICOS,
  aNumero,
  descuentaIgv,
  ingresoLineaSinIgv,
  normalizarCriterio,
} from './igv-ventas';

describe('A qué documentos se les descuenta el IGV', () => {
  it('ELECTRONICOS: solo factura, boleta y notas de crédito/débito', () => {
    for (const t of ['01', '03', '07', '08']) {
      expect(descuentaIgv(t, 'ELECTRONICOS')).toBe(true);
    }
  });

  it('ELECTRONICOS: la nota de venta cuenta íntegra, su IGV no se declara', () => {
    // Es lo que hace que en la pantalla de OWENSOFT las líneas NV den igual
    // antes y después del arreglo, y solo cambien las boletas.
    for (const t of ['NV', 'TICKET', 'NP', 'OT', 'RH', 'CP']) {
      expect(descuentaIgv(t, 'ELECTRONICOS')).toBe(false);
    }
  });

  it('TODOS: a todos, incluidas las notas de venta', () => {
    expect(descuentaIgv('NV', 'TODOS')).toBe(true);
    expect(descuentaIgv('01', 'TODOS')).toBe(true);
  });

  it('NINGUNO: a ninguno, ni siquiera a la factura', () => {
    expect(descuentaIgv('01', 'NINGUNO')).toBe(false);
    expect(descuentaIgv('NV', 'NINGUNO')).toBe(false);
  });

  it('los tipos electrónicos son exactamente esos cuatro', () => {
    expect([...TIPOS_DOC_ELECTRONICOS].sort()).toEqual(['01', '03', '07', '08']);
  });
});

describe('Leer el criterio de la empresa', () => {
  it('reconoce los tres válidos', () => {
    expect(normalizarCriterio('TODOS')).toBe('TODOS');
    expect(normalizarCriterio('NINGUNO')).toBe('NINGUNO');
    expect(normalizarCriterio('ELECTRONICOS')).toBe('ELECTRONICOS');
  });

  it('cualquier cosa rara cae al de siempre', () => {
    // 60 de las 62 empresas están en ELECTRONICOS: es el comportamiento
    // histórico y el que no debe cambiarle a nadie por un dato sucio.
    for (const v of [null, undefined, '', 'x', 'todos ', 0, {}]) {
      expect(normalizarCriterio(v)).toBe('ELECTRONICOS');
    }
  });

  it('acepta minúsculas', () => {
    expect(normalizarCriterio('todos')).toBe('TODOS');
  });

  it('cada criterio tiene su explicación para la pantalla', () => {
    for (const c of ['ELECTRONICOS', 'TODOS', 'NINGUNO'] as const) {
      expect(CRITERIO_IGV_LABEL[c]).toBeTruthy();
    }
  });
});

describe('El caso real de OWENSOFT', () => {
  /** TINTA EPSON 504 YELLOW: boleta de S/35.00, valor venta S/29.66. */
  const TINTA = { cantidad: 1, mtoPrecioUnitario: 35, mtoValorVenta: 29.66, tipAfeIgv: 10 };
  const COSTO = 23.4831;

  it('en boleta el ingreso va sin IGV', () => {
    expect(ingresoLineaSinIgv('03', TINTA, 'ELECTRONICOS')).toBeCloseTo(29.66, 2);
  });

  it('la ganancia real es 6.18, no los 11.52 que mostraba', () => {
    const antes = 35 - COSTO;                                            // lo que mostraba
    const ahora = ingresoLineaSinIgv('03', TINTA, 'ELECTRONICOS') - COSTO;
    expect(antes).toBeCloseTo(11.52, 2);
    expect(ahora).toBeCloseTo(6.18, 2);
  });

  it('su almohadilla: de 12.96 a 10.67', () => {
    const linea = { cantidad: 1, mtoPrecioUnitario: 15, mtoValorVenta: 12.71, tipAfeIgv: 10 };
    expect(ingresoLineaSinIgv('03', linea, 'ELECTRONICOS') - 2.04).toBeCloseTo(10.67, 2);
  });

  it('sus notas de venta NO cambian: ese IGV no se declara', () => {
    const linea = { cantidad: 1, mtoPrecioUnitario: 15, mtoValorVenta: 12.71, tipAfeIgv: 10 };
    expect(ingresoLineaSinIgv('NV', linea, 'ELECTRONICOS')).toBe(15);
  });
});

describe('Cuando el dato no es creíble, no se descuenta nada', () => {
  it('sin valor de venta guardado se queda con el bruto', () => {
    // Mejor no descontar que inventar un ingreso menor del real.
    expect(ingresoLineaSinIgv('03', { cantidad: 2, mtoPrecioUnitario: 10 }, 'ELECTRONICOS')).toBe(20);
    expect(ingresoLineaSinIgv('03', { cantidad: 2, mtoPrecioUnitario: 10, mtoValorVenta: 0 }, 'ELECTRONICOS')).toBe(20);
  });

  it('un valor de venta MAYOR que el bruto se descarta', () => {
    expect(ingresoLineaSinIgv('03',
      { cantidad: 1, mtoPrecioUnitario: 10, mtoValorVenta: 99, tipAfeIgv: 10 }, 'ELECTRONICOS')).toBe(10);
  });

  it('una línea gratuita no se toca', () => {
    // Afectación 21 = gratuita: su "valor" es referencial, no un ingreso.
    expect(ingresoLineaSinIgv('03',
      { cantidad: 1, mtoPrecioUnitario: 10, mtoValorVenta: 8.47, tipAfeIgv: 21 }, 'ELECTRONICOS')).toBe(10);
  });

  it('las afectaciones onerosas sí descuentan', () => {
    for (const afe of [10, 20, 30, 40]) {
      expect(ingresoLineaSinIgv('03',
        { cantidad: 1, mtoPrecioUnitario: 10, mtoValorVenta: 8.47, tipAfeIgv: afe }, 'ELECTRONICOS'))
        .toBeCloseTo(8.47, 2);
    }
  });

  it('sin afectación declarada se asume gravada', () => {
    expect(ingresoLineaSinIgv('03',
      { cantidad: 1, mtoPrecioUnitario: 10, mtoValorVenta: 8.47 }, 'ELECTRONICOS')).toBeCloseTo(8.47, 2);
  });
});

describe('Los montos llegan como Decimal de Prisma', () => {
  it('convierte Decimal, número y basura', () => {
    expect(aNumero({ toNumber: () => 12.34 })).toBe(12.34);
    expect(aNumero(5)).toBe(5);
    expect(aNumero(null)).toBe(0);
    expect(aNumero(undefined)).toBe(0);
    expect(aNumero(NaN)).toBe(0);
  });

  it('un Decimal como valor de venta se descuenta igual', () => {
    expect(ingresoLineaSinIgv('03',
      { cantidad: 1, mtoPrecioUnitario: 35, mtoValorVenta: { toNumber: () => 29.66 } as any, tipAfeIgv: 10 },
      'ELECTRONICOS')).toBeCloseTo(29.66, 2);
  });
});
