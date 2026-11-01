/**
 * Cliente HTTP de Evolution API v2 (github.com/EvolutionAPI/evolution-api,
 * conexión Baileys): el WhatsApp del negocio vinculado por QR a NUESTRO
 * servidor, sin cuenta externa (a diferencia de Takiy) y sin costo por mensaje.
 *
 * Verificado contra el código de la versión fijada (2.3.7) y la referencia
 * oficial (docs.evolutionfoundation.com.br/evolution-api):
 *   POST   /instance/create                    (llave global)
 *   GET    /instance/connect/{instancia}        → { pairingCode, code, base64, count }
 *   GET    /instance/connectionState/{inst}     → { instance: { state } }
 *   DELETE /instance/logout/{instancia}
 *   DELETE /instance/delete/{instancia}
 *   POST   /message/sendText/{instancia}        { number, text, delay }
 *   POST   /message/sendMedia/{instancia}       { number, mediatype, mimetype, media(URL), fileName, caption, delay }
 * Autenticación: header `apikey` (global o el token de la instancia).
 *
 * Diferencias con la documentación publicada (se siguió el código fuente):
 * - La referencia OpenAPI muestra `textMessage: { text }` en sendText (formato
 *   v1); el validador de 2.3.7 exige `text` en la raíz.
 * - La referencia de sendMedia solo muestra multipart; el router 2.3.7 acepta
 *   JSON con `media` como URL o base64 (`SendMediaDto`).
 * - `?number=` en /instance/connect (código de emparejamiento) no figura en la
 *   referencia: el router copia el query al DTO y `connectToWhatsapp(number)`
 *   lo usa SOLO si la sesión está cerrada; esperando el QR lo ignora
 *   (verificado contra 2.3.7). Por eso el código se pide en `crearInstancia`
 *   (`number` en create sí lo devuelve, verificado) y el servicio rehace la
 *   instancia cuando el dueño lo pide.
 * - `webhook.headers` al crear la instancia no figura en la referencia de
 *   create; está en `InstanceDto.webhook` y el WebhookController los envía en
 *   cada POST. Es la vía del secreto del webhook.
 *
 * Seguridad: la llave global y el token de instancia jamás van en mensajes de
 * error ni en logs; los errores se mapean a textos en español.
 */

export type EstadoEvolution = 'open' | 'close' | 'connecting' | 'refused';

export type CodigoErrorEvolution =
  | 'NO_AUTORIZADO'
  | 'NO_ENCONTRADA'
  | 'NUMERO_SIN_WHATSAPP'
  | 'SOLICITUD_INVALIDA'
  | 'TIMEOUT'
  | 'RED'
  | 'SERVIDOR'
  | 'RESPUESTA_INVALIDA';

export class EvolutionError extends Error {
  constructor(
    readonly codigo: CodigoErrorEvolution,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EvolutionError';
  }

  /**
   * ¿Puede que el mensaje haya salido igual? Con timeout o error del servidor
   * no se sabe: reintentarlo por otra vía podría duplicarlo al cliente.
   */
  get ambiguo(): boolean {
    return this.codigo === 'TIMEOUT' || this.codigo === 'SERVIDOR';
  }
}

export interface QrEvolution {
  /** data:image/png;base64,… listo para un <img>. */
  qr: string | null;
  codigoEmparejamiento: string | null;
  /** Solo cuando Evolution responde con el estado (sesión ya abierta). */
  estado: EstadoEvolution | null;
}

export interface WebhookEvolution {
  url: string;
  headers: Record<string, string>;
  events: string[];
}

export interface CrearInstanciaParams {
  instancia: string;
  token: string;
  webhook: WebhookEvolution;
  /** 51XXXXXXXXX: pide código de emparejamiento además del QR. */
  numero?: string;
}

export interface MediaEvolution {
  url: string;
  nombreArchivo?: string;
  caption?: string;
}

export interface ConfigEvolution {
  url: string;
  apiKey: string;
}

/** Eventos que Krezka necesita: estado de la sesión y QR nuevo. */
export const EVENTOS_WEBHOOK = ['CONNECTION_UPDATE', 'QRCODE_UPDATED'] as const;

