import * as QRCode from 'qrcode';

/**
 * QR de SUNAT para la Guía de Remisión Electrónica (GRE).
 *
 * A diferencia de Factura/Boleta (donde el contenido es la cadena normativa
 * `RUC|tipo|serie|...`), para la GRE es SUNAT quien entrega el contenido del
 * QR: cuando acepta la guía, el CDR (ApplicationResponse) trae en
 * `cbc:DocumentDescription` la URL oficial de consulta
 * `https://e-factura.sunat.gob.pe/v1/contribuyente/gre/comprobantes/descargaqr?hashqr=...`
 * Ese QR es el que sustenta el traslado ante el fiscalizador (R.S. 000123-2022),
 * por eso no hay fallback: sin CDR aceptado no hay QR.
 */

/** URL oficial de producción. */
const PATRON_URL_QR_GRE =
  /https:\/\/e-factura\.sunat\.gob\.pe\/v1\/contribuyente\/gre\/comprobantes\/descargaqr\?hashqr=[^<"'\s]+/i;
/**
 * Lo que SUNAT deja en `cbc:DocumentDescription` del CDR. En el sandbox
 * (QPSE demo / beta) la URL es de prueba (`https://url-test?hashqr=test`), por
 * eso se acepta cualquier URL con `hashqr=` dentro de ese elemento.
 */
const PATRON_DOCUMENT_DESCRIPTION =
  /<cbc:DocumentDescription[^>]*>\s*(https?:\/\/[^<\s]*hashqr=[^<\s]*)\s*<\/cbc:DocumentDescription>/i;

function decodificarXmlEntidades(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buscarUrlEnTexto(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = String(texto);
  const enElemento = t.match(PATRON_DOCUMENT_DESCRIPTION);
  if (enElemento) return decodificarXmlEntidades(enElemento[1].trim());
  const m = t.match(PATRON_URL_QR_GRE);
  return m ? decodificarXmlEntidades(m[0]) : null;
}

function base64AUtf8(b64: string): string | null {
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Busca la URL del QR en lo que la guía tiene guardado del CDR, en este orden:
 *  1. `sunatCdrZip`: el XML del CDR en base64 (así lo devuelve QPSE en `cdr`).
 *  2. `sunatCdrResponse`: la respuesta JSON del proveedor; puede traer el CDR
 *     en base64 en `cdr` o la URL directamente en algún campo.
 * Devuelve `null` si la guía aún no tiene CDR aceptado.
 */
export function extraerUrlQrGre(guia: {
  sunatCdrZip?: string | null;
  sunatCdrResponse?: string | null;
}): string | null {
  const zip = String(guia?.sunatCdrZip ?? '').trim();
  if (zip) {
    // Puede venir como XML plano o como base64 del XML.
    const directo = buscarUrlEnTexto(zip);
    if (directo) return directo;
    const decodificado = base64AUtf8(zip);
    const enXml = buscarUrlEnTexto(decodificado);
    if (enXml) return enXml;
  }

  const resp = String(guia?.sunatCdrResponse ?? '').trim();
  if (resp) {
    const directo = buscarUrlEnTexto(resp);
    if (directo) return directo;
    try {
      const json = JSON.parse(resp) as { cdr?: unknown };
      const cdrB64 = typeof json?.cdr === 'string' ? json.cdr : null;
      if (cdrB64) {
        const enXml = buscarUrlEnTexto(base64AUtf8(cdrB64));
        if (enXml) return enXml;
      }
    } catch {
      // no era JSON: ya se buscó como texto
    }
  }
  return null;
}

/**
 * Genera el QR de la GRE como data URL PNG para el PDF. `undefined` si la guía
 * no tiene aún el QR de SUNAT o si la generación falla — nunca rompe el PDF.
 */
export async function generarQrGreDataUrl(guia: {
  sunatCdrZip?: string | null;
  sunatCdrResponse?: string | null;
}): Promise<string | undefined> {
  const url = extraerUrlQrGre(guia);
  if (!url) return undefined;
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    });
  } catch {
    return undefined;
  }
}
