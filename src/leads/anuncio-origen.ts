/**
 * De qué anuncio llegó cada cliente, y cuánto vendió cada anuncio.
 *
 * Cuando alguien toca un anuncio de Facebook o Instagram con botón de
 * WhatsApp, Meta pega en su primer mensaje la etiqueta `referral` con el id
 * del anuncio, su título y el id del clic. Hasta el 2026-10-21 se descartaba:
 * el negocio pagaba publicidad sin saber cuál le traía ventas.
 *
 * Esta parte no toca la base: lee la etiqueta y reparte las ventas.
 */

/** La etiqueta tal como llega en el mensaje de WhatsApp. */
export interface ReferralWhatsapp {
  source_id?: string;
  source_type?: string;
  source_url?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  thumbnail_url?: string;
  video_url?: string;
  ctwa_clid?: string;
}

export interface OrigenAnuncio {
  anuncioId: string;
  tipo: string | null;
  titulo: string | null;
  texto: string | null;
  url: string | null;
  imagenUrl: string | null;
  ctwaClid: string | null;
}

const texto = (v: unknown, max: number): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t.slice(0, max) : null;
};

/**
 * La etiqueta, limpia. Sin id de anuncio ni enlace no hay con qué agruparla
 * y se descarta: una fila "anuncio desconocido" no le dice nada al negocio.
 */
export function origenDeAnuncio(r: ReferralWhatsapp | null | undefined): OrigenAnuncio | null {
  if (!r || typeof r !== 'object') return null;
  const anuncioId = texto(r.source_id, 100) ?? texto(r.source_url, 500);
  if (!anuncioId) return null;
  return {
    anuncioId,
    tipo: texto(r.source_type, 20),
    titulo: texto(r.headline, 300),
    texto: texto(r.body, 1000),
    url: texto(r.source_url, 500),
    imagenUrl: texto(r.image_url, 1000) ?? texto(r.thumbnail_url, 1000),
    ctwaClid: texto(r.ctwa_clid, 300),
  };
}

/** Lo que se guarda como "anuncio" cuando el cliente llegó desde TikTok. */
export const ORIGEN_TIKTOK = 'tiktok';

/**
 * El cliente dice que viene de TikTok. TikTok no pega una etiqueta como la de
 * Meta: ni su anuncio de mensajes a WhatsApp ni el enlace del perfil. Lo que sí
 * llega es el texto que viene escrito ("Hola, vengo de TikTok"), así que se
 * reconoce por el texto. Solo frases de llegada: "¿tienen TikTok?" no cuenta.
 * Los bordes de palabra van a mano: `\b` no ve el final de "enteré".
 */
const LLEGADA_TIKTOK =
  /(?<![\wáéíóúñ])(vengo|vine|llegu[eé]|desde|vi|vimos|visto|enter[eé]|encontr[eé]|anuncio|video|v[ií]deo|publicaci[oó]n|live|perfil)(?![\wáéíóúñ])[^.?!\n]{0,25}\btik\s?tok\b/i;

export function origenTiktok(texto: string | null | undefined): OrigenAnuncio | null {
  const t = String(texto ?? '');
  if (!LLEGADA_TIKTOK.test(t)) return null;
  return {
    anuncioId: ORIGEN_TIKTOK,
    tipo: ORIGEN_TIKTOK,
    titulo: 'TikTok',
    texto: t.trim().slice(0, 300) || null,
    url: null,
    imagenUrl: null,
    ctwaClid: null,
  };
}

export interface LlegadaPorAnuncio {
  conversacionId: number;
  anuncioId: string;
  tipo: string | null;
  titulo: string | null;
  url: string | null;
  imagenUrl: string | null;
  creadoEn: Date;
}

export interface VentaDeConversacion {
  conversacionId: number;
  monto: number;
  fecha: Date;
}

export interface FilaAnuncio {
  anuncioId: string;
  tipo: string | null;
  titulo: string | null;
  url: string | null;
  imagenUrl: string | null;
  conversaciones: number;
  pedidos: number;
  vendido: number;
  /** Pedidos / conversaciones, en %. */
  conversion: number;
}

/**
 * Cuánto trajo cada anuncio.
 *
 * Una conversación cuenta una vez por anuncio aunque el cliente toque el
 * mismo anuncio tres veces. La venta va al último anuncio por el que llegó
 * ANTES de comprar: si volvió por otro anuncio después de pagar, ese otro no
 * la trajo. Una venta sin llegada previa (la etiqueta llegó después) no se le
 * cuenta a nadie.
 */
export function ventasPorAnuncio(
  llegadas: LlegadaPorAnuncio[],
  ventas: VentaDeConversacion[],
): FilaAnuncio[] {
  const filas = new Map<string, FilaAnuncio & { convs: Set<number> }>();
  // La foto de la fila es la de su llegada más reciente: si el negocio le
  // cambió el título al anuncio, se ve el de ahora.
  const ordenadas = [...llegadas].sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime());
  for (const l of ordenadas) {
    const f = filas.get(l.anuncioId) ?? {
      anuncioId: l.anuncioId,
      tipo: null,
      titulo: null,
      url: null,
      imagenUrl: null,
      conversaciones: 0,
      pedidos: 0,
      vendido: 0,
      conversion: 0,
      convs: new Set<number>(),
    };
    f.tipo = l.tipo ?? f.tipo;
    f.titulo = l.titulo ?? f.titulo;
    f.url = l.url ?? f.url;
    f.imagenUrl = l.imagenUrl ?? f.imagenUrl;
    f.convs.add(l.conversacionId);
    filas.set(l.anuncioId, f);
  }

  const porConversacion = new Map<number, LlegadaPorAnuncio[]>();
  for (const l of ordenadas) {
    const lista = porConversacion.get(l.conversacionId) ?? [];
    lista.push(l);
    porConversacion.set(l.conversacionId, lista);
  }
  for (const v of ventas) {
    const antes = (porConversacion.get(v.conversacionId) ?? []).filter(
      (l) => l.creadoEn.getTime() <= v.fecha.getTime(),
    );
    const ultima = antes[antes.length - 1];
    if (!ultima) continue;
    const f = filas.get(ultima.anuncioId)!;
    f.pedidos += 1;
    f.vendido += Number(v.monto) || 0;
  }

  return [...filas.values()]
    .map(({ convs, ...f }) => ({
      ...f,
      conversaciones: convs.size,
      vendido: Math.round(f.vendido * 100) / 100,
      conversion: convs.size ? Math.round((f.pedidos / convs.size) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.vendido - a.vendido || b.conversaciones - a.conversaciones);
}
