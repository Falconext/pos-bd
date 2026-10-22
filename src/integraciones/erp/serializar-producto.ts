/**
 * Cómo ve un producto la API de Krezka (`/api/v1/erp`).
 *
 * Es el contrato público: los nombres van en inglés y snake_case como el
 * resto de las APIs del portal, y nunca exponen lo interno (costos, comisión,
 * márgenes). Quien lo consume es la web del negocio, que solo necesita lo que
 * vería un cliente.
 */
import { disponibilidadEfectiva } from '../../producto/disponibilidad.util';

/** Productos que el sistema crea para cuadrar comprobantes; no son mercadería. */
export const CODIGOS_FANTASMA = ['DGD', 'IPM', 'PLD'];

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const dinero = (v: unknown): number => Math.round(num(v) * 100) / 100;
const cantidad = (v: unknown): number => Math.round(num(v) * 1000) / 1000;

export function parseImagenesExtra(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((u): u is string => typeof u === 'string' && !!u.trim());
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p.filter((u): u is string => typeof u === 'string' && !!u.trim()) : [];
  } catch {
    return [];
  }
}

/** La oferta vale solo si está activa y dentro de sus fechas. */
export function precioDeOferta(
  p: { ofertaActiva?: boolean | null; precioOferta?: unknown; fechaInicioOferta?: Date | null; fechaFinOferta?: Date | null },
  ahora = new Date(),
): number | null {
  if (!p.ofertaActiva || p.precioOferta == null || num(p.precioOferta) <= 0) return null;
  if (p.fechaInicioOferta && ahora < new Date(p.fechaInicioOferta)) return null;
  if (p.fechaFinOferta && ahora > new Date(p.fechaFinOferta)) return null;
  return dinero(p.precioOferta);
}

export interface FilaStock {
  sedeId: number;
  stock: unknown;
  visibleEnSede?: boolean | null;
  vendibleEnSede?: boolean | null;
  precioUnitarioOverride?: unknown;
  precioOfertaOverride?: unknown;
  sede?: { nombre?: string | null } | null;
}

/**
 * Stock por sede y total. Sin filas por sede, el stock es el general del
 * producto (negocios de una sola sede que nunca repartieron). Con `sedeId`, el
 * total es el de esa sede: es lo que una web atada a una tienda física
 * necesita mostrar.
 */
export function stockDe(
  p: { stock?: unknown; stocks?: FilaStock[] },
  sedeId?: number | null,
): { total: number; porSede: { location_id: number; location: string | null; quantity: number }[] } {
  const filas = p.stocks ?? [];
  const porSede = filas.map((f) => ({
    location_id: f.sedeId,
    location: f.sede?.nombre ?? null,
    quantity: cantidad(f.stock),
  }));
  if (sedeId) {
    const fila = filas.find((f) => f.sedeId === sedeId);
    return { total: cantidad(fila?.stock), porSede };
  }
  const total = filas.length ? porSede.reduce((a, s) => a + s.quantity, 0) : cantidad(p.stock);
  return { total: cantidad(total), porSede };
}

export interface ContextoSerializar {
  /** URL estable de una imagen (ver imagen-publica.ts), o null si no hay. */
  urlImagen: (productoId: number, indice: number) => string;
  sedeId?: number | null;
  ahora?: Date;
}

export function serializarProducto(p: any, ctx: ContextoSerializar): Record<string, unknown> {
  const { total, porSede } = stockDe(p, ctx.sedeId);
  const filaSede = ctx.sedeId ? (p.stocks ?? []).find((f: FilaStock) => f.sedeId === ctx.sedeId) : null;
  const precio = filaSede?.precioUnitarioOverride != null ? dinero(filaSede.precioUnitarioOverride) : dinero(p.precioUnitario);
  const oferta =
    filaSede?.precioOfertaOverride != null && num(filaSede.precioOfertaOverride) > 0
      ? dinero(filaSede.precioOfertaOverride)
      : precioDeOferta(p, ctx.ahora);
  const imagenes = [p.imagenUrl, ...parseImagenesExtra(p.imagenesExtra)].filter(Boolean);
  const disponibilidad = disponibilidadEfectiva({ disponibilidad: p.disponibilidad, stock: total });

  return {
    object: 'product',
    id: p.id,
    sku: p.codigo,
    barcode: p.codigoBarras || null,
    name: p.descripcion,
    description: p.descripcionLarga || null,
    price: precio,
    sale_price: oferta,
    currency: p.moneda || 'PEN',
    /** Los precios incluyen IGV cuando el producto está gravado. */
    tax_included: String(p.tipoAfectacionIGV ?? '10') === '10',
    unit: p.unidadMedida?.codigo ?? null,
    category: p.categoria ? { id: p.categoria.id, name: p.categoria.nombre } : null,
    brand: p.marca ? { id: p.marca.id, name: p.marca.nombre } : null,
    images: imagenes.map((_, i) => ctx.urlImagen(p.id, i)),
    stock: total,
    stock_by_location: porSede,
    /** in_stock | backorder | out_of_stock | discontinued */
    availability:
      disponibilidad === 'INMEDIATA'
        ? 'in_stock'
        : disponibilidad === 'BAJO_PEDIDO'
          ? 'backorder'
          : disponibilidad === 'NO_COMERCIAL'
            ? 'discontinued'
            : 'out_of_stock',
    published_in_store: p.publicarEnTienda !== false,
    featured: p.destacado === true,
    attributes: p.valoresAtributos ?? null,
    variants: (p.variantes ?? [])
      .filter((v: any) => String(v.estado ?? 'ACTIVO') === 'ACTIVO')
      .map((v: any) => {
        const s = stockDe(v, ctx.sedeId);
        return {
          id: v.id,
          sku: v.codigo,
          barcode: v.codigoBarras || null,
          attributes: v.valoresAtributos ?? null,
          price: dinero(v.precioUnitario) || precio,
          stock: s.total,
          stock_by_location: s.porSede,
        };
      }),
    created_at: p.creadoEn ? new Date(p.creadoEn).toISOString() : null,
  };
}
