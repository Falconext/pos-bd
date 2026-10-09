/**
 * Extrae del código el conocimiento que usa el asistente de soporte.
 *
 * Existe porque la primera versión del conocimiento la escribí a mano, y eso
 * nace desactualizándose: la primera vez que alguien mueve una pantalla, el
 * bot manda al empresario a un lugar que ya no existe. Acá la fuente es el
 * propio código, así que se vuelve a correr y queda al día.
 *
 * Tres fuentes:
 *   1. Las rutas del panel (frontend/src/App.tsx) — el "¿dónde está tal cosa?"
 *   2. El mapa de módulos del menú (sidebarMeta.ts)
 *   3. Los mensajes de validación del backend — el "¿por qué no me deja?",
 *      que es la consulta más común y la que el bot puede contestar mejor.
 *
 * Genera un archivo COMMITEADO. Producción no vuelve a extraer nada ni
 * necesita el repositorio del frontend al lado.
 *
 *   npx ts-node --transpile-only scripts/extraer-conocimiento.ts
 */
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'fs';
import { join, relative } from 'path';

const RAIZ_BACKEND = join(__dirname, '..');
const RAIZ_FRONTEND = join(RAIZ_BACKEND, '..', 'frontend');
const SALIDA = join(RAIZ_BACKEND, 'src', 'soporte', 'conocimiento.generado.ts');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Rutas del panel
// ─────────────────────────────────────────────────────────────────────────────

/** Nombre legible a partir del componente: `ComprobantesPage` -> `Comprobantes`. */
const nombreDesdeComponente = (c: string) =>
  c
    .replace(/(Page|Index|View|Router)$/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();

interface Ruta {
  ruta: string;
  pantalla: string;
}

const extraerRutas = (): Ruta[] => {
  const archivo = join(RAIZ_FRONTEND, 'src', 'App.tsx');
  if (!existsSync(archivo)) {
    throw new Error(
      `No se encontró ${archivo}. El extractor necesita el repositorio del ` +
        `frontend al lado del backend. Corre sólo en desarrollo.`,
    );
  }
  const fuente = readFileSync(archivo, 'utf8');
  // Solo el árbol del panel: desde path="/administrador" hasta el cierre.
  const desde = fuente.indexOf('path="/administrador"');
  if (desde < 0)
    throw new Error('No se encontró el árbol de /administrador en App.tsx');
  // El bloque TERMINA donde arranca el árbol siguiente. Sin este corte se
  // colaban las rutas del reseller, que repiten paths del panel ("clientes") y
  // hacían que el bot nombrara pantallas que el empresario no tiene.
  const siguiente = fuente
    .slice(desde + 1)
    .search(/path="\/(reseller|tienda|dashboard|diseno-preview)/);
  const bloque =
    siguiente > 0
      ? fuente.slice(desde, desde + 1 + siguiente)
      : fuente.slice(desde);

  const rutas: Ruta[] = [];
  const re = /<Route\s+path="([^"]+)"\s+element=\{<([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloque))) {
    const [, ruta, componente] = m;
    // Los redirects no son pantallas: mandarían al bot a nombrar una que no existe.
    if (componente === 'Navigate') continue;
    // Las rutas con parámetro no se pueden dictar por chat.
    if (ruta.includes(':')) continue;
    if (ruta.startsWith('/')) continue; // rutas de otro árbol
    rutas.push({
      ruta: `/administrador/${ruta}`,
      pantalla: nombreDesdeComponente(componente),
    });
  }
  return [...new Map(rutas.map((r) => [r.ruta, r])).values()].sort((a, b) =>
    a.ruta.localeCompare(b.ruta),
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Módulos del menú
// ─────────────────────────────────────────────────────────────────────────────

interface Modulo {
  codigo: string;
  ruta: string;
}

const extraerModulos = (): Modulo[] => {
  const archivo = join(
    RAIZ_FRONTEND,
    'src',
    'layouts',
    'sidebar',
    'sidebarMeta.ts',
  );
  if (!existsSync(archivo)) return [];
  const fuente = readFileSync(archivo, 'utf8');
  const bloque = fuente.match(
    /LEGACY_MODULE_ROUTES:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!bloque) return [];
  const modulos: Modulo[] = [];
  const re = /'?([\w-]+)'?:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloque[1]))) modulos.push({ codigo: m[1], ruta: m[2] });
  return modulos.sort((a, b) => a.codigo.localeCompare(b.codigo));
};

