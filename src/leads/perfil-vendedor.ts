/**
 * "Mi vendedor": cómo quiere el negocio que hable y venda su asesor.
 *
 * Hasta el 22-10 todo esto se escribía a mano en un solo cuadro de texto
 * (`iaVentasContexto`) y la mayoría de los negocios lo dejaba en blanco: no
 * sabían qué poner. Con campos separados —a quién le vende, reglas, tono,
 * largo de los mensajes, palabras prohibidas, saludo— el dueño completa lo
 * que sabe de su negocio sin tener que redactar un prompt.
 *
 * Vive en `iaVentasConfigJson.vendedor`. Cada campo es opcional: sin perfil,
 * el prompt es exactamente el de antes.
 */

import type { ConfigEnvio, LugarZona, TipoZona, ZonaEnvio } from './envio-zonas';

/** Del 1 (muy conciso) al 5 (muy detallado). */
export type LongitudRespuesta = 1 | 2 | 3 | 4 | 5;

export interface TemaConocimiento {
  categoria: CategoriaConocimiento;
  titulo: string;
  texto: string;
}

export const CATEGORIAS_CONOCIMIENTO = [
  'PRODUCTOS',
  'HORARIOS',
  'ENVIOS',
  'PAGOS',
  'DEVOLUCIONES',
  'OTROS',
] as const;
export type CategoriaConocimiento = (typeof CATEGORIAS_CONOCIMIENTO)[number];

export interface PerfilVendedor {
  /** "¿A quién le vendes?": el cliente típico. */
  audiencia?: string;
  /** Reglas del negocio, escritas con SIEMPRE y NUNCA. */
  reglas?: string;
  estiloComunicacion?: string;
  estiloVentas?: string;
  longitud?: LongitudRespuesta;
  /** undefined = lo que diga la plantilla ("con moderación"). */
  emojis?: boolean;
  /** Emojis que puede usar. Vacío = cualquiera. */
  emojisPermitidos?: string[];
  /** false = escribir sin ¿ ¡ de apertura, como escribe la gente en WhatsApp. */
  signosApertura?: boolean;
  palabrasEvitar?: string[];
  mensajeBienvenida?: string;
  mensajeDerivacion?: string;
  conocimiento?: TemaConocimiento[];
}

const LARGO_TEXTO = 1500;
const LARGO_TEMA = 3000;
const MAX_TEMAS = 40;
const MAX_PALABRAS = 40;

function texto(v: unknown, max = LARGO_TEXTO): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
}

function lista(v: unknown, maxItems: number, maxLargo = 60): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const t = typeof item === 'string' ? item.trim().slice(0, maxLargo) : '';
    const clave = t.toLowerCase();
    if (!t || vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out.length ? out : undefined;
}

/**
 * Lo que llega del panel, limpio. Se descarta en silencio lo que no tiene la
 * forma esperada: es configuración del dueño, no hay a quién devolverle un
 * error campo por campo, y guardar basura terminaría dentro del prompt.
 */
export function perfilValido(input: unknown): PerfilVendedor {
  if (!input || typeof input !== 'object') return {};
  const i = input as Record<string, unknown>;
  const p: PerfilVendedor = {};

  const campos = [
    'audiencia',
    'reglas',
    'estiloComunicacion',
    'estiloVentas',
    'mensajeBienvenida',
    'mensajeDerivacion',
  ] as const;
  for (const c of campos) {
    const v = texto(i[c]);
    if (v) p[c] = v;
  }

  const largo = Number(i.longitud);
  if (Number.isInteger(largo) && largo >= 1 && largo <= 5) {
    p.longitud = largo as LongitudRespuesta;
  }
  if (typeof i.emojis === 'boolean') p.emojis = i.emojis;
  if (typeof i.signosApertura === 'boolean') p.signosApertura = i.signosApertura;

  const palabras = lista(i.palabrasEvitar, MAX_PALABRAS);
  if (palabras) p.palabrasEvitar = palabras;
  const emojis = lista(i.emojisPermitidos, 20, 8);
  if (emojis) p.emojisPermitidos = emojis;

  if (Array.isArray(i.conocimiento)) {
    const temas: TemaConocimiento[] = [];
    for (const t of i.conocimiento.slice(0, MAX_TEMAS)) {
      if (!t || typeof t !== 'object') continue;
      const r = t as Record<string, unknown>;
      const titulo = texto(r.titulo, 80);
      const cuerpo = texto(r.texto, LARGO_TEMA);
      if (!titulo || !cuerpo) continue;
      const categoria = CATEGORIAS_CONOCIMIENTO.includes(
        r.categoria as CategoriaConocimiento,
      )
        ? (r.categoria as CategoriaConocimiento)
        : 'OTROS';
      temas.push({ categoria, titulo, texto: cuerpo });
    }
    if (temas.length) p.conocimiento = temas;
  }

  return p;
}

