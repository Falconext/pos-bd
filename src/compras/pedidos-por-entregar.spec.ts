import {
    documentoDe,
    productosRecibidos,
    pedidosQueEsperan,
    unidadesQueSeLiberan,
    avisoDeLlegada,
} from './pedidos-por-entregar';

/**
 * Cierre del flujo de KREZKA: cuando llega la orden de compra, avisar qué
 * Notas de Pedido quedaron listas para entregar.
 */
describe('pedidos por entregar', () => {
    /** Lo que trajo la orden: talla 39 (id 102) y talla 40 (id 103). */
    const loQueLlego = [
        { productoId: 102, descripcion: 'ZAPATILLA URBAN 300 T39', cantidad: 3 },
        { productoId: 103, descripcion: 'ZAPATILLA URBAN 300 T40', cantidad: 2 },
    ];

    const pedido = (id: number, correlativo: number, cliente: string, detalles: any[]) => ({
        id, serie: 'NP01', correlativo, cliente, detalles,
    });

    describe('documentoDe', () => {
        it('se lee igual que en la lista de comprobantes', () => {
            expect(documentoDe({ serie: 'NP01', correlativo: 45 })).toBe('NP01-00000045');
        });

        it('sin datos no inventa un documento', () => {
            expect(documentoDe({ serie: '', correlativo: '' })).toBe('');
        });
    });

    describe('productosRecibidos', () => {
        it('ignora las líneas de texto libre de la orden', () => {
            expect(productosRecibidos([...loQueLlego, { productoId: null, cantidad: 9 }]))
                .toEqual([102, 103]);
        });

        it('no repite un producto que vino en dos líneas', () => {
            expect(productosRecibidos([{ productoId: 102, cantidad: 1 }, { productoId: 102, cantidad: 2 }]))
                .toEqual([102]);
        });
    });

    describe('pedidosQueEsperan', () => {
        it('encuentra los pedidos que esperaban esta mercadería', () => {
            const listos = pedidosQueEsperan(loQueLlego, [
                pedido(500, 45, 'JUAN PEREZ', [{ productoId: 102, descripcion: 'T39', cantidad: 1 }]),
                pedido(501, 52, 'MARIA DIAZ', [{ productoId: 103, descripcion: 'T40', cantidad: 2 }]),
            ]);
            expect(listos.map((p) => p.documento)).toEqual(['NP01-00000045', 'NP01-00000052']);
            expect(listos[0].cliente).toBe('JUAN PEREZ');
        });

        it('deja fuera los pedidos de otra mercadería', () => {
            const listos = pedidosQueEsperan(loQueLlego, [
                pedido(502, 60, 'OTRO CLIENTE', [{ productoId: 999, descripcion: 'POLO', cantidad: 1 }]),
            ]);
            expect(listos).toEqual([]);
        });

        it('de un pedido mixto solo nombra lo que llegó, no el pedido entero', () => {
            // El resto del pedido puede seguir sin stock: decir "ya está listo"
            // completo sería mentirle a quien lo lee.
            const listos = pedidosQueEsperan(loQueLlego, [
                pedido(503, 70, 'ANA SOTO', [
                    { productoId: 102, descripcion: 'T39', cantidad: 1 },
                    { productoId: 999, descripcion: 'CASACA', cantidad: 1 },
                ]),
            ]);
            expect(listos[0].items).toEqual([{ productoId: 102, descripcion: 'T39', cantidad: 1 }]);
        });

        it('un cliente sin nombre no deja el aviso a medias', () => {
            const listos = pedidosQueEsperan(loQueLlego, [
                pedido(504, 80, '', [{ productoId: 102, descripcion: 'T39', cantidad: 1 }]),
            ]);
            expect(listos[0].cliente).toBe('Cliente sin nombre');
        });

        it('las líneas con cantidad cero o basura no cuentan', () => {
            const listos = pedidosQueEsperan(loQueLlego, [
                pedido(505, 90, 'X', [{ productoId: 102, descripcion: 'T39', cantidad: 0 }]),
            ]);
            expect(listos).toEqual([]);
        });

        it('si la orden solo traía texto libre, no hay nada que cruzar', () => {
            expect(pedidosQueEsperan([{ productoId: null, cantidad: 5 }], [
                pedido(506, 95, 'X', [{ productoId: 102, descripcion: 'T39', cantidad: 1 }]),
            ])).toEqual([]);
        });

        it('sin pedidos pendientes devuelve vacío, no revienta', () => {
            expect(pedidosQueEsperan(loQueLlego, [])).toEqual([]);
            expect(pedidosQueEsperan(loQueLlego, undefined as any)).toEqual([]);
        });
    });

    describe('unidadesQueSeLiberan', () => {
        it('suma lo que se puede entregar entre todos los pedidos', () => {
            const listos = pedidosQueEsperan(loQueLlego, [
                pedido(500, 45, 'A', [{ productoId: 102, descripcion: 'T39', cantidad: 1 }]),
                pedido(501, 52, 'B', [{ productoId: 103, descripcion: 'T40', cantidad: 2 }]),
            ]);
            expect(unidadesQueSeLiberan(listos)).toBe(3);
        });
    });

    describe('avisoDeLlegada', () => {
        const dosPedidos = () => pedidosQueEsperan(loQueLlego, [
            pedido(500, 45, 'JUAN PEREZ', [{ productoId: 102, descripcion: 'T39', cantidad: 1 }]),
            pedido(501, 52, 'MARIA DIAZ', [{ productoId: 103, descripcion: 'T40', cantidad: 2 }]),
        ]);

        it('nombra la orden, los pedidos y los clientes', () => {
            const aviso = avisoDeLlegada(77, 'OC-000045', dosPedidos())!;
            expect(aviso.titulo).toBe('Llegó mercadería de 2 pedidos pendientes');
            expect(aviso.mensaje).toContain('OC-000045');
            expect(aviso.mensaje).toContain('NP01-00000045 (JUAN PEREZ)');
            expect(aviso.mensaje).toContain('NP01-00000052 (MARIA DIAZ)');
        });

        it('dice cuántas unidades se destraban y qué hacer', () => {
            const aviso = avisoDeLlegada(77, 'OC-000045', dosPedidos())!;
            expect(aviso.mensaje).toContain('3 unidades listas');
            expect(aviso.mensaje).toMatch(/Conviértelos a boleta o factura/i);
        });

        it('un solo pedido va en singular', () => {
            const uno = pedidosQueEsperan(loQueLlego, [
                pedido(500, 45, 'JUAN PEREZ', [{ productoId: 102, descripcion: 'T39', cantidad: 1 }]),
            ]);
            const aviso = avisoDeLlegada(77, 'OC-000045', uno)!;
            expect(aviso.titulo).toBe('Llegó mercadería de un pedido pendiente');
            expect(aviso.mensaje).toContain('1 unidad lista');
        });

        it('con muchos pedidos nombra tres y resume el resto', () => {
            const muchos = pedidosQueEsperan(loQueLlego, [1, 2, 3, 4, 5].map((n) =>
                pedido(500 + n, n, `CLIENTE ${n}`, [{ productoId: 102, descripcion: 'T39', cantidad: 1 }]),
            ));
            const aviso = avisoDeLlegada(77, 'OC-000045', muchos)!;
            expect(aviso.mensaje).toContain('y 2 más');
            expect(aviso.mensaje).toContain('CLIENTE 3');
            expect(aviso.mensaje).not.toContain('CLIENTE 4');
        });

        it('NO se avisa una llegada que no destraba ningún pedido', () => {
            expect(avisoDeLlegada(77, 'OC-000045', [])).toBeNull();
            expect(avisoDeLlegada(77, 'OC-000045', undefined as any)).toBeNull();
        });

        it('el aviso lleva los ids para poder abrir los pedidos desde ahí', () => {
            const aviso = avisoDeLlegada(77, 'OC-000045', dosPedidos())!;
            expect(aviso.metaData).toEqual({
                tipo: 'PEDIDOS_POR_ENTREGAR',
                ordenCompraId: 77,
                comprobanteIds: [500, 501],
            });
        });
    });
});
