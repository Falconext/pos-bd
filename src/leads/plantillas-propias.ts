/**
 * Plantillas propias de la empresa — reglas puras.
 *
 * Fuera de la ventana de 24 h, WhatsApp solo deja escribir con una plantilla
 * aprobada por Meta. Hasta ahora las plantillas estaban fijas en el código;
 * para un envío masivo el negocio necesita escribir la suya ("Cyber: 20 % en
 * fragancias hasta el domingo").
 *
 * El empresario escribe con variables con nombre —{{nombre}}, {{dato1}}— y
 * acá se traducen a lo que Meta entiende ({{1}}, {{2}}…), en el orden en que
 * aparecen. Las reglas de Meta se validan antes de mandar: una plantilla
 * rechazada tarda horas en volver y el empresario no entiende por qué.
 */

/** Variables que se pueden usar en el cuerpo. */
export const VARIABLES_PLANTILLA = ['nombre', 'dato1', 'dato2'] as const;
export type VariablePlantilla = (typeof VARIABLES_PLANTILLA)[number];

export const CATEGORIAS_PLANTILLA = ['MARKETING', 'UTILITY'] as const;
export type CategoriaPlantilla = (typeof CATEGORIAS_PLANTILLA)[number];

export const TIPOS_CABECERA = ['NINGUNA', 'TEXTO', 'IMAGEN'] as const;
export type TipoCabecera = (typeof TIPOS_CABECERA)[number];

/**
 * El pie de baja. Mismo texto que las plantillas de marketing que ya existen:
 * el processor reconoce "BAJA" y deja de escribirle. En marketing es
 * obligatorio y no se puede cambiar: es una promesa al cliente.
 */
export const PIE_BAJA = 'Responde BAJA para no recibir más avisos';

export interface BotonPlantilla {
  tipo: 'RESPUESTA' | 'URL';
  texto: string;
  url?: string;
}

export interface DatosPlantilla {
  titulo: string;
  categoria: CategoriaPlantilla;
  cabeceraTipo: TipoCabecera;
  cabeceraTexto?: string | null;
  cabeceraImagenUrl?: string | null;
  cuerpo: string;
  pie?: string | null;
  botones: BotonPlantilla[];
  /** Ejemplos de dato1/dato2 para que Meta entienda qué va ahí. */
  ejemplos: Partial<Record<VariablePlantilla, string>>;
}

export const LIMITES = {
  titulo: 60,
  cabeceraTexto: 60,
  cuerpo: 1024,
  pie: 60,
  boton: 25,
  respuestas: 3,
  urls: 1,
};

const PATRON_VARIABLE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Las variables del cuerpo en orden de primera aparición, sin repetir. */
export function variablesDe(texto: string): string[] {
  const vistas: string[] = [];
  for (const m of (texto ?? '').matchAll(PATRON_VARIABLE)) {
    const v = m[1].toLowerCase();
    if (!vistas.includes(v)) vistas.push(v);
  }
  return vistas;
}

const limpiar = (t: unknown, max: number) =>
  typeof t === 'string' ? t.replace(/\r\n/g, '\n').trim().slice(0, max) : '';

