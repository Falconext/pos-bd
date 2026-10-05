/**
 * Cómo entra el descuento global en el cálculo del comprobante.
 *
 * Reportado por OWENSOFT en la nota de venta NV01-300: el ticket mostraba
 * subtotal 75.00, descuento -5.00 e importe total 70.00, pero el desglose decía
 * gravadas 63.56 + IGV 11.44, que suman 75.00. El cliente paga 70 y el papel
 * declara impuestos de 75.
 *
 * El motivo es que el IGV se calculaba sobre el bruto y el descuento se restaba
 * recién al final, así que la base imponible nunca se enteraba del descuento.
 *
 * `crearFormal` ya lo hacía bien —prorratea el descuento en cada línea antes de
 * calcular el IGV— pero esa lógica vivía suelta dentro de esa función, y las
 * tres rutas informales (nota de venta, cotización, edición) hacían la cuenta
 * corta. Está acá para que haya un solo lugar donde esté escrita.
 *
 * El prorrateo es la forma correcta: un descuento global que rebaja lo que el
 * cliente paga también rebaja la base imponible, y repartirlo entre las líneas
 * mantiene la proporción de cada afectación (lo gravado baja gravado, lo
 * exonerado baja exonerado).
 */

export interface LineaConPrecio {
  cantidad?: unknown;
  nuevoValorUnitario?: unknown;
  [key: string]: unknown;
}

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Lo que suman las líneas antes de cualquier descuento global. */
export const brutoDeLineas = (lineas: LineaConPrecio[]): number =>
  (lineas ?? []).reduce(
    (suma, linea) =>
      suma + numero(linea?.nuevoValorUnitario) * numero(linea?.cantidad),
    0,
  );

/**
 * Las líneas con el descuento global ya repartido.
 *
 * Devuelve el mismo arreglo si no hay descuento que aplicar, para no tocar el
 * camino de siempre. El descuento se topa al bruto: nadie puede descontar más
 * de lo que vale la venta, y un factor negativo daría importes negativos.
 */
export const aplicarDescuentoGlobal = <T extends LineaConPrecio>(
  lineas: T[],
  montoDescuento: unknown,
): T[] => {
  const descuentoPedido = Math.max(0, numero(montoDescuento));
  if (!(descuentoPedido > 0) || !Array.isArray(lineas) || lineas.length === 0) {
    return lineas;
  }

  const bruto = brutoDeLineas(lineas);
  if (!(bruto > 0)) return lineas;

  const descuento = Math.min(descuentoPedido, bruto);
  const factor = (bruto - descuento) / bruto;

  return lineas.map((linea) => ({
    ...linea,
    nuevoValorUnitario: numero(linea?.nuevoValorUnitario) * factor,
  }));
};
