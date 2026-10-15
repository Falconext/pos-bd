import { SetMetadata } from '@nestjs/common';

/**
 * Los productos que exponen API pública. Una key sirve para uno solo.
 *
 * Atarla a un producto no es burocracia: un integrador de logística que
 * consigue (o filtra) su key no puede emitir facturas con ella. Sin esta
 * columna, una sola key comprometida alcanzaría para firmar comprobantes ante
 * SUNAT a nombre de la empresa.
 */
export const PRODUCTOS_API = ['logistica', 'facturacion'] as const;
export type ProductoApi = (typeof PRODUCTOS_API)[number];

export const CLAVE_PRODUCTO_API = 'producto_api';

/**
 * Marca qué API protege un controlador.
 *
 * Va en el controlador y no en el guard para que el guard sea uno solo: el
 * día que se abra el tercer producto, se decora y ya.
 */
export const ApiProducto = (producto: ProductoApi) =>
  SetMetadata(CLAVE_PRODUCTO_API, producto);

export function esProductoApi(valor: unknown): valor is ProductoApi {
  return PRODUCTOS_API.includes(valor as ProductoApi);
}