/** Lo que llega del panel, normalizado. No valida: eso lo hace `erroresDe`. */
export function normalizarPlantilla(crudo: any): DatosPlantilla {
  const c = crudo ?? {};
  const categoria: CategoriaPlantilla =
    c.categoria === 'UTILITY' ? 'UTILITY' : 'MARKETING';
  const cabeceraTipo: TipoCabecera = TIPOS_CABECERA.includes(c.cabeceraTipo)
    ? c.cabeceraTipo
    : 'NINGUNA';
  const botones: BotonPlantilla[] = (Array.isArray(c.botones) ? c.botones : [])
    .slice(0, 5)
    .map((b: any) => ({
      tipo: b?.tipo === 'URL' ? 'URL' : 'RESPUESTA',
      texto: limpiar(b?.texto, 40),
      ...(b?.tipo === 'URL' ? { url: limpiar(b?.url, 2000) } : {}),
    }))
    .filter((b: BotonPlantilla) => b.texto);
  const ejemplos: DatosPlantilla['ejemplos'] = {};
  for (const v of ['dato1', 'dato2'] as const) {
    const e = limpiar(c.ejemplos?.[v], 60);
    if (e) ejemplos[v] = e;
  }
  return {
    titulo: limpiar(c.titulo, 80),
    categoria,
    cabeceraTipo,
    cabeceraTexto:
      cabeceraTipo === 'TEXTO' ? limpiar(c.cabeceraTexto, 100) : null,
    cabeceraImagenUrl:
      cabeceraTipo === 'IMAGEN' ? limpiar(c.cabeceraImagenUrl, 2000) : null,
    cuerpo: limpiar(c.cuerpo, 2000),
    // En marketing el pie es el de la baja, siempre.
    pie: categoria === 'MARKETING' ? PIE_BAJA : limpiar(c.pie, 100) || null,
    botones,
    ejemplos,
  };
}

/**
 * Por qué Meta rechazaría esta plantilla (o por qué no tiene sentido), en
 * palabras para el empresario. Vacío = se puede mandar a revisión.
 */
export function erroresDe(p: DatosPlantilla): string[] {
  const e: string[] = [];
  if (!p.titulo) e.push('Ponle un nombre a la plantilla.');
  if (p.titulo.length > LIMITES.titulo)
    e.push(`El nombre puede tener hasta ${LIMITES.titulo} caracteres.`);

  if (!p.cuerpo) e.push('Escribe el mensaje.');
  if (p.cuerpo.length > LIMITES.cuerpo)
    e.push(`El mensaje puede tener hasta ${LIMITES.cuerpo} caracteres.`);

  const variables = variablesDe(p.cuerpo);
  const desconocidas = variables.filter(
    (v) => !VARIABLES_PLANTILLA.includes(v as VariablePlantilla),
  );
  if (desconocidas.length) {
    e.push(
      `No existe la variable ${desconocidas.map((v) => `{{${v}}}`).join(', ')}. Usa {{nombre}}, {{dato1}} o {{dato2}}.`,
    );
  }
  const cuerpoSinEspacios = p.cuerpo.trim();
  if (
    /^\{\{[^}]+\}\}/.test(cuerpoSinEspacios) ||
    /\{\{[^}]+\}\}\s*$/.test(cuerpoSinEspacios)
  ) {
    e.push(
      'Meta no acepta mensajes que empiecen o terminen con una variable: agrega texto antes o después.',
    );
  }
  if (/\}\}\s*\{\{/.test(p.cuerpo)) {
    e.push('Dos variables seguidas no se aceptan: pon texto entre ellas.');
  }
  // Meta rechaza plantillas con más variables que texto ("too many variables
  // for its length"). La regla exacta no es pública; una variable cada 3
  // palabras es el límite que se ve en la práctica.
  const palabras = cuerpoSinEspacios
    .replace(PATRON_VARIABLE, '')
    .split(/\s+/)
    .filter(Boolean).length;
  if (variables.length && palabras < variables.length * 3) {
    e.push(
      'Hay demasiadas variables para lo corto del mensaje: escribe un poco más de texto.',
    );
  }
  for (const v of ['dato1', 'dato2'] as const) {
    if (variables.includes(v) && !p.ejemplos[v]) {
      e.push(
        `Escribe un ejemplo de lo que irá en {{${v}}}: Meta lo usa para revisar la plantilla.`,
      );
    }
  }

  if (p.cabeceraTipo === 'TEXTO') {
    if (!p.cabeceraTexto) e.push('Escribe el título de la cabecera o quítala.');
    else if (p.cabeceraTexto.length > LIMITES.cabeceraTexto) {
      e.push(
        `El título de la cabecera puede tener hasta ${LIMITES.cabeceraTexto} caracteres.`,
      );
    } else if (variablesDe(p.cabeceraTexto).length) {
      e.push('La cabecera no puede llevar variables.');
    }
  }
  if (
    p.cabeceraTipo === 'IMAGEN' &&
    !/^https:\/\//i.test(p.cabeceraImagenUrl ?? '')
  ) {
    e.push('Sube la imagen de la cabecera o quítala.');
  }

  if (p.pie && p.pie.length > LIMITES.pie)
    e.push(`El pie puede tener hasta ${LIMITES.pie} caracteres.`);
  if (p.pie && variablesDe(p.pie).length)
    e.push('El pie no puede llevar variables.');

  const respuestas = p.botones.filter((b) => b.tipo === 'RESPUESTA');
  const urls = p.botones.filter((b) => b.tipo === 'URL');
  if (respuestas.length > LIMITES.respuestas)
    e.push(`Hasta ${LIMITES.respuestas} botones de respuesta.`);
  if (urls.length > LIMITES.urls) e.push('Solo un botón de enlace.');
  for (const b of p.botones) {
    if (b.texto.length > LIMITES.boton)
      e.push(`El botón "${b.texto}" es muy largo (máximo ${LIMITES.boton}).`);
    if (b.tipo === 'URL' && !/^https:\/\/[^\s]+\.[^\s]+/i.test(b.url ?? '')) {
      e.push(
        `El botón "${b.texto}" necesita un enlace que empiece con https://`,
      );
    }
  }
  const textos = p.botones.map((b) => b.texto.toLowerCase());
  if (new Set(textos).size !== textos.length)
    e.push('Dos botones tienen el mismo texto.');
  return e;
}

