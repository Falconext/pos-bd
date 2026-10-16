/**
 * Cuánto se le cobra a un integrador por el mes.
 *
 * Todo lo de este archivo es aritmética pura y vive separado del medidor por
 * una razón: es la parte que, si se equivoca, le cobra de más a un cliente o
 * le regala plata a Krezka, y las dos se descubren tarde. Acá se puede probar
 * cada borde sin base de datos.
 *
 * Las reglas son las publicadas en el portal, y hay una que es fácil de
 * implementar mal: **el tramo se aplica sobre el total del mes, no por
 * escalones**. 25,000 comprobantes son 25,000 × 0.04, NO 20,000 × 0.05 más
 * 5,000 × 0.04. La diferencia es S/200 en ese ejemplo, y el texto que el
 * integrador leyó antes de firmar dice lo primero.
 *
 * Que el precio BAJE al subir de tramo tiene una consecuencia que conviene
 * tener presente: justo después del corte, facturar más puede costar menos en
 * total. A 20,000 son S/1,000 y a 20,001 son S/800. Es intencional —así se
 * publicó— y por eso no se "corrige" redondeando hacia arriba.
 */

/** Los tramos publicados, de menor a mayor. `hasta` es inclusivo. */
export interface Tramo {
  hasta: number;
  precio: number;
}

export const TRAMOS: readonly Tramo[] = [
  { hasta: 20_000, precio: 0.05 },
  { hasta: 50_000, precio: 0.04 },
  { hasta: Number.POSITIVE_INFINITY, precio: 0.03 },
];

/** Mínimo mensual, sin IGV. Se cobra aunque no se emita nada. */
export const MINIMO_MENSUAL = 30;

export const IGV = 0.18;

const aCentimos = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** El precio unitario que corresponde a un volumen mensual. */
export const precioPorComprobante = (cantidad: number): number => {
  const n = Math.max(0, Math.floor(cantidad));
  for (const t of TRAMOS) if (n <= t.hasta) return t.precio;
  return TRAMOS[TRAMOS.length - 1].precio;
};

export interface Liquidacion {
  cantidad: number;
  precioUnitario: number;
  /** Lo consumido antes de aplicar el mínimo. */
  subtotalConsumo: number;
  /** Cuánto se agregó para llegar al mínimo. 0 si no hizo falta. */
  ajusteMinimo: number;
  /** Base imponible: lo que se factura sin IGV. */
  subtotal: number;
  igv: number;
  total: number;
  /** Verdadero cuando lo que manda es el mínimo y no el consumo. */
  aplicoMinimo: boolean;
}

/**
 * La liquidación del mes.
 *
 * El mínimo no se suma al consumo: lo reemplaza cuando el consumo queda por
 * debajo. Sumarlo cobraría S/30 extra a todo el mundo, que no es lo que dice
 * "mínimo mensual de S/30".
 */
export const liquidar = (cantidad: number): Liquidacion => {
  const n = Math.max(0, Math.floor(Number(cantidad) || 0));
  const precioUnitario = precioPorComprobante(n);
  const subtotalConsumo = aCentimos(n * precioUnitario);
  const aplicoMinimo = subtotalConsumo < MINIMO_MENSUAL;
  const subtotal = aplicoMinimo ? MINIMO_MENSUAL : subtotalConsumo;
  const igv = aCentimos(subtotal * IGV);
  return {
    cantidad: n,
    precioUnitario,
    subtotalConsumo,
    ajusteMinimo: aCentimos(subtotal - subtotalConsumo),
    subtotal,
    igv,
    total: aCentimos(subtotal + igv),
    aplicoMinimo,
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
