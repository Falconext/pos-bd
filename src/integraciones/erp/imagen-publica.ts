/**
 * Una dirección fija para cada foto de producto.
 *
 * Las fotos viven en un bucket privado y solo se ven con un enlace firmado
 * que vence en minutos. La web del negocio necesita lo contrario: una URL que
 * pueda poner en un `<img>` y que funcione mañana. La API entrega
 * `/api/v1/erp/images/<token>`, que redirige cada vez a un enlace firmado
 * nuevo.
 *
 * El token lleva el producto y el índice de la foto, firmados: sin la firma
 * no se puede pedir la foto de otro producto contando ids. No lleva API key
 * porque un `<img>` no puede mandar cabeceras.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const secreto = () => `${process.env.JWT_SECRET ?? ''}:imagenes-api-erp`;

const firma = (cuerpo: string) =>
  createHmac('sha256', secreto()).update(cuerpo).digest('base64url').slice(0, 22);

export function tokenImagen(productoId: number, indice: number): string {
  const cuerpo = `${productoId.toString(36)}.${indice.toString(36)}`;
  return `${cuerpo}.${firma(cuerpo)}`;
}

/** El producto y la foto de un token, o null si la firma no cuadra. */
export function leerTokenImagen(token: string): { productoId: number; indice: number } | null {
  const partes = String(token ?? '').split('.');
  if (partes.length !== 3) return null;
  const [p, i, f] = partes;
  const esperada = firma(`${p}.${i}`);
  const a = Buffer.from(f);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const productoId = parseInt(p, 36);
  const indice = parseInt(i, 36);
  if (!Number.isInteger(productoId) || productoId <= 0 || !Number.isInteger(indice) || indice < 0) return null;
  return { productoId, indice };
}

/** La key de S3 de una URL guardada, o null si no es de S3. */
export function keyDeS3(url: string | null | undefined): string | null {
  const u = String(url ?? '');
  const i = u.indexOf('amazonaws.com/');
  if (i === -1) return null;
  return decodeURIComponent(u.slice(i + 'amazonaws.com/'.length).split('?')[0]);
}
