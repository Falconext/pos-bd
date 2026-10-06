/**
 * Stock en camino: lo que ya se le pidió al proveedor y todavía no llegó.
 *
 * Pedido de KREZKA (Pierre): las vendedoras cierran ventas de tallas que aún
 * no están en el inventario porque vienen en una orden de compra. Hoy el
 * sistema solo sabe lo que hay en el almacén, así que la vendedora no tiene
 * cómo responder "¿llega o no llega?" sin preguntar.
 *
 * Una orden de compra se recibe entera (pasa a RECIBIDA y nace la Compra que
 * sí mueve el kardex), no hay recepción parcial. Entonces "en camino" es
 * exactamente lo pedido en las órdenes EMITIDAS: lo demás o todavía no se
 * mandó (BORRADOR), o ya entró al stock (RECIBIDA), o se canceló (ANULADA).
 *
 * Esto NO es stock: no se vende contra él ni se suma al inventario valorizado.
 * Es información para el vendedor y para quien repone.
 */

/** Único estado que representa mercadería pedida y no recibida. */
export const ESTADO_EN_CAMINO = 'EMITIDA';

export interface DetallePedido {
    productoId: number | null;
    cantidad: unknown;
    /** Fecha comprometida de entrega de la orden, si la tiene. */
    fechaEntrega?: Date | string | null;
    proveedor?: string | null;
    numero?: number | null;
}

export interface EnCaminoDeProducto {
    cantidad: number;
    /** La entrega más próxima comprometida, o null si ninguna orden la tiene. */
    proximaEntrega: string | null;
    /** Órdenes que lo traen, para poder decirle al cliente de dónde sale. */
    ordenes: { numero: number | null; proveedor: string | null; cantidad: number; fechaEntrega: string | null }[];
}

const numero = (valor: unknown): number => {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
};

const soloDia = (valor: Date | string | null | undefined): string | null => {
    if (!valor) return null;
    const fecha = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(fecha.getTime())) return null;
    return fecha.toISOString().slice(0, 10);
};

/**
 * Agrupa por producto lo pedido y no recibido.
 *
 * Las líneas sin `productoId` (texto libre en la orden) se ignoran: no se
 * pueden atribuir a nada del catálogo y meterían ruido en el inventario.
 * Las cantidades no positivas tampoco cuentan.
 */
export const agruparEnCamino = (detalles: DetallePedido[]): Map<number, EnCaminoDeProducto> => {
    const porProducto = new Map<number, EnCaminoDeProducto>();
    for (const d of detalles ?? []) {
        const productoId = Number(d?.productoId);
        const cantidad = numero(d?.cantidad);
        if (!Number.isFinite(productoId) || productoId <= 0 || cantidad <= 0) continue;

        const fechaEntrega = soloDia(d?.fechaEntrega);
        const actual = porProducto.get(productoId) ?? { cantidad: 0, proximaEntrega: null, ordenes: [] };
        actual.cantidad = Number((actual.cantidad + cantidad).toFixed(4));
        actual.ordenes.push({
            numero: d?.numero ?? null,
            proveedor: d?.proveedor ?? null,
            cantidad,
            fechaEntrega,
        });
        if (fechaEntrega && (!actual.proximaEntrega || fechaEntrega < actual.proximaEntrega)) {
            actual.proximaEntrega = fechaEntrega;
        }
        porProducto.set(productoId, actual);
    }
    return porProducto;
};

/** Cuántas unidades vienen en camino de un producto (0 si ninguna). */
export const cantidadEnCamino = (
    mapa: Map<number, EnCaminoDeProducto> | undefined,
    productoId: number,
): number => mapa?.get(productoId)?.cantidad ?? 0;

/**
 * Lo que la vendedora necesita saber parada frente al cliente.
 *
 * Nunca promete entrega: si la orden no tiene fecha comprometida, lo dice.
 */