const LARGO_INSTRUCCION: Record<LongitudRespuesta, string> = {
  1: 'Muy conciso: una o dos líneas por mensaje. Solo amplía si el cliente lo pide.',
  2: 'Conciso: mensajes cortos, de dos a cuatro líneas.',
  3: 'Equilibrado: lo justo para responder bien, sin relleno.',
  4: 'Detallado: explica con calma cuando el cliente lo necesita, en párrafos cortos.',
  5: 'Muy detallado: da toda la información relevante en cada respuesta, ordenada en párrafos cortos.',
};

/**
 * El perfil convertido en instrucciones para el prompt. Vacío si no hay nada
 * configurado, para que un negocio sin perfil tenga el prompt de siempre.
 *
 * Va después de las reglas de la plantilla y lo dice: lo del negocio manda
 * sobre lo genérico ("emojis con moderación" pierde contra "sin emojis").
 */
export function bloquePerfil(p: PerfilVendedor | null | undefined): string {
  if (!p) return '';
  const lineas: string[] = [];
  const add = (l?: string | false) => {
    if (l) lineas.push(l);
  };

  add(p.audiencia && `- A quién le vendes: ${p.audiencia}`);
  add(p.estiloComunicacion && `- Cómo hablas: ${p.estiloComunicacion}`);
  add(p.estiloVentas && `- Cómo vendes: ${p.estiloVentas}`);
  add(p.longitud && `- Largo de tus mensajes: ${LARGO_INSTRUCCION[p.longitud]}`);
  if (p.emojis === false) add('- No uses emojis.');
  else if (p.emojisPermitidos?.length)
    add(`- Emojis: usa solo estos y con moderación: ${p.emojisPermitidos.join(' ')}`);
  add(
    p.signosApertura === false &&
      '- No uses los signos de apertura ¿ ni ¡: escribe como se escribe en WhatsApp ("Hola! Qué buscas?").',
  );
  add(
    !!p.palabrasEvitar?.length &&
      `- Nunca uses estas palabras o frases: ${p.palabrasEvitar.map((w) => `"${w}"`).join(', ')}.`,
  );
  add(
    p.mensajeBienvenida &&
      `- Tu primer mensaje en una conversación nueva sigue este saludo, adaptado para responder también lo que te preguntaron: «${p.mensajeBienvenida}»`,
  );
  add(
    p.mensajeDerivacion &&
      `- Cuando pases la conversación a una persona del equipo, avísale al cliente con este mensaje: «${p.mensajeDerivacion}»`,
  );

  const partes: string[] = [];
  if (lineas.length) {
    partes.push(
      'TU ESTILO EN ESTE NEGOCIO (lo pidió el dueño: si choca con algo de arriba, vale esto)',
      ...lineas,
    );
  }
  if (p.reglas) {
    partes.push('', 'REGLAS DEL NEGOCIO (cúmplelas siempre)', p.reglas);
  }
  return partes.join('\n').trim();
}

const NOMBRE_CATEGORIA: Record<CategoriaConocimiento, string> = {
  PRODUCTOS: 'Productos',
  HORARIOS: 'Horarios',
  ENVIOS: 'Envíos',
  PAGOS: 'Pagos',
  DEVOLUCIONES: 'Devoluciones',
  OTROS: 'Otros',
};

/** Los temas de la base de conocimiento, como texto para el contexto. */
export function textoConocimiento(p: PerfilVendedor | null | undefined): string {
  const temas = p?.conocimiento ?? [];
  if (!temas.length) return '';
  return [
    'INFORMACIÓN DEL NEGOCIO POR TEMA (no la copies tal cual: úsala para responder lo que pregunten. Si algo de aquí contradice al texto de arriba, vale esto: es lo más puntual y lo más reciente)',
    ...temas.map(
      (t) => `- ${NOMBRE_CATEGORIA[t.categoria]} · ${t.titulo}: ${t.texto}`,
    ),
  ].join('\n');
}

