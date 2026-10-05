/**
 * El descuento global y la base imponible.
 *
 * Nace del ticket NV01-300 de OWENSOFT: subtotal 75.00, descuento -5.00,
 * importe total 70.00, pero el desglose decía gravadas 63.56 + IGV 11.44, que
 * suman 75.00. El cliente pagaba 70 y el papel declaraba impuesto sobre 75.
 */
import { aplicarDescuentoGlobal, brutoDeLineas } from './descuento-global';

/** Las cuatro líneas del ticket real. */
const TICKET_OWENSOFT = [
  { descripcion: 'SERV LUBRICACION EPSON L3250', cantidad: 1, nuevoValorUnitario: 30 },
  { descripcion: 'TINTA FULLCOLOR FC-630', cantidad: 1, nuevoValorUnitario: 15 },
  { descripcion: 'CABLE DE DATOS 1.5MTS', cantidad: 1, nuevoValorUnitario: 15 },
  { descripcion: 'ALMOHADILLA EPSON', cantidad: 1, nuevoValorUnitario: 15 },
];

const redondear = (n: number) => Math.round(n * 100) / 100;
/** Lo que hace el backend después: base e IGV a partir de las líneas. */
const desglose = (lineas: any[]) => {
  const conIgv = brutoDeLineas(lineas);
  const base = redondear(conIgv / 1.18);
  return { base, igv: redondear(conIgv - base), total: redondear(conIgv) };
};

describe('El caso de OWENSOFT', () => {
  it('sin descuento, el bruto son los 75 del subtotal', () => {
    expect(brutoDeLineas(TICKET_OWENSOFT)).toBe(75);
  });

  it('EL DEFECTO: con 5 de descuento, el desglose tiene que cerrar en 70', () => {
    const conDescuento = aplicarDescuentoGlobal(TICKET_OWENSOFT, 5);
    const { base, igv, total } = desglose(conDescuento);
    expect(total).toBe(70);
    expect(base).toBe(59.32);
    expect(igv).toBe(10.68);
    expect(redondear(base + igv)).toBe(70);
  });

  it('lo que imprimía antes sumaba 75, no 70', () => {
    // Es el defecto exacto: base e IGV salían del bruto sin descontar.
    const { base, igv } = desglose(TICKET_OWENSOFT);
    expect(base).toBe(63.56);
    expect(igv).toBe(11.44);
    expect(redondear(base + igv)).toBe(75);
  });
});

describe('Sin descuento nada cambia', () => {
  it('devuelve las MISMAS líneas, sin tocarlas', () => {
    expect(aplicarDescuentoGlobal(TICKET_OWENSOFT, 0)).toBe(TICKET_OWENSOFT);
    expect(aplicarDescuentoGlobal(TICKET_OWENSOFT, null)).toBe(TICKET_OWENSOFT);
    expect(aplicarDescuentoGlobal(TICKET_OWENSOFT, undefined)).toBe(TICKET_OWENSOFT);
  });

  it('un descuento negativo se ignora, no infla la venta', () => {
    expect(aplicarDescuentoGlobal(TICKET_OWENSOFT, -10)).toBe(TICKET_OWENSOFT);
  });
});

describe('El descuento se reparte en proporción', () => {
  it('cada línea baja según lo que pesa', () => {
    const r = aplicarDescuentoGlobal(TICKET_OWENSOFT, 5);
    // factor = 70/75; la de 30 baja a 28, las de 15 a 14.
    expect(redondear(Number(r[0].nuevoValorUnitario))).toBe(28);
    expect(redondear(Number(r[1].nuevoValorUnitario))).toBe(14);
  });

  it('respeta las cantidades, no solo el precio', () => {
    const lineas = [{ cantidad: 3, nuevoValorUnitario: 10 }, { cantidad: 1, nuevoValorUnitario: 20 }];
    expect(brutoDeLineas(lineas)).toBe(50);
    expect(brutoDeLineas(aplicarDescuentoGlobal(lineas, 10))).toBe(40);
  });

  it('conserva el resto de los campos de la línea', () => {
    const r = aplicarDescuentoGlobal(TICKET_OWENSOFT, 5);
    expect(r[0].descripcion).toBe('SERV LUBRICACION EPSON L3250');
    expect(r[0].cantidad).toBe(1);
  });
});

describe('Bordes que no deben romper una venta', () => {
  it('un descuento mayor que la venta la deja en cero, no en negativo', () => {
    const r = aplicarDescuentoGlobal(TICKET_OWENSOFT, 999);
    expect(brutoDeLineas(r)).toBe(0);
    expect(Number(r[0].nuevoValorUnitario)).toBe(0);
  });

  it('un descuento igual al total deja todo en cero', () => {
    expect(brutoDeLineas(aplicarDescuentoGlobal(TICKET_OWENSOFT, 75))).toBe(0);
  });

  it('una venta de importe cero no divide por cero', () => {
    const gratis = [{ cantidad: 1, nuevoValorUnitario: 0 }];
    expect(aplicarDescuentoGlobal(gratis, 5)).toBe(gratis);
  });

  it('sin líneas no explota', () => {
    expect(aplicarDescuentoGlobal([], 5)).toEqual([]);
    expect(brutoDeLineas([])).toBe(0);
  });

  it('valores basura cuentan como cero', () => {
    const sucio = [{ cantidad: 'x', nuevoValorUnitario: undefined }] as any[];
    expect(brutoDeLineas(sucio)).toBe(0);
  });
});