/** Los sub-items que declara el menú por código de módulo. */
const extraerSubItems = (): {
  modulo: string;
  nombre: string;
  ruta: string;
}[] => {
  const archivo = join(
    RAIZ_FRONTEND,
    'src',
    'layouts',
    'sidebar',
    'sidebarMeta.ts',
  );
  if (!existsSync(archivo)) return [];
  const fuente = readFileSync(archivo, 'utf8');
  const items: { modulo: string; nombre: string; ruta: string }[] = [];
  const re =
    /codigo:\s*'([\w-]+):([\w-]+)'\s*,\s*nombre:\s*'([^']+)'\s*,\s*ruta:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente))) {
    items.push({ modulo: m[1], nombre: m[3], ruta: m[4] });
  }
  return items;
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Mensajes de validación del backend
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los mensajes que el sistema le muestra al empresario cuando no lo deja hacer
 * algo. Cada uno es una consulta de soporte que va a llegar.
 */
interface Validacion {
  modulo: string;
  mensaje: string;
}

const archivosTs = (dir: string, acum: string[] = []): string[] => {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (['node_modules', 'dist', '__tests__'].includes(entrada)) continue;
      archivosTs(ruta, acum);
    } else if (entrada.endsWith('.ts') && !/\.spec\.ts$/.test(entrada)) {
      acum.push(ruta);
    }
  }
  return acum;
};

/** Módulos que no le sirven de nada al empresario en un chat de soporte. */
const MODULOS_IGNORADOS = new Set([
  'prisma',
  'common',
  'gemini',
  's3',
  'scheduler',
  'sync',
  'main.ts',
  'app.module.ts',
  'soporte',
  'leads',
  'sistema-finanzas',
  'store-catalog',
]);

/** Mensajes técnicos: no se los puede leer un empresario. */
const esTecnico = (m: string) =>
  /\b(id|Id|ID|DTO|dto|token|payload|endpoint|null|undefined|JSON|UUID|S3|axios|prisma)\b/.test(
    m,
  ) ||
  /^[a-z]+[A-Z]/.test(m) || // camelCase suelto: "conductorId es requerido"
  /\.(ts|js|xml|json)\b/.test(m) ||
  // "X no encontrado" es una búsqueda interna que falló, no algo que el
  // empresario pueda entender ni corregir. Hay decenas y solo agregan ruido.
  /no (encontrad[oa]|existe)\b/i.test(m) ||
  /^Error (al|interno|de)\b/i.test(m);

const extraerValidaciones = (): Validacion[] => {
  const base = join(RAIZ_BACKEND, 'src');
  const validaciones: Validacion[] = [];
  for (const archivo of archivosTs(base)) {
    const rel = relative(base, archivo);
    const modulo = rel.split('/')[0];
    if (MODULOS_IGNORADOS.has(modulo)) continue;
    const fuente = readFileSync(archivo, 'utf8');
    // Mensajes de una sola cadena; los concatenados en varias líneas se dejan
    // fuera a propósito: partidos pierden sentido y suman ruido.
    const re =
      /(?:BadRequest|Forbidden|NotFound|Unauthorized|Conflict)Exception\(\s*'((?:[^'\\]|\\.){20,200})'\s*[,)]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fuente))) {
      const mensaje = m[1].replace(/\\'/g, "'").trim();
      if (esTecnico(mensaje)) continue;
      validaciones.push({ modulo, mensaje });
    }
  }
  // Únicos por mensaje, agrupados por módulo.
  const vistos = new Set<string>();
  return validaciones
    .filter((v) =>
      vistos.has(v.mensaje) ? false : (vistos.add(v.mensaje), true),
    )
    .sort(
      (a, b) =>
        a.modulo.localeCompare(b.modulo) || a.mensaje.localeCompare(b.mensaje),
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Documento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los nombres que el empresario VE en el menú.
 *
 * Salen de la tabla Modulo, que es lo que pinta el sidebar. Derivar el nombre
 * del componente de React daba cosas como "Finance Dashboard" o "Arqueo Caja →
 * Arqueo Caja": nombres de programador, que el empresario no reconoce.
 *
 * Si no hay base local a mano se sigue igual, solo que sin esta sección: el
 * extractor no puede depender de una base para correr.
 */
const nombresDeModulo = async (): Promise<Record<string, string>> => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const url = process.env.DATABASE_URL ?? '';
    if (!url.includes('localhost')) {
      await prisma.$disconnect();
      return {};
    }
    const modulos = await prisma.modulo.findMany({
      select: { codigo: true, nombre: true },
    });
    await prisma.$disconnect();
    return Object.fromEntries(modulos.map((m: any) => [m.codigo, m.nombre]));
  } catch {
    return {};
  }
};

