/**
 * El comprobante interno, contado como lo espera el integrador.
 *
 * Es la mitad de vuelta de `fachada.ts`, y tiene una regla que vale más que
 * la traducción en sí: **se publica campo por campo, nunca el objeto entero**.
 * Un `...comprobante` acá filtraría costos, márgenes, el id del usuario que lo
 * emitió, los datos de la caja y las credenciales PSE de la empresa — y lo
 * haría en silencio, cada vez que alguien agregue una columna al modelo. Lo
 * que no está escrito abajo no sale.
 *
 * Por la misma razón el id que viaja es `apiPublicId` y no el numérico: el
 * interno es secuencial, así que delataría cuántos comprobantes procesa
 * Krezka y dejaría sondear los de otro integrador cambiando un dígito.
 */
import { randomBytes } from 'crypto';
import {
  EstadoPublico,
  cdrDisponible,
  codigoDelCdr,
  estadoPublico,
} from './estado-publico';

/**
 * Catálogo 01 de SUNAT, de vuelta al nombre público.
 *
 * Las notas van acá y no en un mapa aparte: olvidarlas hacía que
 * `serializarComprobante` devolviera null para un `07` y la nota saliera sin
 * `id`, con el resto de los campos puestos a mano por encima. Lo encontró la
 * QA funcional.
 */
const TIPO_PUBLICO: Record<string, string> = {
  '01': 'invoice',
  '03': 'receipt',
  '07': 'credit_note',
  '08': 'debit_note',
};

/** El `object` que lleva cada uno en la respuesta. */
const OBJETO_PUBLICO: Record<string, string> = {
  '01': 'invoice',
  '03': 'invoice',
  '07': 'credit_note',
  '08': 'debit_note',
};

/** Catálogo 07, de vuelta. */
const AFECTACION_PUBLICA: Record<string, string> = {
  '10': 'taxed',
  '20': 'exempt',
  '30': 'unaffected',
  '40': 'export',
};

/** Catálogo 06, de vuelta. */
const DOC_CLIENTE_PUBLICO: Record<string, string> = {
  '6': 'ruc',
  '1': 'dni',
  '4': 'ce',
  '7': 'passport',
  '0': 'other',
};

/**
 * Un id opaco e impredecible.
 *
 * 9 bytes de `randomBytes` son 72 bits: adivinar uno por fuerza bruta no es
 * viable, que es justo lo que no se puede decir del id secuencial.
 */
export const nuevoIdPublico = (prefijo = 'inv'): string =>
  `${prefijo}_${randomBytes(9).toString('base64url')}`;

const dinero = (n: unknown): number =>
  Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/** Solo la fecha: `issue_date` es un día, no un instante. */
const soloFecha = (d: unknown): string | undefined =>
  d instanceof Date ? d.toISOString().slice(0, 10) : undefined;

const instante = (d: unknown): string | undefined =>
  d instanceof Date ? d.toISOString() : undefined;

export interface ComprobanteInterno {
  id: number;
  apiPublicId?: string | null;
  tipoDoc: string;
  serie: string;
  correlativo: number;
  // Siempre viene: en el esquema tiene `@default(PENDIENTE)`.
  estadoEnvioSunat: string | null;
  sunatCdrResponse?: unknown;
  sunatCdrZip?: string | null;
  s3CdrUrl?: string | null;
  sunatXml?: string | null;
  s3XmlUrl?: string | null;
  fechaEmision?: Date | null;
  tipoMoneda?: string | null;
  tipoCambio?: number | null;
  mtoOperGravadas?: number | null;
  mtoOperExoneradas?: number | null;
  mtoOperInafectas?: number | null;
  mtoOperExportacion?: number | null;
  mtoDescuentoGlobal?: number | null;
  mtoIGV?: number | null;
  mtoImpVenta?: number | null;
  observaciones?: string | null;
  ordenCompraCliente?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  cliente?: {
    nombre?: string | null;
    nroDoc?: string | null;
    email?: string | null;
    direccion?: string | null;
    tipoDocumento?: { codigo?: string | null } | null;
  } | null;
  detalles?: Array<{
    descripcion?: string | null;
    cantidad?: number | null;
    unidad?: string | null;
    mtoValorUnitario?: number | null;
    mtoDescuento?: number | null;
    tipAfeIgv?: number | null;
    igv?: number | null;
  }> | null;
}

