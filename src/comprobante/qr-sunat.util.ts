import * as QRCode from 'qrcode';

/**
 * QR de SUNAT al pie del comprobante impreso.
 *
 * Nada que ver con `fc.qrPagos` (el QR de Yape/Plin del formato): este es el
 * del comprobante electrónico. Se activa por empresa con `mostrarQrSunat`.
 *
 * Contenido, en este orden de preferencia:
 *  1. La URL del PDF del comprobante (`s3PdfUrl`) — el cliente escanea y ve su
 *     comprobante en el celular, que es para lo que el empresario lo pide.
 *  2. Si el PDF todavía no existe (recién emitido, o aún en cola de SUNAT), la
 *     cadena normativa de SUNAT, que es lo que exige la representación impresa.
 */

/** Tipos de comprobante electrónico que llevan QR de SUNAT. */
const TIPOS_CON_QR_SUNAT = new Set(['01', '03', '07', '08']);

export function tipoDocLlevaQrSunat(tipoDoc?: string | null): boolean {
  return TIPOS_CON_QR_SUNAT.has(String(tipoDoc ?? '').trim());
}

/** `dd/mm/aaaa` a partir de la fecha de emisión. */
function formatearFecha(fecha: any): string {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Cadena normativa del QR de SUNAT, separada por pipes:
 * `RUC|tipoDoc|serie|correlativo|IGV|total|fechaEmisión|tipoDocCliente|nroDocCliente|`
 */
export function construirCadenaQrSunat(comp: any, empresa: any): string {
  const campos = [
    String(empresa?.ruc ?? ''),
    String(comp?.tipoDoc ?? ''),
    String(comp?.serie ?? ''),
    String(comp?.correlativo ?? ''),
    Number(comp?.mtoIGV ?? 0).toFixed(2),
    Number(comp?.mtoImpVenta ?? 0).toFixed(2),
    formatearFecha(comp?.fechaEmision),
    // Código SUNAT del tipo de documento del cliente (1 = DNI, 6 = RUC).
    String(comp?.cliente?.tipoDocumento?.codigo ?? ''),
    String(comp?.cliente?.nroDoc ?? ''),
  ];
  // La cadena termina en pipe, tal como la define SUNAT.
  return `${campos.join('|')}|`;
}

/**
 * Contenido a codificar: el PDF en línea si ya existe, si no la cadena SUNAT.
 * Devuelve `null` cuando el documento no es un comprobante electrónico.
 */
export function resolverContenidoQrSunat(
  comp: any,
  empresa: any,
): string | null {
  if (!tipoDocLlevaQrSunat(comp?.tipoDoc)) return null;
  const pdfUrl = String(comp?.s3PdfUrl ?? '').trim();
  if (pdfUrl) return pdfUrl;
  return construirCadenaQrSunat(comp, empresa);
}

/**
 * Genera el QR como data URL PNG para incrustarlo en el PDF. Devuelve
 * `undefined` si la empresa no lo activó, si el documento no lleva QR o si la
 * generación falla — nunca rompe la emisión del comprobante por un QR.
 */
export async function generarQrSunatDataUrl(
  comp: any,
  empresa: any,
): Promise<string | undefined> {
  if (empresa?.mostrarQrSunat !== true) return undefined;
  const contenido = resolverContenidoQrSunat(comp, empresa);
  if (!contenido) return undefined;
  try {
    return await QRCode.toDataURL(contenido, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    });
  } catch {
    return undefined;
  }
}