const armarDocumento = async (): Promise<string> => {
  const nombres = await nombresDeModulo();
  const rutas = extraerRutas();
  const modulos = extraerModulos();
  const subItems = extraerSubItems();
  const validaciones = extraerValidaciones();

  const lineas: string[] = [];

  lineas.push('PANTALLAS DEL PANEL');
  lineas.push(
    'Cada línea es una pantalla real y su ruta. No existe ninguna otra.',
    'El nombre de acá es interno: para hablarle al empresario usa el nombre de',
    'la sección del menú, más abajo. Nunca menciones la ruta con barras.',
  );
  for (const r of rutas) lineas.push(`- ${r.pantalla}: ${r.ruta}`);

  lineas.push('');
  lineas.push(
    'SECCIONES DEL MENÚ — los nombres que el empresario ve y debes usar',
  );
  for (const m of modulos) {
    const visible = nombres[m.codigo];
    lineas.push(
      visible
        ? `- ${visible} (${m.codigo}): ${m.ruta}`
        : `- ${m.codigo}: ${m.ruta}`,
    );
  }

  if (subItems.length) {
    lineas.push('');
    lineas.push('SUB-SECCIONES DEL MENÚ');
    for (const s of subItems)
      lineas.push(`- ${s.modulo} → ${s.nombre}: ${s.ruta}`);
  }

  lineas.push('');
  lineas.push('POR QUÉ EL SISTEMA PUEDE NO DEJARLO HACER ALGO');
  lineas.push(
    'Son los avisos exactos que muestra el sistema. Si el empresario describe uno,',
    'la causa es la que dice el aviso.',
  );
  let moduloActual = '';
  for (const v of validaciones) {
    if (v.modulo !== moduloActual) {
      moduloActual = v.modulo;
      lineas.push(`  [${moduloActual}]`);
    }
    lineas.push(`  - "${v.mensaje}"`);
  }

  return lineas.join('\n');
};

(async () => {
  const documento = await armarDocumento();

  const archivo = `/**
 * GENERADO AUTOMÁTICAMENTE — NO EDITAR A MANO.
 *
 * Lo produce \`scripts/extraer-conocimiento.ts\` leyendo el código: las rutas
 * del panel, el mapa del menú y los mensajes de validación del backend.
 * Para actualizarlo, volver a correr el script; editar acá se pierde.
 *
 * Generado el ${new Date().toISOString().slice(0, 10)}.
 */

export const CONOCIMIENTO_GENERADO = ${JSON.stringify(documento)};
`;

  writeFileSync(SALIDA, archivo, 'utf8');

  const rutas = extraerRutas();
  const validaciones = extraerValidaciones();
  console.log('Conocimiento generado en', relative(RAIZ_BACKEND, SALIDA));
  console.log('  pantallas   :', rutas.length);
  console.log('  módulos     :', extraerModulos().length);
  console.log('  sub-items   :', extraerSubItems().length);
  console.log('  validaciones:', validaciones.length);
  console.log('  tamaño      :', (documento.length / 1024).toFixed(1), 'KB');
})();
