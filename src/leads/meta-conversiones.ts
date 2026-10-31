/**
 * API de Conversiones de Meta para mensajería (paso 2 de "qué anuncio trajo
 * cada venta", ver anuncio-origen.ts).
 *
 * Cuando alguien entra por un anuncio de clic a WhatsApp, Meta manda el id del
 * clic (`ctwa_clid`) y lo guardamos en LeadAnuncioOrigen. Aquí está la regla
 * para devolverle a Meta "ese clic terminó en compra" (o en un lead caliente):
 * con eso la campaña se puede optimizar por compras y no por conversaciones,
 * Meta busca gente parecida a la que compró y el negocio ve su ROAS real.
 *
 * Solo reglas puras; `MetaConversionesService` las aplica.
 */

/** Ventas que cuentan. Cotizaciones, pedidos, OT y notas de crédito no. */
export const TIPOS_VENTA = ['01', '03', 'NV', 'TICKET'];

/**
 * Meta rechaza eventos con más de 7 días. Es también la ventana de atribución
 * por clic que usa por defecto: una compra a los 20 días del anuncio ya no se
 * le atribuye y avisarla solo ensuciaría el aprendizaje.
 */
export const VENTANA_DIAS = 7;
export const VENTANA_MS = VENTANA_DIAS * 24 * 3600_000;

/** Después de tantos intentos fallidos, se deja de insistir. */
export const MAX_INTENTOS = 5;

export type EventoMeta = 'Purchase' | 'LeadSubmitted';

export interface Clic {
  ctwaClid: string | null;
  creadoEn: Date;
}

/**
 * El clic al que se atribuye algo que pasó en `fecha`: el último que hubo
 * antes, dentro de la ventana. Un clic posterior a la venta no la trajo.
 */
export function clicAtribuible(clics: Clic[], fecha: Date): Clic | null {
  const t = fecha.getTime();
  let mejor: Clic | null = null;
  for (const c of clics) {
    if (!c.ctwaClid) continue;
    const tc = c.creadoEn.getTime();
    if (tc > t || t - tc > VENTANA_MS) continue;
    if (!mejor || tc > mejor.creadoEn.getTime()) mejor = c;
  }
  return mejor;
}

/**
 * Clave de la venta. Una nota que después se convierte en boleta es UNA sola
 * venta: la boleta hereda la clave de su nota, así no se avisa dos veces.
 */
export function claveDeVenta(c: { id: number; tipoDoc: string; comprobanteOrigenId?: number | null }): string {
  const raiz = ['01', '03'].includes(c.tipoDoc) && c.comprobanteOrigenId ? c.comprobanteOrigenId : c.id;
  return `venta-${raiz}`;
}

export const claveDeLead = (conversacionId: number) => `lead-${conversacionId}`;

/** Últimos 9 dígitos de un celular, para cruzar el cliente con el chat. */
export function celular9(v: string | null | undefined): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}

/**
 * DNI que sirve para reconocer a una persona: 8 dígitos y no uno genérico
 * ("00000000" de Clientes varios o de "Convertir a cliente").
 */
export function dniUtil(v: string | null | undefined): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 8 && !/^(\d)\1{7}$/.test(d) ? d : null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** El cuerpo que espera `POST /{dataset_id}/events`. */
export function armarEvento(p: {
  evento: EventoMeta;
  clave: string;
  fecha: Date;
  wabaId: string;
  ctwaClid: string;
  valor?: number;
  moneda?: string;
}) {
  return {
    event_name: p.evento,
    // Meta exige segundos y no acepta fechas futuras ni de más de 7 días.
    event_time: Math.floor(p.fecha.getTime() / 1000),
    // Si el mismo evento llega dos veces (reintento), Meta lo cuenta una.
    event_id: p.clave,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      whatsapp_business_account_id: p.wabaId,
      ctwa_clid: p.ctwaClid,
    },
    ...(p.evento === 'Purchase'
      ? { custom_data: { currency: (p.moneda || 'PEN').toUpperCase(), value: r2(p.valor ?? 0) } }
      : {}),
  };
}

/** El mensaje de error de Meta, en corto y entendible. */
export function errorDeMeta(e: any): string {
  const err = e?.response?.data?.error;
  const msg = err?.error_user_msg || err?.message || e?.message || String(e);
  // 200/10 = falta permiso: es lo primero que va a pasar hasta que Meta
  // apruebe whatsapp_business_manage_events.
  if (err?.code === 200 || err?.code === 10 || /permission/i.test(String(err?.message))) {
    return `Meta no dio permiso para enviar eventos (whatsapp_business_manage_events): ${msg}`;
  }
  return String(msg).slice(0, 500);
}

/** Lo que contestó Meta al último envío, para mostrarlo en el panel. */
export interface RespuestaMeta {
  en: string;
  enviados: number;
  /** `events_received`: cuántos registró Meta. null si no lo dijo. */
  recibidos: number | null;
  /** Avisos que Meta devuelve aunque responda 200 (`messages`). */
  avisos: string[];
  /** Código de seguimiento de Meta, para pedirle soporte. */
  fbtraceId: string | null;
  prueba: boolean;
}

/**
 * Meta puede responder 200 y aun así no registrar el evento: lo dice en
 * `events_received` y en `messages`. Antes solo se miraba el código HTTP, así
 * que el panel decía "Avisado" sin saber si Meta lo había contado (30-10: la
 * compra de prueba no apareció en el Administrador de eventos y no había cómo
 * saber por qué).
 */
export function respuestaDeMeta(data: any, enviados: number, prueba: boolean, ahora = new Date()): RespuestaMeta {
  const n = Number(data?.events_received);
  const avisos = Array.isArray(data?.messages)
    ? data.messages.map((m: unknown) => (typeof m === 'string' ? m : JSON.stringify(m))).slice(0, 5)
    : [];
  return {
    en: ahora.toISOString(),
    enviados,
    recibidos: Number.isFinite(n) ? n : null,
    avisos,
    fbtraceId: typeof data?.fbtrace_id === 'string' ? data.fbtrace_id : null,
    prueba,
  };
}

/** Meta dijo cuántos recibió y fueron menos de los que se mandaron. */
export const metaNoLosRegistro = (r: RespuestaMeta): boolean => r.recibidos !== null && r.recibidos < r.enviados;
