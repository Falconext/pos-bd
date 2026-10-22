/**
 * Modo prueba (sandbox) de la API de Krezka.
 *
 * Con una clave `sk_test_` la web del negocio puede probar su integración
 * contra su catálogo REAL sin tocarlo: cada escritura corre todas las
 * validaciones de verdad —producto, stock, lote, cliente, códigos repetidos—
 * y en el último paso, en vez de guardar, devuelve cómo habría quedado con
 * `livemode: false`. Nada se crea, no se mueve stock y nada va a SUNAT.
 *
 * Las lecturas devuelven los datos reales: para integrar hace falta ver el
 * catálogo de verdad.
 */
import type { AltaProducto } from './entrada-producto';

const AFECTACION_A_IMPUESTO: Record<string, string> = { '10': 'taxed', '20': 'exempt', '30': 'unaffected' };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dia = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** La clave es de prueba: lo que manda la web no se guarda. */
export const esPrueba = (req: any): boolean => req?.apiKey?.entorno === 'test';

/** El producto como habría quedado; sin id porque no se creó. */
export function productoSimulado(a: AltaProducto, sedeId: number) {
  return {
    object: 'product',
    livemode: false,
    id: null,
    name: a.descripcion,
    sku: a.codigo ?? null,
    barcode: a.codigoBarras ?? null,
    type: a.esServicio ? 'service' : 'product',
    price: a.precioUnitario,
    sale_price: a.precioOferta ?? null,
    sale_starts_on: dia(a.ofertaDesde),
    sale_ends_on: dia(a.ofertaHasta),
    currency: a.moneda,
    tax: AFECTACION_A_IMPUESTO[a.tipoAfectacionIGV] ?? 'taxed',
    category_id: a.categoriaId ?? null,
    brand_id: a.marcaId ?? null,
    images: a.imagenes ?? [],
    stock: a.esServicio ? null : a.stock,
    location_id: sedeId,
    batch: a.lote ? { number: a.lote.numero, expires_on: dia(a.lote.vence) } : null,
    packs: (a.presentaciones ?? []).map((x) => ({ barcode: x.codigo, units: x.unidadesPorPaquete, price: x.precioPaquete, name: x.alias ?? null })),
    variants: (a.variantes ?? []).map((v) => ({
      id: null,
      attributes: v.valores,
      sku: v.codigo ?? null,
      barcode: v.codigoBarras ?? null,
      price: v.precio ?? a.precioUnitario,
      image: v.imagen ?? null,
      stock: v.stock,
    })),
  };
}

export interface LineaSimulada {
  productoId: number | null;
  sku: string | null;
  descripcion: string;
  cantidad: number;
  precio: number;
  /** Catálogo 07: '10' gravado; el resto sin IGV. */
  afectacion: string;
}

/**
 * La venta como habría salido. El IGV se separa del precio (que ya lo trae)
 * igual que la emisión: solo en lo gravado. El número es el que tocaría
 * ahora; si entra otra venta antes, cambia.
 */
export function ventaSimulada(p: {
  tipo: string;
  numeroSiguiente: string | null;
  sedeId: number;
  externalId?: string;
  cliente?: { tipo?: string; numero?: string; nombre?: string };
  medioPago: string | null;
  lineas: LineaSimulada[];
}) {
  let gravado = 0;
  let sinIgv = 0;
  for (const l of p.lineas) {
    const total = r2(l.precio * l.cantidad);
    if (l.afectacion === '10') gravado += total;
    else sinIgv += total;
  }
  const igv = r2(gravado - gravado / 1.18);
  const total = r2(gravado + sinIgv);
  return {
    object: 'sale',
    livemode: false,
    id: null,
    external_id: p.externalId ?? null,
    document_type: p.tipo,
    number: null,
    number_preview: p.numeroSiguiente,
    status: 'test',
    sunat_message: null,
    location_id: p.sedeId,
    customer: p.cliente?.numero ? { document_type: p.cliente.tipo ?? null, document_number: p.cliente.numero, name: p.cliente.nombre ?? null } : null,
    items: p.lineas.map((l) => ({
      product_id: l.productoId,
      sku: l.sku,
      description: l.descripcion,
      quantity: l.cantidad,
      unit_price: l.precio,
      total: r2(l.precio * l.cantidad),
    })),
    subtotal: r2(total - igv),
    igv,
    total,
    currency: 'PEN',
    payment: { method: p.medioPago },
    pdf_url: null,
  };
}
