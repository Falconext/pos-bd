/**
 * Pedido de la tienda → nota de venta con su envío, en un clic.
 *
 * Es lo mismo que hace el punto de venta cuando se entra por el botón NV
 * (productos del pedido, cliente por DNI, despacho con la agencia elegida en
 * el checkout), pero sin pasar por la pantalla. Aquí viven las reglas puras;
 * `PedidoNotaVentaService` las aplica.
 */

export type MedioPagoNv = 'EFECTIVO' | 'YAPE' | 'PLIN' | 'TRANSFERENCIA' | 'TARJETA';
export const MEDIOS_PAGO_NV: MedioPagoNv[] = ['EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA'];

export interface ItemDePedido {
  productoId: number;
  cantidad: number;
  precioUnit: unknown;
  subtotal: unknown;
  esCombo?: boolean | null;
  comboId?: number | null;
  producto?: { descripcion?: string | null } | null;
}

export interface PedidoParaNv {
  total: unknown;
  costoEnvio: unknown;
  tipoEntrega: string;
  envioCourier?: string | null;
  envioAgenciaNombre?: string | null;
  agenciaEnvio?: string | null;
  items: ItemDePedido[];
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Líneas de la nota. El unitario sale del subtotal de cada línea (respeta
 * precios especiales del pedido) y, si el pedido tuvo un descuento global
 * (cupón), se reparte en proporción para que la nota cierre en el total del
 * pedido. El envío que paga el cliente va como una línea más, igual que en
 * el resto del sistema (`aplicacionMontoCliente: ITEM_ENVIO`).
 */
export function lineasDeNotaVenta(pedido: PedidoParaNv): Array<Record<string, unknown>> {
  const envio = r2(num(pedido.costoEnvio));
  const bruto = pedido.items.reduce((a, i) => a + num(i.subtotal), 0);
  const productos = r2(num(pedido.total) - envio);
  const descuento = Math.max(0, r2(bruto - productos));

  let repartido = 0;
  const lineas: Array<Record<string, unknown>> = pedido.items.map((i, idx) => {
    const cantidad = Math.max(1, Number(i.cantidad) || 1);
    const subtotal = num(i.subtotal) || num(i.precioUnit) * cantidad;
    const esUltima = idx === pedido.items.length - 1;
    const rebaja = esUltima
      ? r2(descuento - repartido)
      : bruto > 0
        ? r2((descuento * subtotal) / bruto)
        : 0;
    repartido = r2(repartido + rebaja);
    const unitario = Math.max(0, Math.round(((subtotal - rebaja) / cantidad) * 1e6) / 1e6);
    return i.esCombo && i.comboId
      ? { comboId: i.comboId, productoId: null, descripcion: i.producto?.descripcion ?? undefined, cantidad, nuevoValorUnitario: unitario }
      : { productoId: i.productoId, cantidad, nuevoValorUnitario: unitario };
  });

  if (envio > 0) {
    lineas.push({
      productoId: null,
      descripcion: descripcionEnvio(pedido),
      cantidad: 1,
      nuevoValorUnitario: envio,
      unidad: 'ZZ',
    });
  }
  return lineas;
}

function descripcionEnvio(p: PedidoParaNv): string {
  if (p.envioCourier === 'SHALOM') return `ENVÍO AGENCIA SHALOM${p.envioAgenciaNombre ? ` - ${p.envioAgenciaNombre}` : ''}`.toUpperCase().slice(0, 250);
  if (p.envioCourier === 'OLVA') return `ENVÍO AGENCIA OLVA${p.envioAgenciaNombre ? ` - ${p.envioAgenciaNombre}` : ''}`.toUpperCase().slice(0, 250);
  return 'ENVÍO DELIVERY';
}

/**
 * Cómo se cobra la nota según lo que dijo el negocio en el modal:
 *  - adelanto >= total → contado, ya pagó todo.
 *  - 0 < adelanto < total → pago parcial, el resto queda por cobrar.
 *  - sin adelanto → todo por cobrar ('CREDITO' en `crearInformal` = se cobra
 *    después, no una venta a crédito: es lo que deja el saldo pendiente).
 */
export function cobroDeNotaVenta(total: number, adelanto: number, medio: MedioPagoNv) {
  const t = r2(total);
  const a = Math.min(t, Math.max(0, r2(adelanto)));
  if (a >= t - 0.009) return { formaPagoTipo: 'CONTADO', medioPago: medio, porCobrar: 0, adelanto: t };
  if (a > 0) return { formaPagoTipo: 'CREDITO', adelanto: a, medioPago: medio, porCobrar: r2(t - a) };
  return { formaPagoTipo: 'CREDITO', porCobrar: t, adelanto: 0 };
}

/** Courier del despacho: el de la agencia elegida en el checkout o el que se le puso al pedido. */
export function transportistaDelPedido(p: PedidoParaNv): string {
  if (p.envioCourier === 'SHALOM') return 'SHALOM_PRO';
  if (p.envioCourier === 'OLVA') return 'OLVA';
  const a = String(p.agenciaEnvio ?? '').trim().toUpperCase();
  if (a.includes('SHALOM')) return a.includes('COD') ? 'SHALOM_COD' : 'SHALOM_PRO';
  if (a.includes('OLVA')) return 'OLVA';
  return 'PROPIOS';
}

/** Hoy en Lima (YYYY-MM-DD): la fecha estimada que el modal de envío exige. */
export function hoyLima(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);
}
