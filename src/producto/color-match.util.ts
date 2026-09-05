/**
 * Emparejamiento de color para la búsqueda de imágenes de producto.
 *
 * Al crear variantes (talla/color) la búsqueda traía la prenda correcta pero de
 * otro color: el color viajaba como un token más dentro del nombre y pesaba lo
 * mismo que "polera" u "hombre". Aquí el color pasa a ser una restricción:
 * suma fuerte cuando coincide y descarta cuando la imagen declara otro color.
 */

/** Familias de color con los términos que las delatan en un título o URL. */
const COLOR_FAMILIES: Record<string, string[]> = {
  negro: ['negro', 'negra', 'negros', 'negras', 'black', 'azabache', 'onix'],
  blanco: [
    'blanco', 'blanca', 'blancos', 'blancas', 'white', 'marfil', 'ivory',
    'crudo', 'hueso', 'off white', 'offwhite',
  ],
  gris: [
    'gris', 'grises', 'grey', 'gray', 'plomo', 'grafito', 'humo', 'melange',
    'jaspeado',
  ],
  azul: [
    'azul', 'azules', 'blue', 'marino', 'navy', 'celeste', 'indigo', 'anil',
    'petroleo', 'acero',
  ],
  turquesa: ['turquesa', 'turquoise', 'aqua', 'cian', 'cyan'],
  rojo: ['rojo', 'roja', 'rojos', 'rojas', 'red', 'carmesi', 'escarlata'],
  vino: [
    'vino', 'borgona', 'burgundy', 'guinda', 'granate', 'bordo', 'wine',
    'maroon',
  ],
  rosa: [
    'rosa', 'rosado', 'rosada', 'pink', 'fucsia', 'fuchsia', 'palo rosa',
    'magenta',
  ],
  coral: ['coral', 'salmon'],
  naranja: ['naranja', 'orange', 'mandarina', 'zanahoria', 'naranjo'],
  amarillo: ['amarillo', 'amarilla', 'yellow', 'limon'],
  mostaza: ['mostaza', 'mustard'],
  verde: [
    'verde', 'verdes', 'green', 'oliva', 'olive', 'militar', 'jade', 'menta',
    'mint', 'esmeralda', 'botella', 'musgo',
  ],
  morado: [
    'morado', 'morada', 'lila', 'purpura', 'purple', 'violeta', 'violet',
    'uva', 'malva', 'lavanda',
  ],
  marron: [
    'marron', 'marrones', 'brown', 'cafe', 'coffee', 'cocoa', 'cacao',
    'chocolate', 'camel', 'tabaco', 'caramelo', 'canela', 'terracota',
    'teja', 'castano', 'mocca', 'moka', 'cobrizo', 'ladrillo',
  ],
  beige: [
    'beige', 'crema', 'cream', 'arena', 'sand', 'khaki', 'caqui', 'nude',
    'tan', 'topo', 'taupe',
  ],
  dorado: ['dorado', 'dorada', 'gold', 'golden', 'oro'],
  plateado: ['plateado', 'plateada', 'plata', 'silver'],
};

/**
 * Términos que describen un acabado sin ser un color puntual. No generan
 * conflicto: una prenda "estampada marrón" sigue siendo marrón.
 */
const NEUTRAL_COLOR_TERMS = new Set([
  'multicolor', 'estampado', 'estampada', 'floral', 'rayas', 'cuadros',
  'animal print', 'tie dye', 'degrade',
]);

export const normalizeColorText = (text: string): string =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Coincidencia por palabra completa, para que "negro" no salga de "montenegro". */
const containsTerm = (paddedText: string, term: string): boolean =>
  paddedText.includes(` ${term} `);

export type ColorMatcher = {
  /** true cuando hay un color pedido reconocible sobre el cual exigir coincidencia. */
  active: boolean;
  /** Color pedido normalizado, ej. "marron cocoa". */
  requested: string;
  /** Familias detectadas en el color pedido, ej. ["marron"]. */
  families: string[];
  /** Términos que cuentan como acierto de color. */
  matchTerms: string[];
  /** Términos de otras familias: si aparecen, la imagen es de otro color. */
  conflictTerms: string[];
};

export const buildColorMatcher = (color: string): ColorMatcher => {
  const requested = normalizeColorText(color);
  if (!requested) {
    return {
      active: false,
      requested: '',
      families: [],
      matchTerms: [],
      conflictTerms: [],
    };
  }

  const padded = ` ${requested} `;
  const families = Object.keys(COLOR_FAMILIES).filter((family) =>
    COLOR_FAMILIES[family].some((term) => containsTerm(padded, term)),
  );

  // Palabras propias del color pedido (cubre colores fuera del léxico, ej. "arcilla").
  const ownWords = requested
    .split(' ')
    .filter((word) => word.length >= 3 && !NEUTRAL_COLOR_TERMS.has(word));

  const matchTerms = Array.from(
    new Set([
      ...ownWords,
      ...families.flatMap((family) => COLOR_FAMILIES[family]),
    ]),
  );

  const conflictTerms = Object.entries(COLOR_FAMILIES)
    .filter(([family]) => !families.includes(family))
    .flatMap(([, terms]) => terms)
    .filter((term) => !matchTerms.includes(term));

  return {
    active: matchTerms.length > 0,
    requested,
    families,
    // Frases multi-palabra primero para que "palo rosa" gane a "rosa".
    matchTerms: matchTerms.sort((a, b) => b.length - a.length),
    conflictTerms,
  };
};

export type ColorVerdict = 'match' | 'conflict' | 'neutral';

/**
 * Clasifica una imagen contra el color pedido a partir de su título/alt/URL.
 * "conflict" solo cuando la imagen nombra otro color y no el pedido.
 */
export const evaluateColorMatch = (
  sourceText: string,
  matcher: ColorMatcher,
): ColorVerdict => {
  if (!matcher.active) return 'neutral';
  const padded = ` ${normalizeColorText(sourceText)} `;
  if (padded.trim().length === 0) return 'neutral';

  if (matcher.matchTerms.some((term) => containsTerm(padded, term))) {
    return 'match';
  }
  if (matcher.conflictTerms.some((term) => containsTerm(padded, term))) {
    return 'conflict';
  }
  return 'neutral';
};
