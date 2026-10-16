/**
 * El estado de un comprobante, traducido al que ve el integrador.
 *
 * Adentro hay nueve estados que nacieron para la pantalla del empresario; el
 * contrato público expone ocho, y la traducción no es cosmética: de ella
 * depende qué hace el integrador después. Equivocarse acá no se ve en una
 * prueba, se ve cuando alguien emite dos veces el mismo comprobante.
 *
 * Las tres decisiones que importan, todas medidas contra la base real:
 *
 *  1. `PENDIENTE_CONCILIACION` —118 comprobantes, todos con CDR 1033 "ya
 *     registrado"— no cabía en ninguno de los siete estados que se publicaron
 *     primero. SUNAT dice que el documento existe pero no devuelve el CDR.
 *     `accepted` sería mentira: no hay CDR que descargar. `sent` deja al
 *     integrador consultando para siempre. Y `rejected` es el peor de los
 *     tres, porque lo correcto frente a un rechazo es corregir y volver a
 *     emitir — contra un documento que SUNAT YA TIENE. Por eso existe
 *     `reconciling`: el único estado que dice "no vuelvas a emitir".
 *
 *  2. Un CDR 4xxx es una OBSERVACIÓN, no un rechazo: el comprobante quedó
 *     aceptado y es válido. Se expone como `observed` y no como `rejected`
 *     para que nadie lo reemita.
 *
 *  3. `FALLIDO_ENVIO` no llegó a SUNAT y el sistema lo reintenta solo. Para el
 *     integrador eso es `pending`, no un error: no tiene nada que hacer.
 *
 * `NO_APLICA` —12,793 filas, el estado más común— son documentos internos
 * (notas de venta) que nunca van a SUNAT. No se emiten por esta API y no
 * tienen traducción: devolverlos como si fueran comprobantes electrónicos
 * confundiría al integrador sobre qué tiene valor tributario.
 */

/** Lo que el contrato publica. Cualquier cambio acá es un cambio de versión. */
export type EstadoPublico =
  | 'pending'
  | 'sent'
  | 'accepted'
  | 'observed'
  | 'rejected'
  | 'reconciling'
  | 'voiding'
  | 'voided';

/** Los estados en los que ya no va a pasar nada más por sí solo. */
export const ESTADOS_FINALES: ReadonlySet<EstadoPublico> = new Set<EstadoPublico>([
  'accepted',
  'observed',
  'rejected',
  'voided',
]);

export const esFinal = (estado: EstadoPublico): boolean =>
  ESTADOS_FINALES.has(estado);

/**
 * El código de respuesta del CDR, si la respuesta guardada lo trae.
 *
 * Lo guardado es texto: a veces el JSON del proveedor, a veces un mensaje
 * suelto de cuando el envío ni siquiera llegó a armar una respuesta. Se lee
 * defensivamente porque un `JSON.parse` que revienta acá tumbaría la consulta
 * de estado de un comprobante que por lo demás está perfecto.
 */
export const codigoDelCdr = (cdr: unknown): string | null => {
  if (!cdr) return null;
  let objeto: any = cdr;
  if (typeof cdr === 'string') {
    const texto = cdr.trim();
    if (!texto.startsWith('{')) return null;
    try {
      objeto = JSON.parse(texto);
    } catch {
      return null;
    }
  }
  if (typeof objeto !== 'object' || objeto === null) return null;
  const code = objeto.code ?? objeto.codigo ?? null;
  if (code === null || code === undefined) return null;
  const texto = String(code).trim();
  return texto === '' || texto === 'null' || texto === 'undefined'
    ? null
    : texto;
};

/**
 * ¿Es un código de OBSERVACIÓN (4xxx del Anexo VIII)?
 *
 * Importa que sea exactamente el rango 4000-4999: el comprobante quedó
 * aceptado y es válido, solo que SUNAT le anotó algo. Tratarlo como rechazo
 * haría que el integrador reemita un documento que ya tiene valor tributario.
 */
export const esObservacion = (codigo: string | null): boolean =>
  codigo !== null && /^4\d{3}$/.test(codigo.trim());

export interface ComprobanteParaEstado {
  estadoEnvioSunat: string | null | undefined;
  sunatCdrResponse?: unknown;
}

/**
 * La traducción. `null` significa "este documento no se expone por la API":
 * no es un error, es que no es un comprobante electrónico.
 */
export const estadoPublico = (
  comprobante: ComprobanteParaEstado,
): EstadoPublico | null => {
  switch (comprobante.estadoEnvioSunat) {
    case 'PENDIENTE':
    // No llegó a SUNAT y el scheduler lo reintenta solo. El integrador no
    // tiene nada que hacer: para él sigue en camino.
    case 'FALLIDO_ENVIO':
      return 'pending';

    case 'ENVIADO':
      return 'sent';

    case 'EMITIDO': {
      // Un 4xxx es observación: aceptado, pero con anotaciones de SUNAT.
      return esObservacion(codigoDelCdr(comprobante.sunatCdrResponse))
        ? 'observed'
        : 'accepted';
    }

    case 'RECHAZADO':
      return 'rejected';

    // SUNAT lo da por registrado pero no entrega el CDR. No se reemite.
    case 'PENDIENTE_CONCILIACION':
      return 'reconciling';

    case 'ANULADO':
      return 'voided';

    // Notas de venta y documentos internos: no van a SUNAT, no se publican.
    case 'NO_APLICA':
    case 'REGISTRADO':
      return null;

    default:
      return null;
  }
};

/**
 * ¿Se puede descargar el CDR?
 *
 * Solo cuando SUNAT lo devolvió de verdad. En `reconciling` el comprobante
 * existe para SUNAT pero el CDR no está en nuestras manos, y prometer una
 * descarga que va a dar 404 es peor que decir que todavía no está.
 */
export const cdrDisponible = (
  estado: EstadoPublico | null,
  tieneCdrGuardado: boolean,
): boolean =>
  tieneCdrGuardado &&
  (estado === 'accepted' || estado === 'observed' || estado === 'voided');
