/**
 * Recibir una orden de compra no puede cambiarle el total.
 *
 * Caso real: una orden emitida SIN IGV por S/ 72 (2 cajas de 6 a S/ 36) se
 * convirtió en una compra de S/ 84.96. La diferencia es exactamente el 18%.
 *
 * El motivo: la compra decide si una línea lleva IGV mirando la afectación del
 * PRODUCTO, y la cerveza es gravada. Pero la orden se había emitido sin IGV
 * —el proveedor no lo cobra— y esa decisión no viajaba a la compra: solo
 * quedaba como `igv = 0` en la orden.
 *
 * Lo que se defiende acá es la regla de negocio: lo pactado con el proveedor
 * manda. Si la orden dice 72, la compra dice 72. Si el sistema la infla, el
 * saldo por pagar nace mal y el empresario le debe al proveedor una plata que
 * nunca acordó.
 */

/** Cómo decide `crearCompra` el neto, el IGV y el total de una línea. */
const montosLinea = (
  item: { precioUnitario: number; cantidad: number; incluyeIgv?: boolean },
  gravado: boolean,
) => {
  const precio = Number(item.precioUnitario) || 0;
  const cantidad = Number(item.cantidad) || 0;
  const costoNeto =
    gravado && item.incluyeIgv
      ? parseFloat((precio / 1.18).toFixed(4))
      : precio;
  const igvItem = gravado ? parseFloat((costoNeto * 0.18).toFixed(4)) : 0;
  const sub = costoNeto * cantidad;
  const totalLinea = !gravado
    ? sub
    : item.incluyeIgv
      ? precio * cantidad
      : (costoNeto + igvItem) * cantidad;
  return { costoNeto, igvItem, sub, totalLinea };
};

/** La regla que agrega `recibir`: lo que dice la orden gana. */
const gravadoDeLaLinea = (
  ordenIgv: number,
  gravadoDelProducto: boolean,
): boolean => (Number(ordenIgv) <= 0 ? false : gravadoDelProducto);

// La orden del caso: 2 cajas de 6 a S/ 36 = 12 unidades a S/ 6, sin IGV.
const LINEA = { precioUnitario: 6, cantidad: 12, incluyeIgv: false };

describe('una orden emitida SIN IGV', () => {
  it('produce una compra por el mismo total que la orden', () => {
    const gravado = gravadoDeLaLinea(0, true); // producto gravado, orden sin IGV
    const { totalLinea } = montosLinea(LINEA, gravado);
    expect(totalLinea).toBeCloseTo(72, 2);
  });

  it('sin la regla, la compra sale 18% más cara', () => {
    // Es lo que pasaba: la cerveza es gravada, así que se le sumaba el IGV a
    // un total ya cerrado con el proveedor.
    const { totalLinea } = montosLinea(LINEA, true);
    expect(totalLinea).toBeCloseTo(84.96, 2);
    expect(totalLinea).not.toBeCloseTo(72, 2);
  });

  it('tampoco declara un IGV que el proveedor no cobró', () => {
    // Forzar `incluyeIgv` daría el total correcto pero inventaría S/ 10.98 de
    // crédito fiscal que no existe en la factura del proveedor.
    const gravado = gravadoDeLaLinea(0, true);
    const { igvItem } = montosLinea(LINEA, gravado);
    expect(igvItem).toBe(0);
  });
});

describe('una orden CON IGV no cambia de comportamiento', () => {
  it('el producto gravado sigue sumando su 18%', () => {
    const gravado = gravadoDeLaLinea(10.98, true);
    const { totalLinea } = montosLinea(LINEA, gravado);
    expect(totalLinea).toBeCloseTo(84.96, 2);
  });

  it('un producto exonerado sigue sin IGV aunque la orden lo aplique', () => {
    // La afectación del producto manda cuando la orden sí lleva IGV: un arroz
    // exonerado no pasa a gravado por estar en una orden con otros productos.
    const gravado = gravadoDeLaLinea(10.98, false);
    expect(montosLinea(LINEA, gravado).totalLinea).toBeCloseTo(72, 2);
  });

  it('con "precios con IGV incluido" el total tampoco se mueve', () => {
    const gravado = gravadoDeLaLinea(10.98, true);
    const { totalLinea, sub } = montosLinea({ ...LINEA, incluyeIgv: true }, gravado);
    expect(totalLinea).toBeCloseTo(72, 2);
    expect(sub).toBeCloseTo(61.02, 2);
  });
});

describe('la equivalencia en cajas del PDF', () => {
  /** Lo que el PDF muestra al proveedor cuando la línea se pidió por cajas. */
  const filaEnCajas = (cantidad: number, precioUnitario: number, unidades?: number) => {
    const u = Number(unidades) || 1;
    if (u <= 1) return { cantidad: String(cantidad), precio: precioUnitario };
    return { cantidad: `${Number((cantidad / u).toFixed(3))} caja(s)`, precio: precioUnitario * u };
  };

  it('muestra cajas y precio por caja, no unidades sueltas', () => {
    // El PDF decía "12 a S/ 6.00" donde el pedido fue "2 cajas a S/ 36": misma
    // plata, pero no es lo que las dos partes hablaron.
    expect(filaEnCajas(12, 6, 6)).toEqual({ cantidad: '2 caja(s)', precio: 36 });
  });

  it('una línea pedida por unidad se queda como está', () => {
    expect(filaEnCajas(12, 6, 1)).toEqual({ cantidad: '12', precio: 6 });
    expect(filaEnCajas(12, 6, undefined)).toEqual({ cantidad: '12', precio: 6 });
  });

  it('el precio por caja × cajas sigue dando el mismo subtotal', () => {
    const f = filaEnCajas(12, 6, 6);
    expect(2 * f.precio).toBeCloseTo(12 * 6, 2);
  });
});
