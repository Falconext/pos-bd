/**
 * Cuánto se le cobra a un integrador por el mes.
 *
 * Todo lo de este archivo es aritmética pura y vive separado del medidor por
 * una razón: es la parte que, si se equivoca, le cobra de más a un cliente o
 * le regala plata a Krezka, y las dos se descubren tarde. Acá se puede probar
 * cada borde sin base de datos.
 *
 * Tarifa (24-10, la misma de apisunat, deducida de sus órdenes de pago): se
 * cobra **por empresa emisora (RUC) y por mes**, y el integrador paga la suma
 * de sus empresas.
 *
 *   - hasta 20 comprobantes: S/ 0.05 cada uno (18 → S/ 0.90);
 *   - de 21 a 100: S/ 5.00 fijo;
 *   - más de 100: S/ 5.00 + S/ 0.05 por cada uno sobre 100;
 *   - todo más IGV. Las pruebas (`sk_test_`) no se cobran: ni se emiten.
 *
 * Sin mínimo mensual: una empresa que no emitió no paga nada. La tarifa
 * anterior (S/ 0.05 con mínimo de S/ 30 por integrador) cobraba S/ 30 a quien
 * recién empezaba, que es justo a quien queremos traer.
 */

export const PRECIO_UNITARIO = 0.05;
/** Hasta aquí se cobra por comprobante. */
export const HASTA_POR_UNIDAD = 20;
/** Lo que se cobra fijo de 21 a `INCLUIDOS_EN_FIJO`. */
export const CARGO_FIJO = 5;
export const INCLUIDOS_EN_FIJO = 100;

export const IGV = 0.18;

const aCentimos = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** Lo que paga UNA empresa emisora por sus comprobantes del mes, sin IGV. */
export const cargoDelEmisor = (cantidad: number): number => {
  const n = Math.max(0, Math.floor(Number(cantidad) || 0));
  if (n <= HASTA_POR_UNIDAD) return aCentimos(n * PRECIO_UNITARIO);
  if (n <= INCLUIDOS_EN_FIJO) return CARGO_FIJO;
  return aCentimos(CARGO_FIJO + (n - INCLUIDOS_EN_FIJO) * PRECIO_UNITARIO);
};

export interface Liquidacion {
  /** Comprobantes cobrables del mes, sumando todas las empresas. */
  cantidad: number;
  /** Precio promedio por comprobante (subtotal / cantidad), solo informativo. */
  precioUnitario: number;
  /** Lo que paga cada empresa, en el mismo orden en que se pasaron. */
  porEmisor: number[];
  subtotalConsumo: number;
  /** Ya no hay mínimo: siempre 0. Se conserva por el registro del mes. */
  ajusteMinimo: number;
  /** Base imponible: lo que se factura sin IGV. */
  subtotal: number;
  igv: number;
  total: number;
  /** Ya no hay mínimo: siempre falso. */
  aplicoMinimo: boolean;
}

/** La liquidación del mes de un integrador: la suma de sus empresas. */
export const liquidar = (conteosPorEmisor: number[] | number): Liquidacion => {
  const conteos = (Array.isArray(conteosPorEmisor) ? conteosPorEmisor : [conteosPorEmisor]).map((n) =>
    Math.max(0, Math.floor(Number(n) || 0)),
  );
  const porEmisor = conteos.map(cargoDelEmisor);
  const cantidad = conteos.reduce((a, b) => a + b, 0);
  const subtotal = aCentimos(porEmisor.reduce((a, b) => a + b, 0));
  const igv = aCentimos(subtotal * IGV);
  return {
    cantidad,
    precioUnitario: cantidad ? Math.round((subtotal / cantidad) * 10000) / 10000 : 0,
    porEmisor,
    subtotalConsumo: subtotal,
    ajusteMinimo: 0,
    subtotal,
    igv,
    total: aCentimos(subtotal + igv),
    aplicoMinimo: false,
  };
};

/**
 * El período de facturación de una fecha, como `2026-10`.
 *
 * Se calcula con las partes locales y no con `toISOString()`: el proceso corre
 * con TZ=America/Lima, y en UTC el 31 de octubre a las 20:00 de Lima ya es
 * noviembre. Un comprobante de fin de mes caería en el período siguiente y el
 * integrador lo vería aparecer en la factura equivocada.
 */
export const periodoDe = (fecha: Date): string =>
  `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;

/** El período anterior al de la fecha dada. Es el que se cierra y se cobra. */
export const periodoAnterior = (fecha: Date): string =>
  periodoDe(new Date(fecha.getFullYear(), fecha.getMonth() - 1, 1));

/** Los límites de un período, para acotar la consulta del medidor. */
export const rangoDelPeriodo = (periodo: string): { desde: Date; hasta: Date } => {
  const [a, m] = periodo.split('-').map(Number);
  if (!a || !m || m < 1 || m > 12) {
    throw new Error(`Período inválido: "${periodo}". Se espera AAAA-MM.`);
  }
  return {
    desde: new Date(a, m - 1, 1, 0, 0, 0, 0),
    // Primer instante del mes siguiente: el filtro va con `lt`, no `lte`,
    // para no depender de cuántos milisegundos tiene el último día.
    hasta: new Date(a, m, 1, 0, 0, 0, 0),
  };
};

/**
 * Qué estados se cobran.
 *
 * Solo lo que SUNAT aceptó, como se publicó. Un rechazado no se cobra aunque
 * haya consumido una firma del paquete de Krezka: ese costo lo absorbe
 * Krezka, y es deliberado — cobrar por un comprobante que el integrador tiene
 * que volver a emitir le haría pagar dos veces por una sola venta.
 *
 * `voided` también se cobra: el comprobante existió, SUNAT lo aceptó y la
 * firma se gastó. La baja posterior no devuelve nada. Lo que NO se cobra es
 * la comunicación de baja en sí, que no es un comprobante.
 */
export const ESTADOS_COBRABLES: readonly string[] = ['accepted', 'observed', 'voided'];

export const esCobrable = (estadoPublico: string | null): boolean =>
  estadoPublico !== null && ESTADOS_COBRABLES.includes(estadoPublico);
