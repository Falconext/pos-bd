/**
 * De varias notas de venta a una sola orden de compra.
 *
 * Pedido de empresarios que trabajan con preventa: toman pedidos durante la
 * semana (Notas de Venta / de Pedido) y al final le compran todo junto al
 * proveedor. Acá se suma lo vendido por producto, en unidades sueltas igual
 * que el stock: un paquete de 6 vendido 2 veces son 12, y un kit se abre en
 * sus componentes (al proveedor se le compran los productos, no el kit).
 *
 * Sin Prisma, para poder probarlo entero.
 */

import { componentesQueQuedan } from '../comprobante/kit-quitados';

export interface LineaVendida {
    productoId: number | null;
    descripcion?: string | null;
    cantidad?: unknown;
    unidadesPorPaquete?: number | null;
    comboId?: number | null;
    /** Productos que el cliente pidió quitar del kit: no se compran. */
    kitQuitados?: unknown;
}

export interface VentaOrigen {
    id: number;
    documento: string;
    cliente?: string | null;
    detalles: LineaVendida[];
}

export interface ProductoParaComprar {
    id: number;
    descripcion: string;
    codigo?: string | null;
    costo: number;
    gravado: boolean;
    stock: number;
    /** Servicios y similares: no se le compran a un proveedor. */
    seCompra: boolean;
}

export interface ComponenteKit {
    productoId: number;
    cantidad: number;
}

export interface LineaConsolidada {
    productoId: number | null;
    descripcion: string;
    codigo: string | null;
    /** Unidades vendidas sumando todas las notas. */
    cantidadVendida: number;
    stock: number;
    precioUnitario: number;
    gravado: boolean;
    /** De qué notas sale esta línea y cuánto aporta cada una. */
    origenes: { documento: string; cantidad: number }[];
}

const numero = (valor: unknown): number => {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

const redondear = (n: number) => Math.round(n * 1000) / 1000;

const texto = (valor: unknown) => String(valor ?? '').trim();

export function consolidarVentas(
    ventas: VentaOrigen[],
    productos: Map<number, ProductoParaComprar>,
    kits: Map<number, ComponenteKit[]>,
): { lineas: LineaConsolidada[]; omitidas: string[] } {
    const porClave = new Map<string, LineaConsolidada>();
    const omitidas = new Set<string>();

    const sumar = (
        clave: string,
        base: () => Omit<LineaConsolidada, 'cantidadVendida' | 'origenes'>,
        cantidad: number,
        documento: string,
    ) => {
        if (cantidad <= 0) return;
        let linea = porClave.get(clave);
        if (!linea) {
            linea = { ...base(), cantidadVendida: 0, origenes: [] };
            porClave.set(clave, linea);
        }
        linea.cantidadVendida = redondear(linea.cantidadVendida + cantidad);
        const origen = linea.origenes.find((o) => o.documento === documento);
        if (origen) origen.cantidad = redondear(origen.cantidad + cantidad);
        else linea.origenes.push({ documento, cantidad: redondear(cantidad) });
    };

    const sumarProducto = (productoId: number, cantidad: number, documento: string, respaldo: string) => {
        const p = productos.get(productoId);
        if (!p) {
            // Producto borrado del catálogo: se pide como texto para no perderlo.
            sumarLibre(respaldo, cantidad, documento);
            return;
        }
        if (!p.seCompra) {
            omitidas.add(p.descripcion);
            return;
        }
        sumar(
            `p:${productoId}`,
            () => ({
                productoId,
                descripcion: p.descripcion,
                codigo: p.codigo ?? null,
                stock: p.stock,
                precioUnitario: p.costo,
                gravado: p.gravado,
            }),
            cantidad,
            documento,
        );
    };

    const sumarLibre = (descripcion: string, cantidad: number, documento: string) => {
        const nombre = texto(descripcion).toUpperCase();
        if (!nombre) return;
        sumar(
            `t:${nombre}`,
            () => ({ productoId: null, descripcion: nombre, codigo: null, stock: 0, precioUnitario: 0, gravado: true }),
            cantidad,
            documento,
        );
    };

    for (const venta of ventas ?? []) {
        const documento = texto(venta.documento);
        for (const d of venta.detalles ?? []) {
            const cantidad = numero(d.cantidad);
            if (cantidad <= 0) continue;
            const componentes = d.comboId ? componentesQueQuedan(kits.get(Number(d.comboId)) ?? [], d.kitQuitados) : undefined;
            if (componentes?.length) {
                for (const c of componentes) {
                    sumarProducto(c.productoId, cantidad * numero(c.cantidad), documento, texto(d.descripcion));
                }
                continue;
            }
            const unidades = cantidad * (Number(d.unidadesPorPaquete) > 1 ? Number(d.unidadesPorPaquete) : 1);
            if (Number(d.productoId) > 0) sumarProducto(Number(d.productoId), unidades, documento, texto(d.descripcion));
            else sumarLibre(texto(d.descripcion), unidades, documento);
        }
    }

    const lineas = [...porClave.values()].sort((a, b) => {
        // Primero los del catálogo; dentro, lo que más se vendió.
        if ((a.productoId === null) !== (b.productoId === null)) return a.productoId === null ? 1 : -1;
        return b.cantidadVendida - a.cantidadVendida || a.descripcion.localeCompare(b.descripcion);
    });
    return { lineas, omitidas: [...omitidas] };
}
