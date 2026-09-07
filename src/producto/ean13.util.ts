/**
 * Generación de códigos EAN-13 de circulación interna.
 *
 * Un EAN-13 "comercial" exige comprar un prefijo GS1 (en Perú ~S/ 1.5k al año).
 * Inventar dígitos al azar es peligroso: el código puede chocar con el de un
 * producto de fábrica y el escáner traería el producto equivocado.
 *
 * GS1 reserva los prefijos 20–29 para "restricted circulation within a company":
 * son justamente para etiquetas internas de un negocio. Un código que empieza en
 * 2 es EAN-13 válido, lo lee cualquier escáner sin configurar nada, y nunca
 * colisiona con un producto comercial.
 *
 * Estructura: 2 + productoId a 11 dígitos + dígito verificador.
 * Como el id es único a nivel de tabla (y las variantes son Producto hijos con
 * su propio id), cada talla×color obtiene un código propio y regenerarlo
 * siempre devuelve el mismo valor.
 */

/** Prefijo GS1 de circulación restringida (20–29). */
export const PREFIJO_INTERNO = '2';

/** Máximo id representable con 11 dígitos tras el prefijo. */
export const MAX_PRODUCTO_ID_EAN13 = 99_999_999_999;

/**
 * Dígito verificador EAN-13 (módulo 10): se suman los 12 dígitos pesando 1 y 3
 * de forma alterna y se completa hasta la siguiente decena.
 */
export function calcularDigitoVerificadorEan13(doceDigitos: string): number {
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    const d = doceDigitos.charCodeAt(i) - 48;
    suma += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (suma % 10)) % 10;
}

/** `true` si es un EAN-13 bien formado y con dígito verificador correcto. */
export function esEan13Valido(codigo: string): boolean {
  const raw = String(codigo ?? '').trim();
  if (!/^\d{13}$/.test(raw)) return false;
  return calcularDigitoVerificadorEan13(raw.slice(0, 12)) === Number(raw[12]);
}

/** `true` si el código es de circulación interna (prefijo 20–29). */
export function esEan13Interno(codigo: string): boolean {
  return esEan13Valido(codigo) && codigo.startsWith(PREFIJO_INTERNO);
}

/**
 * EAN-13 interno determinista para un producto (o variante) por su id.
 * Determinista a propósito: regenerar no cambia el código ya impreso en las
 * cajas del cliente.
 */
export function generarEan13DesdeProductoId(productoId: number): string {
  const id = Math.trunc(Number(productoId));
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`Id de producto inválido para generar EAN-13: ${productoId}`);
  }
  if (id > MAX_PRODUCTO_ID_EAN13) {
    throw new Error(`Id de producto fuera del rango representable en EAN-13: ${id}`);
  }
  const base = PREFIJO_INTERNO + String(id).padStart(11, '0');
  return base + calcularDigitoVerificadorEan13(base);
}

/**
 * Variante del código para el caso raro en que el determinista ya esté ocupado
 * por otro producto (p. ej. lo tecleó un usuario a mano). Desplaza el id dentro
 * del espacio interno sin salirse del prefijo 2.
 */
export function generarEan13Alternativo(
  productoId: number,
  intento: number,
): string {
  const desplazado = (Number(productoId) + intento * 10_000_000) % (MAX_PRODUCTO_ID_EAN13 + 1);
  return generarEan13DesdeProductoId(desplazado || 1);
}
