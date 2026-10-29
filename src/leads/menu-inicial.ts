/**
 * Menú de bienvenida con botones, antes de que entre la IA.
 *
 * Krezka (28-10) escribió su saludo en "Mi vendedor" y la IA lo reescribía a
 * su manera ("Qué bueno que escribes, soy Nicky…"): el saludo es una
 * sugerencia para el modelo, no un texto fijo. Pidió además lo que hacen
 * otros negocios: un saludo exacto y dos o tres preguntas con opciones para
 * tocar, y recién ahí la conversación con el vendedor.
 *
 * Cómo funciona:
 *  1. En una conversación nueva (sin ningún mensaje nuestro todavía), en vez
 *     de la IA sale el primer paso: el saludo del negocio tal cual + la
 *     primera pregunta con sus opciones.
 *  2. Si el cliente toca una opción (o la escribe, o pone su número), sale el
 *     paso siguiente.
 *  3. Al responder el último paso —o si escribe otra cosa— entra la IA con lo
 *     que el cliente eligió, para que no vuelva a preguntarlo.
 *  4. Una opción marcada "pasar a una persona" deriva ahí mismo.
 *
 * El estado no tiene columna propia: cada paso enviado queda en el historial
 * como un mensaje del asistente con la marca `HERRAMIENTA_MENU` en
 * `herramientasJson`. Así borrar el chat reinicia el menú, y la IA ve las
 * preguntas y las respuestas como parte de la conversación.
 *
 * Solo WhatsApp tiene botones de respuesta y listas. Por Instagram y
 * Messenger el paso sale como texto con las opciones numeradas (ver
 * `textoConOpciones`), y se responde igual: con el número o el nombre.
 */

/** Marca de los mensajes del menú en `LeadMensaje.herramientasJson`. */
export const HERRAMIENTA_MENU = 'menu_inicial';

/** Límites de WhatsApp para mensajes interactivos. */
const MAX_CUERPO = 1024;
const MAX_TITULO_BOTON = 20;
const MAX_TITULO_FILA = 24;
const MAX_DESCRIPCION_FILA = 72;
const MAX_BOTONES = 3;
const MAX_FILAS = 10;

/** Límites propios, para que el saludo + la pregunta quepan en un mensaje. */
const MAX_BIENVENIDA = 800;
const MAX_PREGUNTA = 200;
const MAX_PASOS = 5;

export interface OpcionMenu {
  titulo: string;
  descripcion?: string;
  /** Tocarla pasa el chat a una persona del equipo. */
  derivar?: boolean;
}

export interface PasoMenu {
  pregunta: string;
  /** Texto del botón que abre la lista ("Ver opciones"). Solo listas. */
  boton?: string;
  opciones: OpcionMenu[];
}

export interface ConfigMenuInicial {
  activo: boolean;
  /** Saludo exacto del negocio; va arriba de la primera pregunta. */
  bienvenida: string;
  pasos: PasoMenu[];
}

/** Lo que se le manda a WhatsApp en un paso. */
export interface MensajeMenu {
  cuerpo: string;
  /** Hasta 3 opciones cortas: botones; si no, lista desplegable. */
  tipo: 'botones' | 'lista';
  boton: string;
  opciones: { id: string; titulo: string; descripcion?: string }[];
}

export interface RespuestaMenu {
  pregunta: string;
  respuesta: string;
}

const texto = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/** Lo guardado en iaVentasConfigJson, saneado. Siempre devuelve algo. */
export function menuValido(raw: unknown): ConfigMenuInicial {
  const m = (raw ?? {}) as { activo?: unknown; bienvenida?: unknown; pasos?: unknown };
  const pasos: PasoMenu[] = (Array.isArray(m.pasos) ? m.pasos : [])
    .map((p: any) => {
      const opciones: OpcionMenu[] = (Array.isArray(p?.opciones) ? p.opciones : [])
        .map((o: any) => {
          const titulo = texto(o?.titulo, MAX_TITULO_FILA);
          const descripcion = texto(o?.descripcion, MAX_DESCRIPCION_FILA);
          return {
            titulo,
            ...(descripcion ? { descripcion } : {}),
            ...(o?.derivar === true ? { derivar: true } : {}),
          };
        })
        .filter((o) => o.titulo)
        .slice(0, MAX_FILAS);
      const boton = texto(p?.boton, MAX_TITULO_BOTON);
      return {
        pregunta: texto(p?.pregunta, MAX_PREGUNTA),
        ...(boton ? { boton } : {}),
        opciones,
      };
    })
    // Una pregunta sin al menos dos opciones no es un menú.
    .filter((p) => p.pregunta && p.opciones.length >= 2)
    .slice(0, MAX_PASOS);
  const bienvenida = texto(m.bienvenida, MAX_BIENVENIDA);
  return { activo: m.activo === true && pasos.length > 0, bienvenida, pasos };
}

/**
 * Botones si caben (hasta 3 y de 20 caracteres o menos); si no, lista. Una
 * opción con descripción también va en lista: los botones no la muestran.
 */
