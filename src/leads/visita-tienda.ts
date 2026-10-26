/**
 * Visitas a la tienda física: cuándo va el cliente y cómo llega.
 *
 * Hierba Sana (26-10): clientes que llegan sin aviso, y otros que "nos
 * vienen buscando 1 hora" porque el local está dentro del Mercado La Merced.
 * Al agendar se le manda la ubicación (mapa de WhatsApp), la foto de la
 * fachada y las indicaciones que el negocio escribió, una sola vez.
 */
import { fechaMencionada } from './fecha-mencionada';

export interface ConfigTienda {
  /** Dirección escrita ("Av. Emancipación 687, Mercado La Merced, stand D-27"). */
  direccion: string;
  /** Link de Google Maps que pegó el dueño. Se manda si no hay coordenadas. */
  mapsUrl: string;
  lat: number | null;
  lng: number | null;
  /** Cómo llegar: "entra por la puerta 3, al fondo a la derecha". */
  indicaciones: string;
  /** Foto de la fachada o del stand. */
  fotoUrl: string;
}

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const coordenada = (v: unknown, limite: number): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limite && n !== 0 ? n : null;
};

/**
 * Coordenadas de un link de Google Maps, si las trae a la vista. Los links
 * cortos (maps.app.goo.gl) no las traen: esos se mandan como enlace.
 */
export function coordenadasDeMaps(url: string): { lat: number; lng: number } | null {
  const patrones = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // el pin exacto del lugar
    /@(-?\d+\.\d+),(-?\d+\.\d+)/, // el centro del mapa
    /[?&](?:q|ll|query|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
  ];
  for (const p of patrones) {
    const m = p.exec(url || '');
    if (m) {
      const lat = coordenada(m[1], 90);
      const lng = coordenada(m[2], 180);
      if (lat != null && lng != null) return { lat, lng };
    }
  }
  return null;
}

/** Lo guardado en iaVentasConfigJson.tienda, saneado. */
export function tiendaValida(raw: unknown): ConfigTienda {
  const t = (raw ?? {}) as Record<string, unknown>;
  const mapsUrl = texto(t.mapsUrl, 500);
  let lat = coordenada(t.lat, 90);
  let lng = coordenada(t.lng, 180);
  if ((lat == null || lng == null) && mapsUrl) {
    const c = coordenadasDeMaps(mapsUrl);
    if (c) ({ lat, lng } = c);
  }
  if (lat == null || lng == null) lat = lng = null;
  return {
    direccion: texto(t.direccion, 300),
    mapsUrl,
    lat,
    lng,
    indicaciones: texto(t.indicaciones, 800),
    fotoUrl: texto(t.fotoUrl, 500),
  };
}

/** Hay algo que mandarle al cliente para que llegue. */
export function tieneComoLlegar(t: ConfigTienda): boolean {
  return t.lat != null || !!t.mapsUrl || !!t.fotoUrl || !!t.indicaciones;
}

/**
 * El texto que acompaña a la foto (o va solo, si no hay foto): dirección,
 * indicaciones y, si no se pudo mandar el mapa, el link.
 */
export function textoComoLlegar(t: ConfigTienda, negocio: string): string {
  return [
    `📍 *Cómo llegar a ${negocio}*`,
    t.direccion,
    t.indicaciones,
    t.lat == null && t.mapsUrl ? `Mapa: ${t.mapsUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

const hoyLima = (ahora: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(ahora);

const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * El día de la visita. Primero la fecha que calculó el modelo (tiene el día
 * de hoy en el contexto); si no la pasó o es absurda, se saca del texto.
 * Null = "dice que vendrá" sin día: igual entra a la lista.
 */
export function fechaDeVisita(cuando: string, fechaModelo: unknown, ahora = new Date()): string | null {
  const hoy = hoyLima(ahora);
  const tope = sumarDias(hoy, 60);
  if (typeof fechaModelo === 'string' && ISO.test(fechaModelo) && fechaModelo >= hoy && fechaModelo <= tope) {
    return fechaModelo;
  }
  const t = (cuando || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/\bpasado manana\b/.test(t)) return sumarDias(hoy, 2);
  if (/\bhoy\b|\besta (tarde|noche|manana)\b|\bahorita\b/.test(t)) return hoy;
  // "mañana" el día, no "el sábado en la mañana" (la hora).
  if (/(?<!\bla )\bmanana\b/.test(t)) return sumarDias(hoy, 1);
  // "martes 27 octubre", "27 de octubre": el número con su mes manda sobre
  // el día de la semana, que la gente escribe sin "el" o con "el día".
  const conMes = new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${MESES.join('|')}|septiembre)\\b`).exec(t);
  if (conMes) {
    const d = Number(conMes[1]);
    const m = conMes[2] === 'septiembre' ? 9 : MESES.indexOf(conMes[2]) + 1;
    const [y, mh, dh] = hoy.split('-').map(Number);
    if (d >= 1 && d <= 31) {
      const anio = m < mh || (m === mh && d < dh) ? y + 1 : y;
      return `${anio}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return fechaMencionada(t.replace(/\bel dia\b/g, 'el'), ahora);
}
