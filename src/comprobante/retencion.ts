/**
 * Régimen de Retenciones del IGV (R.S. 037-2002/SUNAT).
 *
 * El agente de retención es QUIEN COMPRA, no quien emite. El proveedor emite su
 * factura por el total y el comprador le retiene el 3% al pagarle, entregándole
 * a cambio un Comprobante de Retención. El total de la factura NO se reduce: la
 * retención es informativa y lo que cambia es cuánto entra en caja.
 *
 * Por eso la marca vive en el CLIENTE y no en la empresa: la misma empresa le
 * factura a agentes de retención y a clientes comunes el mismo día, y solo a
 * los primeros les corresponde el 3%.
 *
 * `empresaEsAgenteRetencion` se conserva por compatibilidad con el interruptor
 * viejo —uno por empresa, que retenía en TODA factura—. Hoy no lo tiene
 * prendido ninguna empresa, así que nada cambia de comportamiento al migrar.
 */

/** Operaciones de S/700 o menos no se retienen (R.S. 037-2002, art. 3). */
export const UMBRAL_RETENCION = 700;

export const PORCENTAJE_RETENCION = 3;

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface ContextoRetencion {
  /** Solo la factura da derecho a crédito fiscal; la boleta no se retiene. */
  tipoDoc: string;
  /** Importe total de la operación, con IGV: es la base de la retención. */
  total: number;
  clienteEsAgenteRetencion?: boolean | null;
  /** Legado: interruptor por empresa, aplicaba a todas las facturas. */
  empresaEsAgenteRetencion?: boolean | null;
  /** Detracción y retención se excluyen entre sí. */
  tieneDetraccion?: boolean | null;
}

/**
 * ¿Corresponde retener en esta operación?
 *
 * El umbral es ESTRICTO: en exactamente S/700 no se retiene, porque la norma
 * exonera las operaciones "iguales o menores" a ese importe.
 */
export const aplicaRetencion = (ctx: ContextoRetencion): boolean => {
  if (ctx.tieneDetraccion) return false;
  if (String(ctx.tipoDoc ?? '') !== '01') return false;
  if (!(Number(ctx.total) > UMBRAL_RETENCION)) return false;
  return Boolean(ctx.clienteEsAgenteRetencion || ctx.empresaEsAgenteRetencion);
};

/** El 3% sobre el total con IGV, que es la base que exige SUNAT. */
export const calcularRetencion = (
  total: number,
  porcentaje: number = PORCENTAJE_RETENCION,
): number => round2((Number(total) || 0) * (Number(porcentaje) || 0) / 100);

// ─────────────────────────────────────────────────────────────────────────────
// Lado lectura: cómo se reconoce una retención ya guardada.
//
// La retención comparte columnas con la detracción (`montoDetraccion` /
// `porcentajeDetraccion`) y se distingue porque NO lleva tipo de detracción.
// No es bonito, pero es el dato que ya existe en producción; encapsularlo acá
// evita que cada reporte lo vuelva a deducir por su cuenta —y lo confunda con
// una detracción, que es justo lo que pasaba.
// ─────────────────────────────────────────────────────────────────────────────

export interface ComprobanteConRetencion {
  montoDetraccion?: unknown;
  porcentajeDetraccion?: unknown;
  tipoDetraccionId?: number | null;
  mtoImpVenta?: unknown;
}

export const esRetencion = (comp: ComprobanteConRetencion): boolean =>
  !comp?.tipoDetraccionId && Number(comp?.montoDetraccion ?? 0) > 0;

export const montoRetenido = (comp: ComprobanteConRetencion): number =>
  esRetencion(comp) ? round2(Number(comp.montoDetraccion)) : 0;

/** Base imponible de la retención: el importe total de la operación. */
export const baseRetencion = (comp: ComprobanteConRetencion): number =>
  esRetencion(comp) ? round2(Number(comp.mtoImpVenta ?? 0)) : 0;

export const porcentajeRetenido = (comp: ComprobanteConRetencion): number =>
  esRetencion(comp)
    ? Number(comp.porcentajeDetraccion ?? PORCENTAJE_RETENCION)
    : 0;

/** Lo que el cliente termina depositando: total menos lo retenido. */
export const importeNetoACobrar = (comp: ComprobanteConRetencion): number =>
  round2(Number(comp?.mtoImpVenta ?? 0) - montoRetenido(comp));

// ─────────────────────────────────────────────────────────────────────────────
// Lado XML (UBL 2.1).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Código de Catálogo 53 con que SUNAT identifica la retención del IGV.
 * Va como descuento (`ChargeIndicator = false`).
 */
export const CODIGO_CARGO_RETENCION = '62';

/** La leyenda 2006 que acompaña a una factura retenida, o null. */
export const leyendaRetencion = (comp: ComprobanteConRetencion) =>
  esRetencion(comp)
    ? {
        _text: 'OPERACIÓN SUJETA A RETENCIÓN DEL 3%',
        _attributes: { languageLocaleID: '2006' },
      }
    : null;

/**
 * El `cac:AllowanceCharge` de la retención, o null si no corresponde.
 *
 * Vive acá y no dentro del servicio de envío para poder probarlo: el XML es lo
 * único que SUNAT ve, y hasta ahora no tenía ni una prueba. La base es el
 * importe TOTAL con IGV —S/3,100 dan S/93—, no el gravado.
 */
export const allowanceChargeRetencion = (
  comp: ComprobanteConRetencion,
  moneda: string,
) => {
  if (!esRetencion(comp)) return null;
  return {
    'cbc:ChargeIndicator': { _text: 'false' },
    'cbc:AllowanceChargeReasonCode': { _text: CODIGO_CARGO_RETENCION },
    'cbc:MultiplierFactorNumeric': {
      _text: Number((porcentajeRetenido(comp) / 100).toFixed(4)),
    },
    'cbc:Amount': {
      _attributes: { currencyID: moneda },
      _text: montoRetenido(comp),
    },
    'cbc:BaseAmount': {
      _attributes: { currencyID: moneda },
      _text: baseRetencion(comp),
    },
  };
};
