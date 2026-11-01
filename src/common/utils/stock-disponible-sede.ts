import { EstadoReserva, type PrismaClient } from '@prisma/client';
import { num } from './stock';

/**
 * Stock disponible para vender en una sede.
 *
 * Una sola regla para el punto de venta (ComprobanteService.
 * validarStockDisponibleParaVenta) y la tienda virtual (tienda/stock-tienda.ts):
 * si cada uno la calculara a su manera, la tienda aceptaría pedidos que la nota
 * de venta después rechaza, o al revés.
 *
 *   disponible = min(stock − reservas activas, stock − provisión), nunca < 0
 *
 * La provisión (`Producto.porcentajeProvision`) es la parte del stock que el
 * negocio guarda y no ofrece; las reservas activas son las PENDIENTE y
 * CONFIRMADA de esa sede.
 */
export const ESTADOS_RESERVA_ACTIVA: EstadoReserva[] = [
  EstadoReserva.PENDIENTE,
  EstadoReserva.CONFIRMADA,
];

export function disponibleParaVenta(p: {
  stockBase: number;
  reservado: number;
  porcentajeProvision?: number | null;
}): number {
  const cupoProvision = Math.floor(
    (p.stockBase * (p.porcentajeProvision ?? 0)) / 100,
  );
  const cupoVenta = Math.max(0, p.stockBase - cupoProvision);
  return Math.max(0, Math.min(p.stockBase - p.reservado, cupoVenta));
}

/** Lo que una sede puede ofrecer de un producto. */
export interface StockEnSede {
  sedeId: number;
  /** Hay fila ProductoStock para la sede. */
  tieneFila: boolean;
  /** Stock físico usado como base (puede ser negativo). */
  stockBase: number;
  reservado: number;
  /** Disponible para vender según la regla común (≥ 0). */
  disponible: number;
  /** `visibleEnSede`: false = el producto no existe para esa sede. */
  visible: boolean;
  /** Visible y `vendibleEnSede`: se puede vender ahí. */
  vendible: boolean;
}

export interface ProductoConStock {
  id: number;
  stockGlobal: number;
  porcentajeProvision: number;
  esServicio: boolean;
  porSede: Map<number, StockEnSede>;
}

type PrismaStock = Pick<PrismaClient, 'producto' | 'productoStock' | 'reserva'>;

export const esProductoServicio = (atributosTecnicos: unknown): boolean => {
  const tipo = (atributosTecnicos as { tipoProducto?: unknown } | null)
    ?.tipoProducto;
  return typeof tipo === 'string' && tipo.toUpperCase() === 'SERVICIO';
};

/**
 * Stock de varios productos en varias sedes con tres consultas, sin importar
 * cuántos sean (el catálogo pide 30 productos con sus variantes de una vez).
 *
 * `sinFilaUsaStockGlobal`: un producto sin fila en la sede vale 0, salvo en
 * empresas con UNA sola sede activa, donde se acepta `Producto.stock` (datos
 * de antes de que existieran las filas por sede). Con varias sedes, caer a la
 * suma global vendería lo que está en otra sede.
 */
export async function cargarStockPorSede(
  prisma: PrismaStock,
  params: {
    empresaId: number;
    productoIds: number[];
    sedeIds: number[];
    sinFilaUsaStockGlobal: boolean;
  },
): Promise<Map<number, ProductoConStock>> {
  const ids = [
    ...new Set(
      params.productoIds.filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
  const sedeIds = [...new Set(params.sedeIds)];
  const resultado = new Map<number, ProductoConStock>();
  if (!ids.length) return resultado;

  type Fila = {
    productoId: number;
    sedeId: number;
    stock: unknown;
    visibleEnSede: boolean;
    vendibleEnSede: boolean;
  };
  type ReservaSuma = {
    productoId: number;
    sedeId: number;
    _sum: { cantidad: number | null };
  };
  const sinSedes = sedeIds.length === 0;
  const [productos, filas, reservas] = await Promise.all([
    prisma.producto.findMany({
      where: { id: { in: ids }, empresaId: params.empresaId },
      select: {
        id: true,
        stock: true,
        porcentajeProvision: true,
        atributosTecnicos: true,
      },
    }),
    sinSedes
      ? ([] as Fila[])
      : (prisma.productoStock.findMany({
          where: { productoId: { in: ids }, sedeId: { in: sedeIds } },
          select: {
            productoId: true,
            sedeId: true,
            stock: true,
            visibleEnSede: true,
            vendibleEnSede: true,
          },
        }) as Promise<Fila[]>),
    sinSedes
      ? ([] as ReservaSuma[])
      : (prisma.reserva.groupBy({
          by: ['productoId', 'sedeId'],
          where: {
            empresaId: params.empresaId,
            productoId: { in: ids },
            sedeId: { in: sedeIds },
            estado: { in: ESTADOS_RESERVA_ACTIVA },
          },
          _sum: { cantidad: true },
        }) as unknown as Promise<ReservaSuma[]>),
  ]);

  const clave = (productoId: number, sedeId: number) =>
    `${productoId}:${sedeId}`;
  const filaPorClave = new Map<string, Fila>(
    (filas ?? []).map((f) => [clave(f.productoId, f.sedeId), f] as const),
  );
  const reservaPorClave = new Map<string, number>(
    (reservas ?? []).map(
      (r) => [clave(r.productoId, r.sedeId), num(r._sum?.cantidad)] as const,
    ),
  );

  for (const p of productos ?? []) {
    const stockGlobal = num(p.stock);
    const porcentajeProvision = Number(p.porcentajeProvision ?? 0);
    const porSede = new Map<number, StockEnSede>();
    for (const sedeId of sedeIds) {
      const fila = filaPorClave.get(clave(p.id, sedeId));
      const stockBase = fila
        ? num(fila.stock)
        : params.sinFilaUsaStockGlobal
          ? stockGlobal
          : 0;
      const reservado = reservaPorClave.get(clave(p.id, sedeId)) ?? 0;
      const visible = fila ? fila.visibleEnSede !== false : true;
      porSede.set(sedeId, {
        sedeId,
        tieneFila: !!fila,
        stockBase,
        reservado,
        disponible: disponibleParaVenta({
          stockBase,
          reservado,
          porcentajeProvision,
        }),
        visible,
        vendible: visible && (fila ? fila.vendibleEnSede !== false : true),
      });
    }
    resultado.set(p.id, {
      id: p.id,
      stockGlobal,
      porcentajeProvision,
      esServicio: esProductoServicio(p.atributosTecnicos),
      porSede,
    });
  }
  return resultado;
}
