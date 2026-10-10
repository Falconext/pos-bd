import {
    agregarVentasPorProducto,
    totalesVentasPorProducto,
} from './ventas-por-producto';

/**
 * Pedido de DENISS LUBRINORT: el Excel por producto — Producto, Cantidad,
 * Valor (sin IGV), Valor con IGV — sumando cada producto en el período.
 */
const linea = (over: any = {}) => ({
    productoId: 1,
    descripcion: 'APM 20W50 4T FULL SINTETICO - LATA',
    cantidad: 12,
    valorSinIgv: 350,
    igv: 63,
    ...over,
});

describe('agregarVentasPorProducto', () => {
    it('suma la misma referencia vendida en varias ventas en UNA fila', () => {
        const r = agregarVentasPorProducto([
            linea({ cantidad: 12, valorSinIgv: 350, igv: 63 }),
            linea({ cantidad: 24, valorSinIgv: 700, igv: 126 }),
            linea({ cantidad: 12, valorSinIgv: 350, igv: 63 }),
        ]);
        expect(r).toHaveLength(1);
        expect(r[0].cantidad).toBe(48);
        expect(r[0].valor).toBe(1400);
        expect(r[0].valorConIgv).toBe(1652); // 1400 + 252
    });

    it('separa productos distintos', () => {
        const r = agregarVentasPorProducto([
            linea({ productoId: 1, descripcion: 'ACEITE A', cantidad: 10 }),
            linea({ productoId: 2, descripcion: 'ACEITE B', cantidad: 5 }),
        ]);
        expect(r.map((f) => f.producto)).toEqual(['ACEITE A', 'ACEITE B']);
    });

    it('ordena por cantidad vendida, de mayor a menor', () => {
        const r = agregarVentasPorProducto([
            linea({ productoId: 1, descripcion: 'POCO', cantidad: 3 }),
            linea({ productoId: 2, descripcion: 'MUCHO', cantidad: 50 }),
            linea({ productoId: 3, descripcion: 'MEDIO', cantidad: 20 }),
        ]);
        expect(r.map((f) => f.producto)).toEqual(['MUCHO', 'MEDIO', 'POCO']);
    });

    it('a igual cantidad, ordena por nombre (estable)', () => {
        const r = agregarVentasPorProducto([
            linea({ productoId: 1, descripcion: 'ZETA', cantidad: 10 }),
            linea({ productoId: 2, descripcion: 'ALFA', cantidad: 10 }),
        ]);
        expect(r.map((f) => f.producto)).toEqual(['ALFA', 'ZETA']);
    });

    it('un producto exonerado: valor con IGV = valor sin IGV', () => {
        const r = agregarVentasPorProducto([
            linea({ descripcion: 'LIBRO', cantidad: 2, valorSinIgv: 100, igv: 0 }),
        ]);
        expect(r[0].valor).toBe(100);
        expect(r[0].valorConIgv).toBe(100);
    });

    it('los ítems libres (sin productoId) se agrupan por descripción', () => {
        const r = agregarVentasPorProducto([
            { productoId: null, descripcion: 'Servicio de corte', cantidad: 1, valorSinIgv: 50, igv: 9 },
            { productoId: null, descripcion: 'Servicio de corte', cantidad: 2, valorSinIgv: 100, igv: 18 },
        ]);
        expect(r).toHaveLength(1);
        expect(r[0].cantidad).toBe(3);
        expect(r[0].valorConIgv).toBe(177); // 150 + 27
    });

    it('un mismo producto en moneda/precios distintos igual se suma por id', () => {
        const r = agregarVentasPorProducto([
            linea({ productoId: 7, descripcion: 'ACEITE', cantidad: 1, valorSinIgv: 10, igv: 1.8 }),
            linea({ productoId: 7, descripcion: 'ACEITE (promo)', cantidad: 1, valorSinIgv: 8, igv: 1.44 }),
        ]);
        expect(r).toHaveLength(1);
        expect(r[0].cantidad).toBe(2);
    });

    it('cantidades en cero, negativas o basura no cuentan', () => {
        const r = agregarVentasPorProducto([
            linea({ cantidad: 0 }),
            linea({ cantidad: -5 }),
            linea({ cantidad: 'abc' }),
            linea({ cantidad: 10 }),
        ]);
        expect(r).toHaveLength(1);
        expect(r[0].cantidad).toBe(10);
    });

    it('acepta cantidades decimales (venta por fracción / metros)', () => {
        const r = agregarVentasPorProducto([
            linea({ cantidad: 2.5, valorSinIgv: 25, igv: 4.5 }),
            linea({ cantidad: 1.25, valorSinIgv: 12.5, igv: 2.25 }),
        ]);
        expect(r[0].cantidad).toBe(3.75);
    });

    it('lista vacía o nula no revienta', () => {
        expect(agregarVentasPorProducto([])).toEqual([]);
        expect(agregarVentasPorProducto(undefined as any)).toEqual([]);
    });
});

describe('totalesVentasPorProducto', () => {
    it('suma las tres columnas para el pie', () => {
        const filas = agregarVentasPorProducto([
            linea({ productoId: 1, descripcion: 'A', cantidad: 10, valorSinIgv: 100, igv: 18 }),
            linea({ productoId: 2, descripcion: 'B', cantidad: 5, valorSinIgv: 50, igv: 9 }),
        ]);
        expect(totalesVentasPorProducto(filas)).toEqual({ cantidad: 15, valor: 150, valorConIgv: 177 });
    });

    it('el total de cantidades coincide con la suma de las filas', () => {
        const filas = agregarVentasPorProducto([
            linea({ productoId: 1, descripcion: 'A', cantidad: 12 }),
            linea({ productoId: 2, descripcion: 'B', cantidad: 24 }),
            linea({ productoId: 1, descripcion: 'A', cantidad: 12 }),
        ]);
        const sumaFilas = filas.reduce((s, f) => s + f.cantidad, 0);
        expect(totalesVentasPorProducto(filas).cantidad).toBe(sumaFilas);
    });
});
