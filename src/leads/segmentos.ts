/**
 * Segmentos — a quién le llega un envío masivo. Reglas puras.
 *
 * Un segmento es un conjunto de filtros sobre los contactos que ya le
 * escribieron al negocio. Se guarda como filtros y no como lista de
 * teléfonos: "los que compraron perfume" cambia todos los días, y una lista
 * congelada se queda vieja apenas alguien compra.
 *
 * Lo que más importa acá es la cuenta honesta: cuántos cumplen el filtro y
 * cuántos de esos de verdad van a recibir el mensaje. La diferencia —bajas,
 * tope de avisos, Instagram sin ventana— es lo que el empresario necesita
 * ver antes de mandar, no después.
 */

export const CANALES = ['WHATSAPP', 'INSTAGRAM', 'MESSENGER'] as const;
export type Canal = (typeof CANALES)[number];

export const TEMPERATURAS = [
  'FRIO',
  'TIBIO',
  'CALIENTE',
  'CONVERTIDO',
  'PERDIDO',
] as const;

export interface FiltrosSegmento {
  etiquetas?: {
    /** Tiene estas etiquetas: alguna o todas, según `modo`. */
    incluir?: number[];
    modo?: 'alguna' | 'todas';
    /** No tiene ninguna de estas. */
    excluir?: number[];
  };
  /** Temperatura del lead (FRIO, TIBIO…). Vacío = cualquiera. */
  temperaturas?: string[];
  /** Etapa del embudo. Vacío = cualquiera. */
  etapas?: string[];
  canales?: Canal[];
  /** Días desde el último mensaje del cliente. */
  actividad?: { minDias?: number; maxDias?: number };
  compras?: {
    estado?: 'compro' | 'no_compro';
    /** Solo compras de los últimos N días. */
    dias?: number;
    productoIds?: number[];
    categoriaIds?: number[];
  };
  consultas?: {
    productoIds?: number[];
    /** Solo lo que pidió y no había. */
    soloNoHabidos?: boolean;
    dias?: number;
  };
  /** Llegó por alguno de estos anuncios. */
  anuncioIds?: string[];
}

const MAX_IDS = 200;

const enteros = (v: unknown): number[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const ids = [
    ...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0)),
  ].slice(0, MAX_IDS);
  return ids.length ? ids : undefined;
};

const textos = (
  v: unknown,
  validos?: readonly string[],
): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = [
    ...new Set(
      v
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim())
        .filter((x) => !validos || validos.includes(x)),
    ),
  ].slice(0, MAX_IDS);
  return out.length ? out : undefined;
};

const dias = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && v !== null && v !== ''
    ? Math.min(Math.floor(n), 3650)
    : undefined;
};

/**
 * Los filtros tal como se guardan y se evalúan: sin claves vacías, sin ids
 * inválidos, sin valores fuera de lugar. Lo que llega del panel no se usa
 * crudo en una consulta.
 */
export function normalizarFiltros(
  crudo: unknown,
  etapasValidas: readonly string[] = [],
): FiltrosSegmento {
  const f = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<
    string,
    any
  >;
  const out: FiltrosSegmento = {};

  const incluir = enteros(f.etiquetas?.incluir);
  const excluir = enteros(f.etiquetas?.excluir);
  if (incluir || excluir) {
    out.etiquetas = {
      ...(incluir
        ? { incluir, modo: f.etiquetas?.modo === 'todas' ? 'todas' : 'alguna' }
        : {}),
      ...(excluir ? { excluir } : {}),
    };
  }

  const temperaturas = textos(f.temperaturas, TEMPERATURAS);
  if (temperaturas) out.temperaturas = temperaturas;
  const etapas = textos(
    f.etapas,
    etapasValidas.length ? etapasValidas : undefined,
  );
  if (etapas) out.etapas = etapas;
  const canales = textos(f.canales, CANALES) as Canal[] | undefined;
  if (canales) out.canales = canales;

  const minDias = dias(f.actividad?.minDias);
  const maxDias = dias(f.actividad?.maxDias);
  if (minDias !== undefined || maxDias !== undefined) {
    out.actividad = {
      ...(minDias !== undefined ? { minDias } : {}),
      ...(maxDias !== undefined ? { maxDias } : {}),
    };
  }

  const c = f.compras;
  if (c && (c.estado === 'compro' || c.estado === 'no_compro')) {
    const productoIds = enteros(c.productoIds);
    const categoriaIds = enteros(c.categoriaIds);
    const d = dias(c.dias);
    out.compras = {
      estado: c.estado,
      ...(d ? { dias: d } : {}),
      ...(productoIds ? { productoIds } : {}),
      ...(categoriaIds ? { categoriaIds } : {}),
    };
  }

  const q = f.consultas;
  const qProductos = enteros(q?.productoIds);
  if (q && (qProductos || q.soloNoHabidos === true)) {
    const d = dias(q.dias);
    out.consultas = {
      ...(qProductos ? { productoIds: qProductos } : {}),
      ...(q.soloNoHabidos === true ? { soloNoHabidos: true } : {}),
      ...(d ? { dias: d } : {}),
    };
  }

  const anuncioIds = textos(f.anuncioIds);
  if (anuncioIds) out.anuncioIds = anuncioIds;

  return out;
}