/** El número tal como figura ante SUNAT: `F001-00001234`. */
export const numeroCompleto = (serie: string, correlativo: number): string =>
  `${serie}-${String(correlativo).padStart(8, '0')}`;

/**
 * Lo que SUNAT contestó.
 *
 * `cdr_available` se calcula y no se asume: prometer una descarga que va a
 * dar 404 le hace perder más tiempo al integrador que decirle que todavía no
 * está.
 */
export const serializarSunat = (
  c: ComprobanteInterno,
  estado: EstadoPublico | null,
) => {
  const cdr: any = (() => {
    const v = c.sunatCdrResponse;
    if (typeof v !== 'string') return typeof v === 'object' ? v : null;
    const t = v.trim();
    if (!t.startsWith('{')) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  })();
  const tieneCdr = Boolean(c.sunatCdrZip || c.s3CdrUrl);
  return {
    response_code: codigoDelCdr(c.sunatCdrResponse) ?? undefined,
    response_message: cdr?.message ?? cdr?.description ?? undefined,
    cdr_available: cdrDisponible(estado, tieneCdr),
  };
};

/**
 * El comprobante completo en su forma pública.
 *
 * Devuelve `null` cuando el documento no es un comprobante electrónico (una
 * nota de venta, por ejemplo): esos no se publican, y confundirlos con algo
 * que tiene valor tributario sería peor que no devolverlos.
 */
export const serializarComprobante = (
  c: ComprobanteInterno,
  issuerId: string,
): Record<string, unknown> | null => {
  const estado = estadoPublico(c);
  if (estado === null) return null;

  const tipo = TIPO_PUBLICO[c.tipoDoc];
  if (!tipo) return null;

  return {
    id: c.apiPublicId,
    object: OBJETO_PUBLICO[c.tipoDoc] ?? 'invoice',
    issuer_id: issuerId,
    document_type: tipo,
    series: c.serie,
    number: c.correlativo,
    full_number: numeroCompleto(c.serie, c.correlativo),
    status: estado,
    issue_date: soloFecha(c.fechaEmision),
    currency: c.tipoMoneda ?? 'PEN',
    exchange_rate: c.tipoMoneda === 'USD' ? (c.tipoCambio ?? undefined) : undefined,
    customer: c.cliente
      ? {
          document_type:
            DOC_CLIENTE_PUBLICO[String(c.cliente.tipoDocumento?.codigo ?? '')] ??
            'other',
          document_number: c.cliente.nroDoc ?? undefined,
          name: c.cliente.nombre ?? undefined,
          email: c.cliente.email ?? undefined,
          address: c.cliente.direccion ?? undefined,
        }
      : undefined,
    items: (c.detalles ?? []).map((d) => ({
      description: d.descripcion ?? '',
      quantity: Number(d.cantidad) || 0,
      unit: d.unidad ?? 'NIU',
      unit_value: dinero(d.mtoValorUnitario),
      discount: dinero(d.mtoDescuento),
      tax_affectation: AFECTACION_PUBLICA[String(d.tipAfeIgv ?? '10')] ?? 'taxed',
      tax: dinero(d.igv),
    })),
    totals: {
      taxable: dinero(c.mtoOperGravadas),
      exempt: dinero(c.mtoOperExoneradas),
      unaffected: dinero(c.mtoOperInafectas),
      export: dinero(c.mtoOperExportacion),
      discount: dinero(c.mtoDescuentoGlobal),
      tax: dinero(c.mtoIGV),
      total: dinero(c.mtoImpVenta),
    },
    sunat: serializarSunat(c, estado),
    files: {
      xml: Boolean(c.sunatXml || c.s3XmlUrl),
      cdr: cdrDisponible(estado, Boolean(c.sunatCdrZip || c.s3CdrUrl)),
      pdf: true, // se genera a demanda
    },
    purchase_order: c.ordenCompraCliente ?? undefined,
    notes: c.observaciones ?? undefined,
    created_at: instante(c.createdAt),
    updated_at: instante(c.updatedAt),
  };
};