// ─── Entrega y pagos, como los edita el panel ───────────────────────────────


const TIPOS_ZONA: TipoZona[] = ['DOMICILIO', 'AGENCIA', 'RECOJO'];

/**
 * Las zonas de envío que manda el panel, limpias.
 *
 * Los alias de cada lugar ("SJL", "Canto Grande") no se editan en el panel,
 * pero viajan de ida y vuelta con el lugar: se conservan tal cual llegan para
 * que guardar desde la pantalla no borre los que se cargaron a mano.
 */
export function envioValido(input: unknown): ConfigEnvio {
  const i = (input ?? {}) as Record<string, unknown>;
  const zonas: ZonaEnvio[] = [];
  const vistas = new Set<string>();
  for (const z of Array.isArray(i.zonas) ? i.zonas.slice(0, 30) : []) {
    if (!z || typeof z !== 'object') continue;
    const r = z as Record<string, unknown>;
    const nombre = texto(r.nombre, 60);
    if (!nombre || vistas.has(nombre.toLowerCase())) continue;
    vistas.add(nombre.toLowerCase());
    const tipo = TIPOS_ZONA.includes(r.tipo as TipoZona)
      ? (r.tipo as TipoZona)
      : 'DOMICILIO';
    const tarifa = Math.max(0, Math.round(Number(r.tarifa) * 100) / 100) || 0;
    const lugares: LugarZona[] = [];
    for (const l of Array.isArray(r.lugares) ? r.lugares.slice(0, 300) : []) {
      const lugar = typeof l === 'string' ? { nombre: l } : (l as Record<string, unknown>);
      const n = texto(lugar?.nombre, 60);
      if (!n) continue;
      const alias = lista(lugar.alias, 20);
      lugares.push(alias ? { nombre: n, alias } : { nombre: n });
    }
    const notaPago = texto(r.notaPago, 300);
    const courier = texto(r.courier, 30);
    zonas.push({
      nombre,
      tipo,
      tarifa,
      ...(lugares.length ? { lugares } : {}),
      ...(notaPago ? { notaPago } : {}),
      ...(courier ? { courier } : {}),
    });
  }
  const pedida = texto(i.zonaPorDefecto, 60) ?? '';
  // La zona por defecto tiene que existir: si no, un destino desconocido
  // terminaba cotizado con una zona fantasma.
  const zonaPorDefecto = zonas.some((z) => z.nombre === pedida) ? pedida : '';
  return { zonas, zonaPorDefecto };
}

export interface MedioPago {
  /** "Yape", "BCP", "Plin". */
  nombre: string;
  /** El número o la cuenta: "987 654 321", "191-1234567-0-12". */
  detalle: string;
  /** A nombre de quién: el cliente lo compara antes de pagar. */
  titular?: string;
}

export function mediosPagoValidos(input: unknown): MedioPago[] {
  const out: MedioPago[] = [];
  for (const m of Array.isArray(input) ? input.slice(0, 10) : []) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const nombre = texto(r.nombre, 40);
    // Generoso: los medios escritos a mano antes de la lista ("Yape … · BCP …
    // · contraentrega solo en Lima") vienen en un solo texto largo y cortarlo
    // es darle al cliente datos de pago incompletos.
    const detalle = texto(r.detalle, 1000);
    if (!nombre || !detalle) continue;
    const titular = texto(r.titular, 80);
    out.push({ nombre, detalle, ...(titular ? { titular } : {}) });
  }
  return out;
}

/**
 * La línea que la IA le dice al cliente y de la que se lee el titular para
 * verificar vouchers (`extraerTitular` busca "titular: …"). Por eso se arma
 * con esa palabra y no con otra.
 */
export function textoMediosPago(medios: MedioPago[]): string {
  return medios
    .map((m) =>
      // El texto de antes, mostrado como un solo medio, vuelve tal cual.
      m.nombre === MEDIOS_DE_ANTES && !m.titular
        ? m.detalle
        : `${m.nombre}: ${m.detalle}${m.titular ? ` (titular: ${m.titular})` : ''}`,
    )
    .join(' · ');
}

/** Nombre con el que el panel muestra los medios escritos antes de la lista. */
export const MEDIOS_DE_ANTES = 'Medios de pago';