/**
 * Nombre de la plantilla en Meta: minúsculas, guiones bajos y un sufijo
 * para que dos plantillas con el mismo título no choquen (Meta no deja
 * reutilizar un nombre borrado por 4 semanas).
 */
export function nombreMetaDe(titulo: string, sufijo: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${base || 'plantilla'}_${sufijo.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/** El cuerpo con {{1}}, {{2}}… en el orden de primera aparición. */
export function cuerpoParaMeta(cuerpo: string): {
  texto: string;
  orden: string[];
} {
  const orden = variablesDe(cuerpo);
  const texto = cuerpo.replace(
    PATRON_VARIABLE,
    (_, v: string) => `{{${orden.indexOf(v.toLowerCase()) + 1}}}`,
  );
  return { texto, orden };
}

const EJEMPLO_NOMBRE = 'María';

/** Lo que se le manda a Meta para dar de alta la plantilla. */
export function payloadAltaMeta(
  p: DatosPlantilla,
  nombreMeta: string,
  imagenHandle?: string,
): Record<string, unknown> {
  const { texto, orden } = cuerpoParaMeta(p.cuerpo);
  const components: Record<string, unknown>[] = [];
  if (p.cabeceraTipo === 'TEXTO' && p.cabeceraTexto) {
    components.push({ type: 'HEADER', format: 'TEXT', text: p.cabeceraTexto });
  }
  if (p.cabeceraTipo === 'IMAGEN') {
    components.push({
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: [imagenHandle ?? ''] },
    });
  }
  components.push({
    type: 'BODY',
    text: texto,
    ...(orden.length
      ? {
          example: {
            body_text: [
              orden.map((v) =>
                v === 'nombre'
                  ? EJEMPLO_NOMBRE
                  : (p.ejemplos[v as VariablePlantilla] ?? v),
              ),
            ],
          },
        }
      : {}),
  });
  if (p.pie) components.push({ type: 'FOOTER', text: p.pie });
  if (p.botones.length) {
    // Meta pide las respuestas rápidas juntas; van primero.
    const ordenados = [...p.botones].sort(
      (a, b) => Number(a.tipo === 'URL') - Number(b.tipo === 'URL'),
    );
    components.push({
      type: 'BUTTONS',
      buttons: ordenados.map((b) =>
        b.tipo === 'URL'
          ? { type: 'URL', text: b.texto, url: b.url }
          : { type: 'QUICK_REPLY', text: b.texto },
      ),
    });
  }
  return {
    name: nombreMeta,
    language: 'es',
    category: p.categoria,
    components,
  };
}

export interface ValoresEnvio {
  nombre?: string | null;
  dato1?: string | null;
  dato2?: string | null;
}

/** El primer nombre del cliente, o un saludo neutro si no se sabe. */
export function primerNombre(nombre: string | null | undefined): string {
  const n = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
  // Un @usuario de Instagram o un número no son un nombre.
  if (!n || /^[@+\d]/.test(n) || n.length > 30) return 'cliente';
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function valorDe(v: string, valores: ValoresEnvio): string {
  if (v === 'nombre') return primerNombre(valores.nombre);
  // Meta rechaza parámetros vacíos o con saltos de línea.
  return (
    ((valores as Record<string, string | null | undefined>)[v] ?? '')
      .replace(/\s+/g, ' ')
      .trim() || '-'
  );
}

/** Los parámetros del cuerpo, en el orden que espera Meta. */
export function parametrosDeEnvio(
  cuerpo: string,
  valores: ValoresEnvio,
): string[] {
  return cuerpoParaMeta(cuerpo).orden.map((v) => valorDe(v, valores));
}

/**
 * El mensaje como lo ve el cliente, en texto plano. Es lo que se manda por
 * Instagram/Messenger (no tienen plantillas) y lo que queda en el chat para
 * que la IA sepa qué se le ofreció cuando el cliente conteste.
 */
export function textoRenderizado(
  p: Pick<
    DatosPlantilla,
    'cabeceraTipo' | 'cabeceraTexto' | 'cuerpo' | 'pie' | 'botones'
  >,
  valores: ValoresEnvio,
  { conBotones = false }: { conBotones?: boolean } = {},
): string {
  const cuerpo = p.cuerpo.replace(PATRON_VARIABLE, (_, v: string) =>
    valorDe(v.toLowerCase(), valores),
  );
  const partes = [
    p.cabeceraTipo === 'TEXTO' && p.cabeceraTexto ? `*${p.cabeceraTexto}*` : '',
    cuerpo,
    conBotones && p.botones.length
      ? p.botones
          .map((b) =>
            b.tipo === 'URL' ? `${b.texto}: ${b.url}` : `• ${b.texto}`,
          )
          .join('\n')
      : '',
    p.pie ?? '',
  ];
  return partes.filter(Boolean).join('\n\n');
}

export type EstadoPlantilla =
  | 'BORRADOR'
  | 'PENDIENTE'
  | 'APROBADA'
  | 'RECHAZADA'
  | 'PAUSADA'
  | 'DESACTIVADA';

/** El estado de Meta en nuestras palabras. */
export function estadoDesdeMeta(
  status: string | null | undefined,
): EstadoPlantilla {
  switch (String(status ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'APROBADA';
    case 'REJECTED':
      return 'RECHAZADA';
    case 'PAUSED':
      return 'PAUSADA';
    case 'DISABLED':
    case 'DELETED':
    case 'ARCHIVED':
      return 'DESACTIVADA';
    default:
      return 'PENDIENTE';
  }
}

/** Motivos de rechazo de Meta, traducidos. */
export function motivoRechazo(
  reason: string | null | undefined,
): string | null {
  if (!reason || reason === 'NONE') return null;
  const tabla: Record<string, string> = {
    ABUSIVE_CONTENT: 'Meta consideró que el contenido es abusivo.',
    INCORRECT_CATEGORY:
      'La categoría no corresponde al contenido (un mensaje promocional va en Marketing).',
    INVALID_FORMAT:
      'El formato no es válido (variables, saltos de línea o caracteres).',
    SCAM: 'Meta lo consideró posible estafa.',
    PROMOTIONAL: 'Es promocional: tiene que ir en la categoría Marketing.',
    TAG_CONTENT_MISMATCH: 'El contenido no coincide con la categoría elegida.',
  };
  return tabla[reason] ?? `Meta la rechazó (${reason}).`;
}
