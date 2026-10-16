import { PrismaService } from '../../prisma/prisma.service';

/**
 * Qué lista de precios aplica, con la precedencia del negocio:
 *
 *   0) La ELEGIDA A MANO en el POS — manda sobre todo. Es el caso de la
 *      licorería con bar: el mismo trago vale distinto si se lo llevan o si se
 *      lo toman en la mesa, y eso solo lo sabe quien está cobrando.
 *   1) Lista del CLIENTE (el precio pactado con él). Va por encima del
 *      vendedor: lo acordado con el cliente no depende de quién lo atienda.
 *   2) Lista específica del USUARIO (el precio especial de ese cajero).
 *   3) Lista específica de la SEDE  (la excepción de ese local).
 *   4) Lista "por defecto" de la empresa (los precios normales del negocio).
 *   5) Ninguna → el llamador cae al precio base del producto.
 *
 * Dentro de cada paso, si hay varias candidatas gana la de `orden` menor (y a
 * igual orden, la de `id` menor, para que el resultado sea estable).
 *
 * La lista "por defecto" NO compite en los pasos 1 a 3: es solo el fallback
 * general. Así, asignar al dueño o al local a la lista general no lo "clava", y
 * una lista propia de un local SIEMPRE gana sobre la default.
 *
 * Vive acá y no dentro de un servicio porque la consultan dos módulos
 * (`producto` para precificar el catálogo y `lista-precio` para decirle al POS
 * qué lista trae puesta); tenerla duplicada era la forma segura de que se
 * desincronizaran.
 */
export async function resolverListaPrecioAplicable(
  prisma: PrismaService,
  opts: {
    empresaId: number;
    usuarioId?: number;
    sedeId?: number;
    /** Lista elegida a mano en el POS. Si no existe o está inactiva, se ignora. */
    listaPrecioIdExplicita?: number;
    /** Cliente de la venta: su precio pactado gana sobre el del vendedor. */
    clienteId?: number;
    /** Trae también los items (precios por producto). */
    incluirItems?: boolean;
  },
): Promise<{ id: number; nombre: string; items?: any[] } | null> {
  const { empresaId, usuarioId, sedeId, clienteId, listaPrecioIdExplicita } = opts;
  // Desempate estable: primero lo que el empresario ordenó, luego el id.
  const porPrioridad = [{ orden: 'asc' as const }, { id: 'asc' as const }];
  const select = {
    id: true,
    nombre: true,
    ...(opts.incluirItems ? { items: true } : {}),
  } as const;

  if (listaPrecioIdExplicita) {
    const elegida = await prisma.listaPrecio.findFirst({
      where: { id: listaPrecioIdExplicita, empresaId, activo: true },
      select,
    });
    if (elegida) return elegida as any;
  }

  if (clienteId) {
    const porCliente = await prisma.listaPrecio.findFirst({
      where: {
        empresaId,
        activo: true,
        esPorDefecto: false,
        clientes: { some: { clienteId } },
      },
      orderBy: porPrioridad,
      select,
    });
    if (porCliente) return porCliente as any;
  }

  if (usuarioId) {
    const porUsuario = await prisma.listaPrecio.findFirst({
      where: {
        empresaId,
        activo: true,
        esPorDefecto: false,
        usuarios: { some: { usuarioId } },
      },
      orderBy: porPrioridad,
      select,
    });
    if (porUsuario) return porUsuario as any;
  }

  if (sedeId) {
    const porSede = await prisma.listaPrecio.findFirst({
      where: {
        empresaId,
        activo: true,
        esPorDefecto: false,
        sedes: { some: { sedeId } },
      },
      orderBy: porPrioridad,
      select,
    });
    if (porSede) return porSede as any;
  }

  const porDefecto = await prisma.listaPrecio.findFirst({
    where: { empresaId, activo: true, esPorDefecto: true },
    orderBy: porPrioridad,
    select,
  });
  return (porDefecto as any) ?? null;
}

/**
 * Precio final de un ítem de lista, ya con el descuento de la lista aplicado.
 *
 * Vive junto al resolutor y no en cada servicio porque lo necesitan los dos
 * consumidores (el catálogo del POS y el reprecio del carrito): si cada uno
 * aplicara el descuento por su cuenta, bastaba que uno se olvidara para que la
 * tarjeta mostrara un precio y la línea cobrara otro.
 *
 * Un descuento fuera de 0-100 se ignora en vez de producir un precio absurdo.
 */
export function precioConDescuento(
  // Prisma devuelve Decimal; se acepta cualquier cosa numerificable para no
  // obligar a cada llamador a convertir.
  precioUnitario: number | string | { toString(): string },
  descuentoPorcentaje?: number | string | { toString(): string } | null,
): number {
  const base = Number(precioUnitario as any);
  if (!Number.isFinite(base)) return 0;
  const dto = Number((descuentoPorcentaje ?? 0) as any);
  if (!Number.isFinite(dto) || dto <= 0 || dto >= 100) return base;
  // Dos decimales: es dinero, y dejar la cola flotante hacía que el total del
  // carrito no cuadrara contra el del comprobante por céntimos.
  return Math.round(base * (1 - dto / 100) * 100) / 100;
}
