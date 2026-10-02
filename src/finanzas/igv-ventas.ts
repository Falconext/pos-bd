/**
 * Cómo se descuenta el IGV de las ventas, en un solo lugar.
 *
 * Esta regla vivía únicamente dentro de `AnalisisFinancieroService`, como
 * métodos privados. El resumen de e-commerce calculaba su propio margen sin
 * ella: comparaba el precio CON IGV contra el costo SIN IGV, lo que inflaba la
 * ganancia. OWENSOFT lo detectó porque sus dos pantallas no cuadraban —S/124.02
 * contra S/96.41 en el mismo mes, y esa diferencia es exactamente el IGV de sus
 * boletas—.
 *
 * El costo de los productos SIEMPRE se guarda sin IGV (es el unitario de la
 * compra). Así que para que un margen tenga sentido, el ingreso también tiene
 * que estar sin IGV. Mezclarlos es comparar peras con manzanas.
 */

export type CriterioIgvVentas = 'ELECTRONICOS' | 'TODOS' | 'NINGUNO';

/** Los que se declaran ante SUNAT y por lo tanto llevan IGV declarado. */
export const TIPOS_DOC_ELECTRONICOS = new Set(['01', '03', '07', '08']);

export const CRITERIO_IGV_LABEL: Record<CriterioIgvVentas, string> = {
  ELECTRONICOS:
    'IGV descontado solo en facturas, boletas y notas de crédito/débito',
  TODOS: 'IGV descontado en todos los documentos (incluidas notas de venta)',
  NINGUNO: 'Sin descontar IGV (ventas brutas)',
};

/** Lee el criterio de la empresa; cualquier cosa rara cae al de siempre. */
export const normalizarCriterio = (valor: unknown): CriterioIgvVentas => {
  const v = String(valor ?? '').toUpperCase();
  return v === 'TODOS' || v === 'NINGUNO' ? v : 'ELECTRONICOS';
};

/**
 * ¿Se descuenta IGV a este tipo de documento?
 *
 *  - ELECTRONICOS: solo facturas/boletas/NC/ND. Las notas de venta y tickets
 *    cuentan íntegros porque ese IGV no se declara.
 *  - TODOS: a todos los documentos.
 *  - NINGUNO: a ninguno; se mira la venta bruta.
 */
export const descuentaIgv = (
  tipoDoc: string,
  criterio: CriterioIgvVentas,
): boolean => {
  if (criterio === 'NINGUNO') return false;
  if (criterio === 'TODOS') return true;
  return TIPOS_DOC_ELECTRONICOS.has(String(tipoDoc));
};

type DecimalLike = { toNumber?: () => number };

/** Los montos vienen como Decimal de Prisma o como número. */
export const aNumero = (
  valor: DecimalLike | number | null | undefined,
): number => {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (valor && typeof valor.toNumber === 'function') return valor.toNumber();
  return 0;
};

export interface LineaVenta {
  cantidad: number | null;
  mtoPrecioUnitario: number | null;
  mtoValorVenta?: number | null;
  tipAfeIgv?: number | null;
}

/**
 * Ingreso de UNA línea sin IGV.
 *
 * Usa el valor de venta guardado (la base sin IGV). Si la línea es gratuita, no
 * onerosa, o el valor guardado no es creíble —cero, o mayor que el bruto—, se
 * queda con precio × cantidad: es preferible no descontar nada antes que
 * inventar un ingreso menor del real.
 */
export const ingresoLineaSinIgv = (
  tipoDoc: string,
  linea: LineaVenta,
  criterio: CriterioIgvVentas,
): number => {
  const bruto = (linea.mtoPrecioUnitario ?? 0) * (linea.cantidad ?? 0);
  if (!descuentaIgv(tipoDoc, criterio)) return bruto;
  const afe = Number(linea.tipAfeIgv ?? 10);
  const onerosa = afe === 10 || afe === 20 || afe === 30 || afe === 40;
  const neto = aNumero(linea.mtoValorVenta);
  if (!onerosa || !(neto > 0) || neto > bruto + 0.01) return bruto;
  return neto;
};

// ─────────────────────────────────────────────────────────────────────────────
// Qué documentos cuentan como venta
// ─────────────────────────────────────────────────────────────────────────────

/** Documentos internos del negocio: pueden convertirse en boleta o factura. */
export const TIPOS_INFORMALES = ['NP', 'OT', 'COT', 'TICKET', 'NV', 'RH', 'CP'];

/**
 * Filtro Prisma para no contar dos veces una venta.
 *
 * Una nota de venta que después se convirtió en boleta deja de contar: ya suma
 * la boleta. Sin esto el resumen de e-commerce contaba las dos —AUTOPARTES,
 * KREZKA y AMELIS tenían ahí todo su descuadre contra el P&L—.
 *
 * Se excluyen también las cotizaciones y órdenes de trabajo, que no son ventas
 * en ningún rubro. La nota de pedido SÍ cuenta: es el comprobante de venta real
 * de muchos negocios informales, y si se convierte la tapa la primera cláusula.
 */
export const filtroExcluirConvertidos = {
  AND: [
    {
      NOT: {
        tipoDoc: { in: TIPOS_INFORMALES },
        comprobantesDerivados: { some: {} },
      },
    },
    { tipoDoc: { notIn: ['COT', 'OT'] } },
  ],
};
