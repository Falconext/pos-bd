/**
 * Descripción / detalle adicional de una línea de comprobante (multilínea).
 *
 * Pensado para cotizaciones de servicios: el ítem lleva un título
 * ("RETIRO DE PINTURA DE PARED PISO 6") en `descripcion` y, debajo, el detalle
 * del trabajo en varias líneas ("Retiro de pintura antigua\nRaspado, lijado…").
 *
 * Se guarda en `DetalleComprobante.detalleAdicional` y solo se imprime en el
 * PDF. NUNCA entra al XML UBL de SUNAT: allí el ítem sigue saliendo con
 * `descripcion` (una línea), así que un salto de línea acá no puede romper una
 * factura/boleta convertida desde la cotización.
 */

/** Tope de caracteres: suficiente para un detalle de obra, evita pegar un libro. */
export const DETALLE_ADICIONAL_MAX = 2000;

/**
 * Deja el texto listo para guardar: normaliza saltos (\r\n → \n), quita
 * espacios al final de cada línea y líneas vacías al inicio/fin, y recorta al
 * tope. Devuelve `null` si no queda nada (columna nullable → no guarda "").
 */
export function normalizarDetalleAdicional(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const lineas = valor
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  while (lineas.length && !lineas[0].trim()) lineas.shift();
  while (lineas.length && !lineas[lineas.length - 1].trim()) lineas.pop();
  const texto = lineas.join('\n').slice(0, DETALLE_ADICIONAL_MAX).trim();
  return texto ? texto : null;
}

/**
 * Líneas a imprimir (sin vacías). El HTML colapsa los saltos, por eso la
 * plantilla pinta cada línea como un bloque aparte. Respeta mayúsculas/
 * minúsculas: el detalle va en "letra normal", a diferencia del título.
 */
export function lineasDetalleAdicional(valor: unknown): string[] {
  const texto = normalizarDetalleAdicional(valor);
  if (!texto) return [];
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
