import { SetMetadata } from '@nestjs/common';

/**
 * Los productos que exponen API pública. Una key sirve para uno solo.
 *
 * Atarla a un producto no es burocracia: un integrador de logística que
 * consigue (o filtra) su key no puede emitir facturas con ella. Sin esta
 * columna, una sola key comprometida alcanzaría para firmar comprobantes ante
 * SUNAT a nombre de la empresa.
 */
// `erp` es la API de Krezka para el propio negocio (catálogo, stock): la que
// usa su web. Distinta de `facturacion`, que es para integradores que emiten
// por RUCs ajenos.
export const PRODUCTOS_API = ['logistica', 'facturacion', 'erp'] as const;
export type ProductoApi = (typeof PRODUCTOS_API)[number];

/** Cómo se llama cada API en los mensajes que lee el integrador. */
export const NOMBRE_PRODUCTO_API: Record<ProductoApi, string> = {
  logistica: 'Logística',
  facturacion: 'Facturación',
  erp: 'Krezka (catálogo y stock)',
};

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