/** Lo que se sabe de un contacto para decidir si entra al segmento. */
export interface HechosContacto {
  etiquetaIds: number[];
  /** Compras con su fecha y lo que llevó. */
  compras: {
    fecha: Date;
    productoIds: number[];
    categoriaIds: number[];
    /** Total del comprobante; lo usan las métricas del envío. */
    monto?: number;
  }[];
  /** Lo que preguntó, con fecha y si lo había. */
  consultas: { fecha: Date; productoId: number | null; hubo: boolean }[];
  ultimoMensajeDelCliente: Date | null;
}

/**
 * Los filtros que se resuelven en memoria (etiquetas, compras, consultas,
 * actividad). Temperatura, etapa, canal y anuncio se resuelven en la consulta
 * a la base porque son columnas directas.
 */
export function cumpleFiltros(
  f: FiltrosSegmento,
  h: HechosContacto,
  ahora: Date,
): boolean {
  const DIA = 24 * 3600_000;

  if (f.etiquetas?.incluir?.length) {
    const tiene = new Set(h.etiquetaIds);
    const ok =
      f.etiquetas.modo === 'todas'
        ? f.etiquetas.incluir.every((id) => tiene.has(id))
        : f.etiquetas.incluir.some((id) => tiene.has(id));
    if (!ok) return false;
  }
  if (f.etiquetas?.excluir?.some((id) => h.etiquetaIds.includes(id)))
    return false;

  if (f.actividad) {
    // Sin mensajes del cliente no hay actividad que medir: queda fuera de
    // cualquier filtro de actividad, en vez de contar como "hace 0 días".
    if (!h.ultimoMensajeDelCliente) return false;
    const hace = (ahora.getTime() - h.ultimoMensajeDelCliente.getTime()) / DIA;
    if (f.actividad.minDias !== undefined && hace < f.actividad.minDias)
      return false;
    if (f.actividad.maxDias !== undefined && hace > f.actividad.maxDias)
      return false;
  }

  if (f.compras?.estado) {
    const desde = f.compras.dias
      ? ahora.getTime() - f.compras.dias * DIA
      : -Infinity;
    const productos = f.compras.productoIds;
    const categorias = f.compras.categoriaIds;
    const hayCompra = h.compras.some(
      (c) =>
        c.fecha.getTime() >= desde &&
        (!productos?.length ||
          c.productoIds.some((p) => productos.includes(p))) &&
        (!categorias?.length ||
          c.categoriaIds.some((p) => categorias.includes(p))),
    );
    if (f.compras.estado === 'compro' ? !hayCompra : hayCompra) return false;
  }

  if (f.consultas) {
    const desde = f.consultas.dias
      ? ahora.getTime() - f.consultas.dias * DIA
      : -Infinity;
    const productos = f.consultas.productoIds;
    const consulto = h.consultas.some(
      (c) =>
        c.fecha.getTime() >= desde &&
        (!f.consultas!.soloNoHabidos || !c.hubo) &&
        (!productos?.length ||
          (c.productoId !== null && productos.includes(c.productoId))),
    );
    if (!consulto) return false;
  }

  return true;
}

/** Por qué un contacto que cumple el filtro no recibiría el mensaje. */
export type Exclusion = 'BAJA' | 'TOPE' | 'SIN_VENTANA' | 'INTERNO';

export const TEXTO_EXCLUSION: Record<Exclusion, string> = {
  BAJA: 'Pidió no recibir más avisos.',
  TOPE: 'Ya recibió el máximo de mensajes comerciales del periodo.',
  SIN_VENTANA:
    'Instagram/Messenger: pasaron más de 24 h desde su último mensaje y estos canales no tienen plantillas.',
  INTERNO: 'Es un número del propio negocio.',
};

/**
 * ¿Le llega o no? Mismo orden de prioridad que el motor de avisos: la baja
 * manda sobre todo, después el tope y por último el canal.
 */
export function exclusionDe(c: {
  interno: boolean;
  deBaja: boolean;
  marketingRecientes: number;
  tope: number;
  canal: string;
  ventanaAbierta: boolean;
}): Exclusion | null {
  if (c.interno) return 'INTERNO';
  if (c.deBaja) return 'BAJA';
  if (c.marketingRecientes >= c.tope) return 'TOPE';
  if (c.canal !== 'WHATSAPP' && !c.ventanaAbierta) return 'SIN_VENTANA';
  return null;
}
