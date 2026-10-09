/**
 * B3 — auditoría matemática del motor de descuentos.
 *
 * Es una de las tres condiciones de aceptación de la propuesta: "regla de
 * packs y volúmenes comprobada al 100% en 5 carritos combinados, sin desajuste
 * de céntimos". Los cinco carritos están abajo, más los bordes donde un
 * redondeo mal hecho cambia lo que paga el cliente.
 */
import {
  REGLAS_HIERBA_SANA,
  ReglasDescuento,
  calcularDescuento,
  soles,
} from './reglas-descuento';

const ENVIO_LIMA = 15;
const ENVIO_PROVINCIA = 10;

describe('el ejemplo que el propio cliente escribió', () => {
  // De AGENTE_01.txt: "2x S/ 31.00 + 1x S/ 60.00 + envío provincia S/ 10.00 →
  // TOTAL S/ 132.00; 3 unidades válidas y total mayor a S/ 90 → Descuento
  // S/ 10.00 → MONTO A PAGAR S/ 122.00".
  it('da exactamente los números de su documento', () => {
    const r = calcularDescuento(
      [
        { precioUnitario: 31, cantidad: 2 },
        { precioUnitario: 60, cantidad: 1 },
      ],
      ENVIO_PROVINCIA,
    );
    expect(r.subtotal).toBe(122);
    expect(r.total).toBe(132);
    expect(r.unidadesValidas).toBe(3);
    expect(r.descuento).toBe(10);
    expect(r.montoAPagar).toBe(122);
  });
});

