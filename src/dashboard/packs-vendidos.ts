import { montoEnPen } from '../common/utils/moneda.util';

/**
 * Packs (kits/combos) más vendidos.
 *
 * El pedido (tienda de regalos, 2026-10-19): "registro los insumos que vendo,
 * pero no sé cuántos ramos de rosas estoy vendiendo". Los rankings de
 * productos agrupan por producto y saltan las líneas sin producto, así que un
 * pack vendido como una sola línea (DetalleComprobante.comboId) no aparecía
 * en ninguno.
 */

export interface LineaPack {
  comboId: number;
  comprobanteId: number;
  tipoDoc: string;
  cantidad: number;
  /** Precio unitario con IGV y con el descuento ya aplicado. */
  mtoPrecioUnitario: number;
  tipoMoneda: string | null;
  tipoCambio: number | null;
  fechaEmision: Date;
}

export interface ComboInfo {
  id: number;
  nombre: string;
  imagenUrl: string | null;
  activo: boolean;
  precioCombo: number;
}

export interface PackVendido {
  comboId: number;
  nombre: string;
  imagenUrl: string | null;
  activo: boolean;
  precioCombo: number;
  /** Packs vendidos menos los devueltos con nota de crédito. */
  cantidad: number;
  /** En soles, con IGV: lo que pagó el cliente. */
  total: number;
  /** En cuántas ventas distintas salió. */
  ventas: number;
  ultimaVenta: Date | null;
  /** % de los packs vendidos en el periodo. */
  participacion: number;
}

/**
 * Suma por pack. Las notas de crédito (07) que llegan aquí son solo las que
 * corrigen una venta vigente (devolución parcial): las de anulación ya se
 * filtraron antes, porque su venta quedó ANULADA y no suma. Restan.
 *
 * Los packs activos que no se vendieron también salen, con cero: "cuál no se
 * vende" es la otra mitad de la pregunta.
 */
export function agruparPacksVendidos(lineas: LineaPack[], combos: ComboInfo[]): PackVendido[] {
  const porCombo = new Map<number, { cantidad: number; total: number; ventas: Set<number>; ultima: Date | null }>();
  for (const l of lineas) {
    const signo = l.tipoDoc === '07' ? -1 : 1;
    const acc = porCombo.get(l.comboId) ?? { cantidad: 0, total: 0, ventas: new Set<number>(), ultima: null };
    const cantidad = Number(l.cantidad) || 0;
    acc.cantidad += signo * cantidad;
    acc.total += signo * montoEnPen(cantidad * (Number(l.mtoPrecioUnitario) || 0), l.tipoMoneda, l.tipoCambio);
    if (signo > 0) {
      acc.ventas.add(l.comprobanteId);
      if (!acc.ultima || l.fechaEmision > acc.ultima) acc.ultima = l.fechaEmision;
    }
    porCombo.set(l.comboId, acc);
  }

  const totalPacks = [...porCombo.values()].reduce((s, a) => s + Math.max(0, a.cantidad), 0);
  const filas: PackVendido[] = [];
  for (const c of combos) {
    const acc = porCombo.get(c.id);
    if (!acc && !c.activo) continue; // inactivo y sin ventas en el periodo: no aporta
    const cantidad = redondear(acc?.cantidad ?? 0);
    filas.push({
      comboId: c.id,
      nombre: c.nombre,
      imagenUrl: c.imagenUrl,
      activo: c.activo,
      precioCombo: c.precioCombo,
      cantidad,
      total: Math.round((acc?.total ?? 0) * 100) / 100,
      ventas: acc?.ventas.size ?? 0,
      ultimaVenta: acc?.ultima ?? null,
      participacion: totalPacks > 0 ? Math.round((Math.max(0, cantidad) / totalPacks) * 1000) / 10 : 0,
    });
  }
  return filas.sort(
    (a, b) => b.cantidad - a.cantidad || b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'),
  );
}

function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}
