/**
 * Qué parte del conocimiento se le manda al modelo en cada pregunta.
 *
 * El documento generado son ~29 KB: 7 de pantallas y 22 de avisos de
 * validación. Mandarlo entero en cada mensaje es caro y —peor— le diluye la
 * atención al modelo entre cientos de líneas que no vienen al caso.
 *
 * Las pantallas van siempre: son pocas y casi toda consulta termina en "¿dónde
 * está?". Los avisos se eligen por pregunta, con coincidencia de palabras: es
 * determinista, se puede probar sin red y no necesita embeddings. Si algún día
 * queda corto, el RAG del módulo de leads ya existe y encaja acá.
 */

/** Cuántos avisos se mandan como máximo. */
export const MAX_AVISOS = 14;

const TITULO_AVISOS = 'POR QUÉ EL SISTEMA PUEDE NO DEJARLO HACER ALGO';

/** Palabras que aparecen en todos lados y no distinguen nada. */
const VACIAS = new Set([
  'para', 'como', 'donde', 'cual', 'cuales', 'esta', 'este', 'esto', 'eso',
  'que', 'con', 'por', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas',
  'mis', 'mi', 'tu', 'tus', 'sus', 'su', 'the', 'and', 'hay', 'son', 'ser',
  'puedo', 'puede', 'pueden', 'hacer', 'tengo', 'quiero', 'necesito', 'sirve',
  'sistema', 'empresa', 'todos', 'todo', 'toda', 'debe', 'deben', 'ya', 'no',
  'sin', 'mas', 'muy', 'pero', 'porque', 'cuando', 'desde', 'hasta', 'sobre',
]);

/** Minúsculas y sin tildes, para comparar como escribe la gente. */
export const normalizar = (t: string): string =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Las palabras con las que vale la pena buscar. */
export const palabrasClave = (texto: string): string[] => {
  const palabras = normalizar(texto)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length >= 4 && !VACIAS.has(p));
  return [...new Set(palabras)];
};

/**
 * Raíz corta de una palabra, para que "comprobante" y "comprobantes" —o
 * "factura" y "facturación"— cuenten como lo mismo. No es un stemmer serio;
 * alcanza para emparejar lo que escribe un empresario con el texto de un aviso.
 */
const raiz = (p: string) => p.slice(0, Math.max(4, p.length - 3));

/** Separa el documento en la parte fija y la lista de avisos. */
export const partirConocimiento = (documento: string) => {
  const corte = documento.indexOf(TITULO_AVISOS);
  if (corte < 0) return { fijo: documento, avisos: [] as string[] };
  const fijo = documento.slice(0, corte).trimEnd();
  const avisos = documento
    .slice(corte)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- "'));
  return { fijo, avisos };
};

/**
 * El conocimiento que corresponde a esta pregunta.
 *
 * Si ninguna palabra coincide no se manda ningún aviso: es preferible que el
 * modelo escale a que elija cualquiera de los 378 y arme una respuesta sobre
 * algo que no tiene nada que ver.
 */
export const conocimientoPara = (
  documento: string,
  pregunta: string,
  max = MAX_AVISOS,
  /**
   * Conocimiento escrito a mano, que va SIEMPRE antes del generado.
   *
   * El extractor saca del código dónde está cada cosa y por qué el sistema
   * bloquea algo, pero no cómo funciona: que la mercadería vieja se registra
   * como lote con su propio costo, o que el import de productos sale del menú
   * Herramientas. Reemplazar lo escrito a mano por lo generado hizo que el bot
   * dejara de contestar cosas que ya sabía.
   */
  escritoAMano = '',
): string => {
  const { fijo: generado, avisos } = partirConocimiento(documento);
  const fijo = escritoAMano ? `${escritoAMano.trim()}\n\n${generado}` : generado;
  const claves = palabrasClave(pregunta).map(raiz);
  if (!claves.length) return fijo;

  const puntuados = avisos
    .map((aviso) => {
      const texto = normalizar(aviso);
      const puntos = claves.filter((c) => texto.includes(c)).length;
      return { aviso, puntos };
    })
    .filter((a) => a.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, max);

  if (!puntuados.length) return fijo;

  return [
    fijo,
    '',
    TITULO_AVISOS,
    'Avisos del sistema relacionados con lo que preguntan. Si describen uno, la',
    'causa es la que dice el aviso.',
    ...puntuados.map((p) => `  ${p.aviso}`),
  ].join('\n');
};