export const textoParaVendedor = (
    stock: unknown,
    enCamino: unknown,
    proximaEntrega?: string | null,
): string => {
    const hay = numero(stock);
    const viene = numero(enCamino);
    if (viene <= 0) return hay > 0 ? `${hay} disponibles` : 'Sin stock';
    const llegada = proximaEntrega ? ` (llega ${proximaEntrega})` : ' (sin fecha confirmada)';
    if (hay > 0) return `${hay} disponibles · ${viene} en camino${llegada}`;
    return `Sin stock · ${viene} en camino${llegada}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Disponibilidad completa: qué puede prometer el vendedor sin vender dos veces
// la misma unidad.
//
// Con "en camino" a secas no alcanzaba: dos vendedoras veían las mismas 3
// unidades que vienen y las dos tomaban el pedido. Lo ya prometido sale de las
// Notas de Pedido todavía sin convertir, que es el documento con el que se
// aparta la mercadería y que no descuenta stock.
// ─────────────────────────────────────────────────────────────────────────────

export interface Disponibilidad {
    /** Físico en el almacén. */
    stock: number;
    /** Reservas activas del módulo de reservas. */
    reservado: number;
    /** Pedido al proveedor y no recibido (órdenes EMITIDAS). */
    enCamino: number;
    /** Ya prometido en Notas de Pedido sin entregar. */
    comprometido: number;
}

export type SituacionDisponibilidad =
    | 'disponible' /** hay en el almacén y no está prometido: se entrega ya */
    | 'por-llegar' /** no hay, pero viene y todavía queda sin prometer */
    | 'comprometido' /** todo lo que hay y lo que viene ya está vendido */
    | 'agotado'; /** no hay, no viene, no se promete nada */

const sano = (valor: unknown): number => {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

export const normalizarDisponibilidad = (d: Partial<Disponibilidad> | null | undefined): Disponibilidad => ({
    stock: sano(d?.stock),
    reservado: sano(d?.reservado),
    enCamino: sano(d?.enCamino),
    comprometido: sano(d?.comprometido),
});

/** Lo que se puede sacar HOY del almacén, descontando reservas y promesas. */
export const entregableAhora = (d: Partial<Disponibilidad>): number => {
    const { stock, reservado, comprometido } = normalizarDisponibilidad(d);
    return Math.max(0, stock - reservado - comprometido);
};

/**
 * Cuánto más se puede prometer, contando lo que hay y lo que viene.
 *
 * Puede dar negativo a propósito: significa que ya se prometió más de lo que
 * va a existir, y eso hay que verlo, no esconderlo.
 */
export const saldoPrometible = (d: Partial<Disponibilidad>): number => {
    const { stock, reservado, enCamino, comprometido } = normalizarDisponibilidad(d);
    return Number(((stock - reservado) + enCamino - comprometido).toFixed(4));
};

/** ¿Alcanza para tomar un pedido de esta cantidad? */
export const puedePrometer = (d: Partial<Disponibilidad>, cantidad: unknown): boolean =>
    saldoPrometible(d) >= sano(cantidad) && sano(cantidad) > 0;

export const situacionDisponibilidad = (d: Partial<Disponibilidad>): SituacionDisponibilidad => {
    const datos = normalizarDisponibilidad(d);
    if (entregableAhora(datos) > 0) return 'disponible';
    if (saldoPrometible(datos) > 0) return 'por-llegar';
    return datos.enCamino > 0 || datos.comprometido > 0 ? 'comprometido' : 'agotado';
};

/** Lo que el sistema le dice al vendedor antes de que prometa una entrega. */
export const avisoParaElVendedor = (d: Partial<Disponibilidad>): string => {
    const datos = normalizarDisponibilidad(d);
    const entregable = entregableAhora(datos);
    const saldo = saldoPrometible(datos);
    switch (situacionDisponibilidad(datos)) {
        case 'disponible':
            return `${entregable} para entregar ahora`;
        case 'por-llegar':
            return `Sin stock libre · puedes comprometer ${saldo} de los ${datos.enCamino} que vienen`;
        case 'comprometido':
            return saldo < 0
                ? `Ya se prometieron ${Math.abs(saldo)} más de las que habrá. Revisa los pedidos pendientes.`
                : 'Todo lo que hay y lo que viene ya está comprometido en pedidos';
        default:
            return 'Sin stock y sin reposición pedida';
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Agregado padre ← variantes.
//
// El stock del producto padre ya es la suma de sus variantes ACTIVAS
// (`sincronizarStockPadre`). "En camino" y "comprometido" tienen que seguir la
// misma regla: si no, un modelo con 40 unidades pedidas en 6 tallas se ve en la
// lista como si no viniera nada, y hay que abrir modelo por modelo para
// enterarse.
// ─────────────────────────────────────────────────────────────────────────────

export interface AporteDeVariante {
    enCamino?: unknown;
    enCaminoProximaEntrega?: string | null;
    comprometido?: unknown;
}

export interface AgregadoDelPadre {
    enCamino: number;
    enCaminoProximaEntrega: string | null;
    comprometido: number;
    saldoPrometible: number;
}

const positivo = (valor: unknown): number => {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Suma lo propio del padre más lo de cada variante.
 *
 * La próxima entrega es la más cercana de todo el modelo: es la fecha que el
 * vendedor puede decirle al cliente sin abrir el desglose.
 */
export const agregarDeVariantes = (
    propio: AporteDeVariante,
    variantes: AporteDeVariante[] | null | undefined,
    stockDelPadre: unknown = 0,
    reservadoDelPadre: unknown = 0,
): AgregadoDelPadre => {
    const partes = [propio ?? {}, ...(Array.isArray(variantes) ? variantes : [])];

    let enCamino = 0;
    let comprometido = 0;
    let proximaEntrega: string | null = null;

    for (const parte of partes) {
        enCamino += positivo(parte?.enCamino);
        comprometido += positivo(parte?.comprometido);
        const fecha = String(parte?.enCaminoProximaEntrega ?? '').trim();
        if (fecha && (!proximaEntrega || fecha < proximaEntrega)) proximaEntrega = fecha;
    }

    enCamino = Number(enCamino.toFixed(4));
    comprometido = Number(comprometido.toFixed(4));

    return {
        enCamino,
        enCaminoProximaEntrega: proximaEntrega,
        comprometido,
        saldoPrometible: saldoPrometible({
            stock: positivo(stockDelPadre),
            reservado: positivo(reservadoDelPadre),
            enCamino,
            comprometido,
        }),
    };
};
