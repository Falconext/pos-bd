/**
 * Resumen de ventas agregado POR PRODUCTO.
 *
 * Pedido de un empresario (DENISS LUBRINORT): el Excel del Panel de Ventas es
 * un detalle por venta —el mismo producto se repite una fila por cada venta—,
 * y quería lo contrario: cuántas unidades de CADA producto vendió en el
 * período, con el valor sin IGV y con IGV. Columnas: Producto, Cantidad,
 * Valor, Valor con IGV.
 *
 * Vive aparte de la consulta para poder probar la suma y el orden sin tocar la
 * base.
 */

/** Una línea de comprobante, con lo mínimo para sumar por producto. */
export interface LineaVenta {
    /** Id del producto; null para ítems libres (se agrupan por descripción). */
    productoId?: number | null;
    descripcion?: string | null;
    cantidad?: unknown;
    /** Valor de venta de la línea SIN IGV (mtoValorVenta). */
    valorSinIgv?: unknown;
    /** IGV de la línea (0 en exonerados/inafectos). */
    igv?: unknown;
}

export interface FilaProducto {
    producto: string;
    cantidad: number;
    valor: number; // sin IGV
    valorConIgv: number;
}

const numero = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const texto = (v: unknown): string => String(v ?? '').trim();

const redondear = (n: number): number => Number(n.toFixed(2));

/**
 * Agrupa las líneas por producto y suma cantidad, valor sin IGV y valor con
 * IGV. Ordena por cantidad vendida de mayor a menor (lo más vendido arriba),
 * y a igual cantidad, por nombre, para que el reporte sea estable.
 *
 * Los ítems libres (sin productoId) se agrupan por su descripción: igual son
 * ventas reales que el empresario quiere ver.
 */
export const agregarVentasPorProducto = (lineas: LineaVenta[]): FilaProducto[] => {
    const acumulado = new Map<string, FilaProducto>();
    for (const l of lineas ?? []) {
        const cantidad = numero(l?.cantidad);
        if (!(cantidad > 0)) continue;
        const nombre = texto(l?.descripcion) || 'Sin descripción';
        // Clave: productoId si existe; si no, la descripción (ítem libre).
        const clave =
            l?.productoId != null && Number.isFinite(Number(l.productoId))
                ? `id:${Number(l.productoId)}`
                : `txt:${nombre.toLowerCase()}`;
        const valorSinIgv = numero(l?.valorSinIgv);
        const igv = numero(l?.igv);

        const fila = acumulado.get(clave) ?? {
            producto: nombre,
            cantidad: 0,
            valor: 0,
            valorConIgv: 0,
        };
        fila.cantidad += cantidad;
        fila.valor += valorSinIgv;
        fila.valorConIgv += valorSinIgv + igv;
        acumulado.set(clave, fila);
    }

    return Array.from(acumulado.values())
        .map((f) => ({
            producto: f.producto,
            cantidad: redondear(f.cantidad),
            valor: redondear(f.valor),
            valorConIgv: redondear(f.valorConIgv),
        }))
        .sort((a, b) => b.cantidad - a.cantidad || a.producto.localeCompare(b.producto, 'es'));
};

/** Los totales del pie del reporte. */
export const totalesVentasPorProducto = (filas: FilaProducto[]) => ({
    cantidad: redondear((filas ?? []).reduce((s, f) => s + f.cantidad, 0)),
    valor: redondear((filas ?? []).reduce((s, f) => s + f.valor, 0)),
    valorConIgv: redondear((filas ?? []).reduce((s, f) => s + f.valorConIgv, 0)),
});