/** Header con el que Evolution firma cada POST al webhook (ver docs). */
export const HEADER_SECRETO_WEBHOOK = 'x-krezka-webhook-secret';

const TIMEOUT_MS = 20_000;
/** `delay` de Evolution: muestra "escribiendo…" antes de mandar. */
export const DELAY_ESCRIBIENDO_MS = 1_200;

export class EvolutionClient {
  private readonly base: string;

  constructor(
    private readonly cfg: ConfigEvolution,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = TIMEOUT_MS,
  ) {
    this.base = cfg.url.replace(/\/+$/, '');
  }

  /** Crea la instancia Baileys con su token y el webhook firmado. */
  async crearInstancia(p: CrearInstanciaParams): Promise<QrEvolution> {
    const body: Record<string, unknown> = {
      instanceName: p.instancia,
      token: p.token,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      // Solo enviar: no leer chats, no marcar leídos, no sincronizar historial.
      groupsIgnore: true,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      alwaysOnline: false,
      rejectCall: false,
      webhook: {
        enabled: true,
        url: p.webhook.url,
        headers: p.webhook.headers,
        events: p.webhook.events,
        byEvents: false,
        base64: false,
      },
    };
    if (p.numero) body.number = p.numero;
    const data = await this.pedir(
      'POST',
      '/instance/create',
      this.cfg.apiKey,
      body,
    );
    return { ...leerQr(data?.qrcode), estado: null };
  }

  /**
   * Pide (o refresca) el QR. Con la sesión ya abierta Evolution devuelve el
   * estado en vez del QR: entonces `qr` y `codigoEmparejamiento` son null.
   */
  async conectar(
    instancia: string,
    apiKey: string,
    numero?: string,
  ): Promise<QrEvolution> {
    const q = numero ? `?number=${encodeURIComponent(numero)}` : '';
    const data = await this.pedir(
      'GET',
      `/instance/connect/${enc(instancia)}${q}`,
      apiKey,
    );
    if (data?.error)
      throw new EvolutionError(
        'SOLICITUD_INVALIDA',
        'Evolution no pudo generar el QR.',
      );
    return leerQr(data);
  }

  async estado(instancia: string, apiKey: string): Promise<EstadoEvolution> {
    const data = await this.pedir(
      'GET',
      `/instance/connectionState/${enc(instancia)}`,
      apiKey,
    );
    const estado = data?.instance?.state ?? data?.state;
    if (!['open', 'close', 'connecting', 'refused'].includes(estado))
      return 'close';
    return estado as EstadoEvolution;
  }

  async cerrarSesion(instancia: string, apiKey: string): Promise<void> {
    await this.pedir('DELETE', `/instance/logout/${enc(instancia)}`, apiKey);
  }

  /** Con la llave global: sirve aunque el token de la instancia se haya perdido. */
  async borrarInstancia(instancia: string): Promise<void> {
    await this.pedir(
      'DELETE',
      `/instance/delete/${enc(instancia)}`,
      this.cfg.apiKey,
    );
  }

  async enviarTexto(
    instancia: string,
    apiKey: string,
    numero: string,
    texto: string,
  ): Promise<void> {
    await this.pedir('POST', `/message/sendText/${enc(instancia)}`, apiKey, {
      number: numero,
      text: texto,
      delay: DELAY_ESCRIBIENDO_MS,
    });
  }

  async enviarMedia(
    instancia: string,
    apiKey: string,
    numero: string,
    m: MediaEvolution,
  ): Promise<void> {
    const tipo = tipoDeMedia(m.url, m.nombreArchivo);
    const body: Record<string, unknown> = {
      number: numero,
      mediatype: tipo.mediatype,
      mimetype: tipo.mimetype,
      media: m.url,
      delay: DELAY_ESCRIBIENDO_MS,
    };
    if (m.caption) body.caption = m.caption;
    if (tipo.mediatype === 'document')
      body.fileName = m.nombreArchivo || nombreDeUrl(m.url) || 'documento.pdf';
    await this.pedir(
      'POST',
      `/message/sendMedia/${enc(instancia)}`,
      apiKey,
      body,
    );
  }

