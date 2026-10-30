/**
 * Chat de la tienda online (canal WEB de la IA de Ventas).
 *
 * El cliente que navega la tienda le escribe al mismo vendedor que atiende el
 * WhatsApp del negocio. La conversación se guarda como cualquier otra, con el
 * destino `web:<sesión>` (igual que `ig:`/`fb:` para Instagram y Messenger),
 * y lo que el vendedor "envía" queda en LeadWebSalida para que el chat lo lea.
 *
 * Aquí viven las reglas puras; `ChatWebService` las aplica.
 */

export const PREFIJO_WEB = 'web:';

export const esDestinoWeb = (destino: string | null | undefined) =>
  String(destino ?? '').startsWith(PREFIJO_WEB);

/** La sesión la genera el navegador (un UUID): solo letras, números y guiones. */
export function sesionValida(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[a-z0-9-]{16,64}$/.test(s) ? s : null;
}

export const MAX_TEXTO = 1000;

/** Texto del cliente, limpio y con tope: es un endpoint público. */
export function textoValido(v: unknown): string | null {
  const t = String(v ?? '')
    // Caracteres de control fuera, menos saltos de línea.
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_TEXTO);
  return t || null;
}

/** El producto que estaba mirando, tal como le llega a la IA y a la bandeja. */
export function contextoDeProducto(p: { descripcion: string; precioUnitario: unknown; moneda?: string | null }): string {
  const simbolo = p.moneda === 'USD' ? 'US$' : 'S/';
  return `Está viendo en la tienda: ${p.descripcion} — ${simbolo}${Number(p.precioUnitario ?? 0).toFixed(2)}`;
}

/** El mensaje del cliente sin la nota de contexto que se le pegó al guardarlo. */
export const sinContexto = (contenido: string) => contenido.replace(/\n\n\[Está viendo en la tienda:[^\]]*\]$/, '');

/**
 * Tope de mensajes por ventana: el chat es público y cada mensaje cuesta una
 * llamada a la IA. Alcanza de sobra para una persona escribiendo; corta un
 * script que golpee la API.
 */
export const LIMITES = {
  porSesionMinuto: 12,
  porIpMinuto: 30,
  porSesionDia: 150,
};

export class Limitador {
  private golpes = new Map<string, number[]>();

  /** true si todavía puede; si puede, cuenta el golpe. */
  permitir(clave: string, max: number, ventanaMs: number, ahora = Date.now()): boolean {
    const desde = ahora - ventanaMs;
    const lista = (this.golpes.get(clave) ?? []).filter((t) => t > desde);
    if (lista.length >= max) {
      this.golpes.set(clave, lista);
      return false;
    }
    lista.push(ahora);
    this.golpes.set(clave, lista);
    // Que el mapa no crezca sin fin con sesiones que ya se fueron.
    if (this.golpes.size > 20_000) {
      for (const [k, v] of this.golpes) if (!v.some((t) => t > desde)) this.golpes.delete(k);
    }
    return true;
  }
}

export interface ItemChat {
  id: string;
  de: 'cliente' | 'tienda';
  tipo: string;
  texto: string | null;
  url: string | null;
  productoId: number | null;
  opciones: { id: string; titulo: string; descripcion?: string }[] | null;
  /** El id que generó el navegador para su mensaje: así no lo pinta dos veces. */
  clienteId: string | null;
  creadoEn: Date;
}

/** Historial del chat: lo que escribió el cliente + lo que le "llegó". */
export function armarHistorial(
  usuario: { id: number; contenido: string; whatsappMsgId: string | null; creadoEn: Date }[],
  salidas: {
    id: number;
    tipo: string;
    texto: string | null;
    url: string | null;
    productoId: number | null;
    opcionesJson: unknown;
    creadoEn: Date;
  }[],
): ItemChat[] {
  const items: ItemChat[] = [
    ...usuario.map((m) => ({
      id: `u${m.id}`,
      de: 'cliente' as const,
      tipo: 'TEXTO',
      texto: sinContexto(m.contenido),
      url: null,
      productoId: null,
      opciones: null,
      clienteId: m.whatsappMsgId?.split(':').pop() ?? null,
      creadoEn: m.creadoEn,
    })),
    ...salidas.map((s) => ({
      id: `s${s.id}`,
      de: 'tienda' as const,
      tipo: s.tipo,
      texto: s.texto,
      url: s.url,
      productoId: s.productoId,
      opciones: Array.isArray(s.opcionesJson) ? (s.opcionesJson as ItemChat['opciones']) : null,
      clienteId: null,
      creadoEn: s.creadoEn,
    })),
  ];
  return items.sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime() || a.id.localeCompare(b.id));
}

/**
 * ¿Mostrar "escribiendo…"? Si el cliente escribió después de la última
 * respuesta guardada (de la IA o de una persona), hace poco, y la IA va a
 * contestar. Se mira la respuesta guardada y no lo que llegó al chat: la IA
 * puede mandar primero una foto y el texto unos segundos después.
 */
export function estaEscribiendo(
  ultimoDelCliente: Date | null,
  ultimaRespuesta: Date | null,
  iaVaAResponder: boolean,
  ahora = Date.now(),
): boolean {
  if (!iaVaAResponder || !ultimoDelCliente) return false;
  if (ultimaRespuesta && ultimaRespuesta.getTime() >= ultimoDelCliente.getTime()) return false;
  return ahora - ultimoDelCliente.getTime() < 90_000;
}
