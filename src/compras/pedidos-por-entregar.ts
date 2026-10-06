/**
 * Qué pedidos quedaron listos cuando llega una orden de compra.
 *
 * Cierre del flujo de KREZKA. Con "en camino" el vendedor ya sabe qué puede
 * prometer, pero faltaba el otro extremo: cuando la mercadería llega, nadie se
 * entera de que hay Notas de Pedido esperándola. La de hace tres semanas se
 * queda ahí hasta que el cliente llama a reclamar.
 *
 * Acá vive el cruce entre lo que entró y lo que está prometido, y el texto del
 * aviso. Sin Prisma, para poder probarlo entero.
 */

export interface LineaRecibida {
    productoId: number | null;
    descripcion?: string | null;
    cantidad?: unknown;
}

export interface PedidoPendiente {
    id: number;
    serie: string;
    correlativo: number | string;
    cliente?: string | null;
    detalles: { productoId: number | null; descripcion?: string | null; cantidad?: unknown }[];
}

export interface PedidoListo {
    comprobanteId: number;
    documento: string;
    cliente: string;
    /** Solo lo que llegó en esta orden, no el pedido completo. */
    items: { productoId: number; descripcion: string; cantidad: number }[];
}

const numero = (valor: unknown): number => {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

const texto = (valor: unknown): string => String(valor ?? '').trim();

/** "NP01-00000045", como se lee en la lista de comprobantes. */
export const documentoDe = (pedido: Pick<PedidoPendiente, 'serie' | 'correlativo'>): string => {
    const serie = texto(pedido?.serie);
    const correlativo = texto(pedido?.correlativo);
    if (!serie && !correlativo) return '';
    return `${serie}-${correlativo.padStart(8, '0')}`;
};

/** Los productos que trajo la orden, sin las líneas de texto libre. */
export const productosRecibidos = (lineas: LineaRecibida[]): number[] =>
    Array.from(
        new Set(
            (lineas ?? [])
                .map((l) => Number(l?.productoId))
                .filter((id) => Number.isFinite(id) && id > 0),
        ),
    );

/**
 * Cruza lo que llegó con lo que está prometido.
 *
 * Un pedido entra solo si tiene alguna línea de lo que llegó, y de él se
 * muestran únicamente esos ítems: nombrar el pedido completo confundiría al
 * que lo lee, porque el resto puede seguir sin stock.
 */
export const pedidosQueEsperan = (
    lineasRecibidas: LineaRecibida[],
    pedidos: PedidoPendiente[],
): PedidoListo[] => {
    const llegaron = new Set(productosRecibidos(lineasRecibidas));
    if (llegaron.size === 0) return [];

    const listos: PedidoListo[] = [];
    for (const pedido of pedidos ?? []) {
        const items = (pedido?.detalles ?? [])
            .filter((d) => llegaron.has(Number(d?.productoId)) && numero(d?.cantidad) > 0)
            .map((d) => ({
                productoId: Number(d.productoId),
                descripcion: texto(d.descripcion),
                cantidad: numero(d.cantidad),
            }));
        if (items.length === 0) continue;
        listos.push({
            comprobanteId: Number(pedido.id),
            documento: documentoDe(pedido),
            cliente: texto(pedido.cliente) || 'Cliente sin nombre',
            items,
        });
    }
    return listos;
};

/** Total de unidades comprometidas que esta llegada permite entregar. */
export const unidadesQueSeLiberan = (listos: PedidoListo[]): number =>
    (listos ?? []).reduce(
        (total, pedido) => total + pedido.items.reduce((s, i) => s + i.cantidad, 0),
        0,
    );

export interface AvisoDeLlegada {
    titulo: string;
    mensaje: string;
    metaData: {
        tipo: 'PEDIDOS_POR_ENTREGAR';
        ordenCompraId: number;
        comprobanteIds: number[];
    };
}

/**
 * El aviso que recibe el administrador. Devuelve null si no hay nada que
 * avisar: no se notifica una llegada que no destraba ningún pedido.
 */
export const avisoDeLlegada = (
    ordenCompraId: number,
    numeroOrden: string,
    listos: PedidoListo[],
): AvisoDeLlegada | null => {
    if (!Array.isArray(listos) || listos.length === 0) return null;

    const unidades = unidadesQueSeLiberan(listos);
    const cuantos = listos.length;
    const titulo =
        cuantos === 1
            ? 'Llegó mercadería de un pedido pendiente'
            : `Llegó mercadería de ${cuantos} pedidos pendientes`;

    // Se nombran hasta tres; más que eso no entra en una notificación y el
    // detalle completo está en la pantalla de pedidos.
    const nombrados = listos
        .slice(0, 3)
        .map((p) => `${p.documento} (${p.cliente})`)
        .join(' · ');
    const resto = cuantos > 3 ? ` y ${cuantos - 3} más` : '';

    const mensaje =
        `La orden ${numeroOrden} entró al stock. ` +
        `Quedan ${unidades} unidad${unidades === 1 ? '' : 'es'} listas para entregar en ` +
        `${cuantos} pedido${cuantos === 1 ? '' : 's'}: ${nombrados}${resto}. ` +
        `Conviértelos a boleta o factura para cerrarlos.`;

    return {
        titulo,
        mensaje,
        metaData: {
            tipo: 'PEDIDOS_POR_ENTREGAR',
            ordenCompraId,
            comprobanteIds: listos.map((p) => p.comprobanteId),
        },
    };
};