describe('los 5 carritos combinados de la auditoría', () => {
  it('carrito 1 — no alcanza ningún tramo', () => {
    const r = calcularDescuento(
      [{ precioUnitario: 31, cantidad: 2 }],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(77);
    expect(r.unidadesValidas).toBe(2);
    expect(r.descuento).toBe(0);
    // Sin descuento, el monto a pagar es el total: la cotización no imprime
    // línea de descuento.
    expect(r.montoAPagar).toBe(77);
  });

  it('carrito 2 — tramo de S/ 10', () => {
    const r = calcularDescuento(
      [
        { precioUnitario: 31, cantidad: 2 },
        { precioUnitario: 25, cantidad: 1 },
      ],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(102);
    expect(r.unidadesValidas).toBe(3);
    expect(r.descuento).toBe(10);
    expect(r.montoAPagar).toBe(92);
  });

  it('carrito 3 — tramo de S/ 20, con un producto barato que no suma', () => {
    const r = calcularDescuento(
      [
        { precioUnitario: 31, cantidad: 4 },
        { precioUnitario: 45, cantidad: 1 },
        // S/ 10 entra en la cotización pero NO cuenta como unidad válida.
        { precioUnitario: 10, cantidad: 3 },
      ],
      ENVIO_PROVINCIA,
    );
    expect(r.subtotal).toBe(199);
    expect(r.total).toBe(209);
    expect(r.unidadesValidas).toBe(5);
    expect(r.descuento).toBe(20);
    expect(r.montoAPagar).toBe(189);
  });

  it('carrito 4 — tramo de S/ 30, solo el más alto', () => {
    const r = calcularDescuento(
      [
        { precioUnitario: 31, cantidad: 5 },
        { precioUnitario: 45, cantidad: 2 },
      ],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(260);
    expect(r.unidadesValidas).toBe(7);
    // 10 + 20 + 30 serían 60: los descuentos NO se acumulan.
    expect(r.descuento).toBe(30);
    expect(r.montoAPagar).toBe(230);
  });

  it('carrito 5 — muchas unidades baratas: monto alto pero sin unidades válidas', () => {
    const r = calcularDescuento(
      [{ precioUnitario: 15, cantidad: 20 }],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(315);
    expect(r.unidadesValidas).toBe(0);
    expect(r.descuento).toBe(0);
  });
});

describe('los bordes donde un redondeo cambia lo que paga el cliente', () => {
  it('con el total EXACTO en S/ 90 no aplica: la regla dice "mayor a"', () => {
    // 3 × 25 = 75 + 15 de envío = 90 clavado.
    const r = calcularDescuento(
      [{ precioUnitario: 25, cantidad: 3 }],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(90);
    expect(r.unidadesValidas).toBe(3);
    expect(r.descuento).toBe(0);
  });

  it('un céntimo por encima de S/ 90 sí aplica', () => {
    const r = calcularDescuento(
      [
        { precioUnitario: 25, cantidad: 3 },
        { precioUnitario: 0.01, cantidad: 1 },
      ],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(90.01);
    expect(r.descuento).toBe(10);
  });

  it('un producto de S/ 20.00 exactos NO cuenta como unidad válida', () => {
    const r = calcularDescuento(
      [
        { precioUnitario: 20, cantidad: 3 },
        { precioUnitario: 40, cantidad: 1 },
      ],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(115);
    expect(r.unidadesValidas).toBe(1);
    expect(r.descuento).toBe(0);
  });

  it('a S/ 20.01 sí cuenta', () => {
    const r = calcularDescuento(
      [{ precioUnitario: 20.01, cantidad: 3 }],
      ENVIO_LIMA,
    );
    expect(r.unidadesValidas).toBe(3);
    expect(r.total).toBe(75.03);
    expect(r.descuento).toBe(0); // 75.03 no supera 90
  });

  it('no arrastra el error clásico de los flotantes', () => {
    // 0.1 + 0.2 en coma flotante da 0.30000000000000004. Sumando precios con
    // céntimos esto es lo que descuadra una cotización.
    const r = calcularDescuento(
      [
        { precioUnitario: 0.1, cantidad: 1 },
        { precioUnitario: 0.2, cantidad: 1 },
      ],
      0,
    );
    expect(r.total).toBe(0.3);
  });

  it('suma 29 ítems de S/ 33.33 sin perder un céntimo', () => {
    const r = calcularDescuento([{ precioUnitario: 33.33, cantidad: 29 }], 15);
    expect(r.subtotal).toBe(966.57);
    expect(r.total).toBe(981.57);
    expect(r.montoAPagar).toBe(951.57);
  });
});

describe('aviso de "te falta poco para el siguiente escalón"', () => {
  it('avisa cuando solo falta una unidad y el monto ya alcanza', () => {
    // 4 unidades válidas, total 199 > 170: le falta 1 unidad para los S/ 20.
    const r = calcularDescuento(
      [{ precioUnitario: 46, cantidad: 4 }],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(199);
    expect(r.descuento).toBe(10);
    expect(r.faltaParaSiguiente).toEqual({ unidades: 1, descuento: 20 });
  });

  it('NO avisa si además le falta dinero', () => {
    // 4 unidades pero total 115: decirle "te falta 1 unidad" sería engañarlo,
    // porque también le faltan S/ 55.
    const r = calcularDescuento(
      [{ precioUnitario: 25, cantidad: 4 }],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(115);
    expect(r.descuento).toBe(10);
    expect(r.faltaParaSiguiente).toBeNull();
  });

  it('sugiere el siguiente tramo, no el más alto', () => {
    // 3 unidades y S/ 285: ya tiene el de S/ 10 y le faltan 2 para el de
    // S/ 20. El de S/ 30 (7 unidades) queda lejos y no se menciona.
    const r = calcularDescuento(
      [{ precioUnitario: 90, cantidad: 3 }],
      ENVIO_LIMA,
    );
    expect(r.total).toBe(285);
    expect(r.descuento).toBe(10);
    expect(r.faltaParaSiguiente).toEqual({ unidades: 2, descuento: 20 });
  });

  it('NO avisa si faltan más de dos unidades', () => {
    // Monto de sobra (S/ 315) pero ninguna unidad válida: para el primer
    // tramo le faltan 3, demasiado para sugerirlo.
    const r = calcularDescuento(
      [{ precioUnitario: 15, cantidad: 20 }],
      ENVIO_LIMA,
    );
    expect(r.unidadesValidas).toBe(0);
    expect(r.faltaParaSiguiente).toBeNull();
  });

  it('en el tramo más alto ya no hay nada que sugerir', () => {
    const r = calcularDescuento(
      [{ precioUnitario: 45, cantidad: 7 }],
      ENVIO_LIMA,
    );
    expect(r.descuento).toBe(30);
    expect(r.faltaParaSiguiente).toBeNull();
  });
});

describe('las reglas son una tabla, no código', () => {
  // Si el cliente confirma la regla de la propuesta firmada (3/6/8 unidades y
  // 90/170/220) en vez de la de sus documentos, esto es todo lo que cambia.
  const REGLAS_DE_LA_PROPUESTA: ReglasDescuento = {
    ...REGLAS_HIERBA_SANA,
    tramos: [
      { descuento: 10, unidades: 3, totalMayorQue: 90 },
      { descuento: 20, unidades: 6, totalMayorQue: 170 },
      { descuento: 30, unidades: 8, totalMayorQue: 220 },
    ],
  };

  it('el mismo carrito da distinto según la regla vigente', () => {
    // 5 × S/ 40 = 200 + 15 de envío = 215, con 5 unidades válidas.
    // Documentos del cliente: 5 unidades y > 170 → S/ 20.
    // Propuesta firmada: el de S/ 20 pide 6 unidades → se queda en S/ 10.
    // Son S/ 10 de diferencia en la misma venta: por eso hay que cerrarlo.
    const carrito = [{ precioUnitario: 40, cantidad: 5 }];
    expect(calcularDescuento(carrito, ENVIO_LIMA).total).toBe(215);
    expect(calcularDescuento(carrito, ENVIO_LIMA).descuento).toBe(20);
    expect(
      calcularDescuento(carrito, ENVIO_LIMA, REGLAS_DE_LA_PROPUESTA).descuento,
    ).toBe(10);
  });

  it('se puede dejar el envío fuera del total si lo piden así', () => {
    const sinEnvio: ReglasDescuento = {
      ...REGLAS_HIERBA_SANA,
      envioCuentaEnTotal: false,
    };
    const carrito = [{ precioUnitario: 30, cantidad: 3 }]; // 90 de productos
    // Con envío: 105 > 90 → aplica. Sin envío: 90 clavado → no aplica.
    expect(calcularDescuento(carrito, ENVIO_LIMA).descuento).toBe(10);
    expect(calcularDescuento(carrito, ENVIO_LIMA, sinEnvio).descuento).toBe(0);
  });
});

describe('soles()', () => {
  it('escribe los precios como los escribe Hierba Sana', () => {
    expect(soles(25)).toBe('S/ 25.00');
    expect(soles(122.5)).toBe('S/ 122.50');
  });
});
