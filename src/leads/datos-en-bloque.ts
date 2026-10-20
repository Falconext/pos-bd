/**
 * Los datos para agendar se piden con el bloque del código, no con las
 * palabras del modelo.
 *
 * Las herramientas devuelven `pedirTodoJunto` y piden copiarlo tal cual. En
 * la validación del 20-10 (provincia) el modelo igual escribió "confírmame
 * tu nombre completo, DNI y tu número de celular": todo junto, pero sin el
 * formato que pidió el negocio y olvidando la sede de Shalom.
 */

const DATOS = [
  /\bnombres?\b/i,
  /\bapellidos?\b/i,
  /\bdni\b/i,
  /\bcelular\b|\bn[uú]mero de contacto\b/i,
  /\bdirecci[oó]n\b/i,
  /\breferencia\b/i,
  /\bhorario\b/i,
  /\bagencia\b|\bsede\b/i,
];

/** ¿Este párrafo le está pidiendo datos al cliente? Dos o más datos distintos. */
function pideDatos(parrafo: string): boolean {
  // Y que los pida: "a nombre de Diego, celular 991…" confirma, no pide.
  const pide =
    /\?|comp[aá]rte|conf[ií]rm|ind[ií]c|p[aá]sa|env[ií]a|necesito|dime|br[ií]nda|facil[ií]ta|ay[uú]da/i.test(parrafo);
  return pide && DATOS.filter((r) => r.test(parrafo)).length >= 2;
}

export function conBloqueDeDatosExacto(
  respuesta: string,
  bloque: string | undefined,
): string {
  if (!bloque || respuesta.includes('*DATOS PARA AGENDAR TU PEDIDO*')) {
    return respuesta;
  }
  const parrafos = respuesta.split(/\n\s*\n/);
  const esLista = (p: string) => /^\s*[-•*]\s/.test(p);
  const cuenta = (p: string) => DATOS.filter((r) => r.test(p)).length;
  // Pedido de datos: un párrafo que los pide, o una lista con dos o más.
  const quitar = parrafos.map(
    (p) => pideDatos(p) || (esLista(p) && cuenta(p) >= 2),
  );
  if (!quitar.some(Boolean)) return respuesta;
  // La frase que presenta la lista ("compárteme:") se va con ella.
  for (let i = 0; i < parrafos.length - 1; i++) {
    if (quitar[i + 1] && parrafos[i].trim().endsWith(':')) quitar[i] = true;
  }
  return [...parrafos.filter((_, i) => !quitar[i]), bloque].join('\n\n');
}
