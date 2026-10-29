/**
 * Takiy (takiy.space): WhatsApp vinculado por QR al número del negocio.
 *
 * No es la API oficial de Meta: Takiy mantiene abierta una sesión tipo
 * WhatsApp Web del celular del negocio. Por eso no pide plantillas aprobadas
 * ni cobra por mensaje, y el mensaje le llega al cliente desde el número de
 * siempre del negocio. El costo es que, si el celular se desvincula, el envío
 * falla hasta que vuelvan a escanear el QR en Takiy.
 *
 * Una sola llamada: POST /api/create-message con appkey, authkey, to y
 * message; `file` (URL pública) adjunta un documento o imagen.
 */

export const TAKIY_URL = 'https://takiy.space/api/create-message';

export interface CredencialesTakiy {
  appKey: string;
  authKey: string;
}

export interface ResultadoTakiy {
  success: boolean;
  error?: string;
}

/** 9 dígitos peruanos → 51XXXXXXXXX; con el 51 puesto no se duplica. */
export function numeroTakiy(numero: string): string {
  const digitos = String(numero || '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
  return digitos.length === 9 ? `51${digitos}` : digitos;
}

export async function enviarTakiy(
  cred: CredencialesTakiy,
  params: { numero: string; mensaje: string; archivoUrl?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoTakiy> {
  const to = numeroTakiy(params.numero);
  if (to.length < 10)
    return { success: false, error: `Número inválido: ${params.numero}` };

  const body = new URLSearchParams({
    appkey: cred.appKey,
    authkey: cred.authKey,
    to,
    message: params.mensaje,
  });
  if (params.archivoUrl) body.set('file', params.archivoUrl);

  try {
    const res = await fetchImpl(TAKIY_URL, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const data: any = await res.json().catch(() => null);
    // Éxito: { message_status: 'Success', data: { from, to, status_code: 200 } }.
    if (res.ok && String(data?.message_status).toLowerCase() === 'success') {
      return { success: true };
    }
    return { success: false, error: errorTakiy(data, res.status) };
  } catch (e: any) {
    return { success: false, error: `Takiy no respondió: ${e?.message ?? e}` };
  }
}

function errorTakiy(data: any, status: number): string {
  if (
    data?.data &&
    typeof data.data === 'object' &&
    !Array.isArray(data.data)
  ) {
    const campos = Object.values(data.data)
      .flat()
      .filter((v) => typeof v === 'string');
    if (campos.length) return `Takiy: ${campos.join(' ')}`;
  }
  return `Takiy: ${data?.message || data?.error || `HTTP ${status}`}`;
}