  private async pedir(
    metodo: string,
    ruta: string,
    apiKey: string,
    body?: unknown,
  ): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${ruta}`, {
        method: metodo,
        headers: {
          apikey: apiKey,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new EvolutionError(
          'TIMEOUT',
          'El servidor de WhatsApp tardó demasiado en responder.',
        );
      }
      throw new EvolutionError(
        'RED',
        'No se pudo contactar al servidor de WhatsApp.',
      );
    }
    const data: any = await res.json().catch(() => null);
    if (res.ok) return data;
    throw errorDeRespuesta(res.status, data);
  }
}

/** Mapea la respuesta de error de Evolution a un error en español, sin secretos. */
export function errorDeRespuesta(status: number, data: any): EvolutionError {
  const detalle = mensajesDe(data);
  if (status === 401 || status === 403) {
    return new EvolutionError(
      'NO_AUTORIZADO',
      'El servidor de WhatsApp rechazó la credencial.',
      status,
    );
  }
  if (status === 404) {
    return new EvolutionError(
      'NO_ENCONTRADA',
      'La conexión de WhatsApp ya no existe en el servidor.',
      status,
    );
  }
  // sendText/sendMedia a un número sin WhatsApp: 400 con [{ exists: false, … }].
  if (sinWhatsapp(data)) {
    return new EvolutionError(
      'NUMERO_SIN_WHATSAPP',
      'Ese número no tiene WhatsApp.',
      status,
    );
  }
  if (status >= 500) {
    return new EvolutionError(
      'SERVIDOR',
      'El servidor de WhatsApp tuvo un error.',
      status,
    );
  }
  if (/connection closed|not connected|does not exist/i.test(detalle)) {
    return new EvolutionError(
      'NO_ENCONTRADA',
      'El WhatsApp del negocio no está conectado.',
      status,
    );
  }
  return new EvolutionError(
    'SOLICITUD_INVALIDA',
    'El servidor de WhatsApp no aceptó el pedido.',
    status,
  );
}

function mensajesDe(data: any): string {
  const m = data?.response?.message ?? data?.message ?? data?.error ?? '';
  try {
    return typeof m === 'string' ? m : JSON.stringify(m);
  } catch {
    return '';
  }
}

function sinWhatsapp(data: any): boolean {
  const m = data?.response?.message;
  return (
    Array.isArray(m) &&
    m.some((x: any) => x && typeof x === 'object' && x.exists === false)
  );
}

export function leerQr(q: any): QrEvolution {
  const base64 = typeof q?.base64 === 'string' && q.base64 ? q.base64 : null;
  const qr = base64
    ? base64.startsWith('data:')
      ? base64
      : `data:image/png;base64,${base64}`
    : null;
  const codigo =
    typeof q?.pairingCode === 'string' && q.pairingCode ? q.pairingCode : null;
  const st = q?.instance?.state ?? q?.instance?.status;
  const estado = ['open', 'close', 'connecting', 'refused'].includes(st)
    ? (st as EstadoEvolution)
    : null;
  return { qr, codigoEmparejamiento: codigo, estado };
}

const MIMES: Record<
  string,
  { mediatype: 'image' | 'document' | 'video'; mimetype: string }
> = {
  pdf: { mediatype: 'document', mimetype: 'application/pdf' },
  jpg: { mediatype: 'image', mimetype: 'image/jpeg' },
  jpeg: { mediatype: 'image', mimetype: 'image/jpeg' },
  png: { mediatype: 'image', mimetype: 'image/png' },
  webp: { mediatype: 'image', mimetype: 'image/webp' },
  mp4: { mediatype: 'video', mimetype: 'video/mp4' },
  xml: { mediatype: 'document', mimetype: 'application/xml' },
  xlsx: {
    mediatype: 'document',
    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
};

/** Tipo de adjunto por extensión (del nombre o de la URL). Por defecto, PDF. */
export function tipoDeMedia(url: string, nombre?: string) {
  const ext = (s?: string) =>
    (s ?? '').split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return MIMES[ext(nombre)] ?? MIMES[ext(url)] ?? MIMES.pdf;
}

function nombreDeUrl(url: string): string | null {
  try {
    const ultimo = new URL(url).pathname.split('/').pop();
    return ultimo ? decodeURIComponent(ultimo) : null;
  } catch {
    return null;
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}