export function mensajeDelPaso(menu: ConfigMenuInicial, i: number): MensajeMenu {
  const paso = menu.pasos[i];
  const cuerpo = [i === 0 ? menu.bienvenida : '', paso.pregunta]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_CUERPO);
  const caben =
    paso.opciones.length <= MAX_BOTONES &&
    paso.opciones.every((o) => o.titulo.length <= MAX_TITULO_BOTON && !o.descripcion);
  return {
    cuerpo,
    tipo: caben ? 'botones' : 'lista',
    boton: paso.boton || 'Ver opciones',
    opciones: paso.opciones.map((o, j) => ({
      id: `menu-${i}-${j}`,
      titulo: o.titulo,
      ...(o.descripcion ? { descripcion: o.descripcion } : {}),
    })),
  };
}

/** El paso como texto plano: para Instagram/Messenger y para el historial. */
export function textoConOpciones(m: MensajeMenu): string {
  const lineas = m.opciones.map((o, j) => `${j + 1}. ${o.titulo}`);
  return `${m.cuerpo}\n\n${lineas.join('\n')}`;
}

/** Minúsculas, sin tildes, sin emojis ni signos: "🌐 Por internet" ≈ "por internet". */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Qué opción eligió el cliente, o null si escribió otra cosa.
 *
 * Tocar el botón llega como el título exacto (ver `textoDeMensaje` en el
 * webhook). También vale escribirla, o mandar su número ("2"), que es como
 * se responde por Instagram y Messenger.
 */
export function opcionElegida(paso: PasoMenu, respuesta: string): number | null {
  const r = normalizar(respuesta);
  if (!r) return null;
  const numero = /^(\d{1,2})$/.exec(r);
  if (numero) {
    const j = Number(numero[1]) - 1;
    return j >= 0 && j < paso.opciones.length ? j : null;
  }
  const titulos = paso.opciones.map((o) => normalizar(o.titulo));
  const exacta = titulos.findIndex((t) => t === r);
  if (exacta >= 0) return exacta;
  // "por internet nomas" → "Por internet". Solo si una sola opción calza:
  // con dos, es ambiguo y mejor que conteste la IA.
  const contenidas = titulos
    .map((t, j) => (t && (` ${r} `.includes(` ${t} `)) ? j : -1))
    .filter((j) => j >= 0);
  return contenidas.length === 1 ? contenidas[0] : null;
}

type MensajeHistorial = { rol: string; contenido: string; herramientasJson?: unknown };

/** El paso del menú que marca un mensaje nuestro, o null si no es del menú. */
export function pasoDelMensaje(m: MensajeHistorial): number | null {
  if (m.rol !== 'ASISTENTE' || !Array.isArray(m.herramientasJson)) return null;
  const marca = (m.herramientasJson as { nombre?: string; argumentos?: { paso?: unknown } }[]).find(
    (ll) => ll?.nombre === HERRAMIENTA_MENU,
  );
  const paso = marca?.argumentos?.paso;
  return typeof paso === 'number' ? paso : null;
}

/**
 * Qué hacer con el turno, mirando el historial:
 *  - `empezar`: no le escribimos nunca → primer paso.
 *  - `responder`: lo último nuestro fue el paso `paso` → el lote del cliente
 *    es su respuesta.
 *  - `ia`: el menú ya terminó o la conversación es de antes del menú.
 */
export function estadoDelMenu(
  mensajes: MensajeHistorial[],
): { accion: 'empezar' } | { accion: 'responder'; paso: number } | { accion: 'ia' } {
  const nuestros = mensajes.filter((m) => m.rol === 'ASISTENTE');
  if (!nuestros.length) return { accion: 'empezar' };
  const paso = pasoDelMensaje(nuestros[nuestros.length - 1]);
  return paso === null ? { accion: 'ia' } : { accion: 'responder', paso };
}

/**
 * Lo que el cliente eligió en cada paso, en orden: el primer mensaje suyo
 * después de cada pregunta del menú.
 */
export function respuestasDelMenu(
  menu: ConfigMenuInicial,
  mensajes: MensajeHistorial[],
): RespuestaMenu[] {
  const out: RespuestaMenu[] = [];
  mensajes.forEach((m, i) => {
    const paso = pasoDelMensaje(m);
    if (paso === null) return;
    const siguiente = mensajes.slice(i + 1).find((x) => x.rol === 'USUARIO');
    if (!siguiente) return;
    const pregunta = menu.pasos[paso]?.pregunta ?? `Pregunta ${paso + 1}`;
    out.push({ pregunta, respuesta: siguiente.contenido.trim().slice(0, 200) });
  });
  return out;
}

/** Para el prompt del turno: qué ya respondió, para no volver a preguntarlo. */
export function bloqueRespuestasMenu(respuestas: RespuestaMenu[]): string {
  if (!respuestas.length) return '';
  return [
    'MENÚ DE BIENVENIDA: el cliente ya recibió el saludo del negocio y respondió estas preguntas con botones. No lo vuelvas a saludar ni a preguntar lo mismo: úsalo para seguir desde ahí.',
    ...respuestas.map((r) => `- ${r.pregunta} → ${r.respuesta}`),
  ].join('\n');
}

/** Para el aviso al asesor cuando una opción deriva. */
export function detalleParaElAsesor(respuestas: RespuestaMenu[]): string {
  return `Eligió en el menú: ${respuestas.map((r) => `${r.pregunta} ${r.respuesta}`).join(' · ')}`.slice(0, 500);
}
