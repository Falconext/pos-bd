import {
    ESTADO_EN_CAMINO,
    agruparEnCamino,
    cantidadEnCamino,
    textoParaVendedor,
} from './stock-en-camino';

/**
 * Pedido de KREZKA: la vendedora cierra una venta de una talla que no está en
 * el almacén pero viene en una orden de compra. "En camino" es lo pedido en
 * órdenes EMITIDAS.
 */
describe('stock en camino', () => {
    const linea = (productoId: number | null, cantidad: unknown, extra: any = {}) => ({
        productoId,
        cantidad,
        fechaEntrega: null,
        proveedor: null,
        numero: null,
        ...extra,
    });

    it('solo las órdenes EMITIDAS cuentan como en camino', () => {
        expect(ESTADO_EN_CAMINO).toBe('EMITIDA');
    });

    describe('agruparEnCamino', () => {
        it('suma lo pedido del mismo producto en varias órdenes', () => {
            const r = agruparEnCamino([
                linea(10, 6, { numero: 1 }),
                linea(10, 4, { numero: 2 }),
                linea(11, 3, { numero: 2 }),
            ]);
            expect(r.get(10)?.cantidad).toBe(10);
            expect(r.get(11)?.cantidad).toBe(3);
        });

        it('guarda de qué órdenes viene, para poder decírselo al cliente', () => {
            const r = agruparEnCamino([
                linea(10, 6, { numero: 7, proveedor: 'TEXTILES SAC', fechaEntrega: '2026-10-20' }),
            ]);
            expect(r.get(10)?.ordenes).toEqual([
                { numero: 7, proveedor: 'TEXTILES SAC', cantidad: 6, fechaEntrega: '2026-10-20' },
            ]);
        });

        it('la próxima entrega es la más cercana de todas sus órdenes', () => {
            const r = agruparEnCamino([
                linea(10, 2, { fechaEntrega: '2026-11-15' }),
                linea(10, 3, { fechaEntrega: '2026-10-20' }),
                linea(10, 1, { fechaEntrega: '2026-12-01' }),
            ]);
            expect(r.get(10)?.proximaEntrega).toBe('2026-10-20');
        });

        it('si ninguna orden tiene fecha, no se inventa una', () => {
            const r = agruparEnCamino([linea(10, 5), linea(10, 2)]);
            expect(r.get(10)?.proximaEntrega).toBeNull();
            expect(r.get(10)?.cantidad).toBe(7);
        });

        it('una fecha presente manda sobre las que no la tienen', () => {
            const r = agruparEnCamino([linea(10, 5), linea(10, 2, { fechaEntrega: '2026-10-20' })]);
            expect(r.get(10)?.proximaEntrega).toBe('2026-10-20');
        });

        it('las líneas de texto libre (sin producto) se ignoran', () => {
            // En la orden se puede escribir un ítem suelto: no es nada del catálogo.
            const r = agruparEnCamino([linea(null, 50), linea(10, 5)]);
            expect(r.size).toBe(1);
            expect(r.get(10)?.cantidad).toBe(5);
        });

        it('cantidades en cero, negativas o basura no suman', () => {
            const r = agruparEnCamino([
                linea(10, 0), linea(10, -4), linea(10, 'abc'), linea(10, null), linea(10, 6),
            ]);
            expect(r.get(10)?.cantidad).toBe(6);
        });

        it('acepta cantidades decimales (metros, kilos)', () => {
            const r = agruparEnCamino([linea(10, 2.5), linea(10, '1.25')]);
            expect(r.get(10)?.cantidad).toBe(3.75);
        });

        it('una fecha inválida no rompe ni se guarda', () => {
            const r = agruparEnCamino([linea(10, 5, { fechaEntrega: 'mañana' })]);
            expect(r.get(10)?.proximaEntrega).toBeNull();
        });

        it('acepta Date además de texto', () => {
            const r = agruparEnCamino([linea(10, 5, { fechaEntrega: new Date('2026-10-20T00:00:00Z') })]);
            expect(r.get(10)?.proximaEntrega).toBe('2026-10-20');
        });

        it('lista vacía o nula devuelve un mapa vacío', () => {
            expect(agruparEnCamino([]).size).toBe(0);
            expect(agruparEnCamino(undefined as any).size).toBe(0);
        });
    });

    describe('cantidadEnCamino', () => {
        it('un producto sin órdenes abiertas tiene 0, no undefined', () => {
            const r = agruparEnCamino([linea(10, 5)]);
            expect(cantidadEnCamino(r, 99)).toBe(0);
            expect(cantidadEnCamino(undefined, 10)).toBe(0);
        });
    });

    describe('textoParaVendedor', () => {
        it('el caso de las vendedoras: sin stock pero viene en camino', () => {
            expect(textoParaVendedor(0, 6, '2026-10-20')).toBe('Sin stock · 6 en camino (llega 2026-10-20)');
        });

        it('nunca promete una fecha que la orden no tiene', () => {
            expect(textoParaVendedor(0, 6, null)).toBe('Sin stock · 6 en camino (sin fecha confirmada)');
        });

        it('con stock y además reposición, muestra las dos cosas', () => {
            expect(textoParaVendedor(3, 6, '2026-10-20')).toBe('3 disponibles · 6 en camino (llega 2026-10-20)');
        });

        it('sin nada en camino, se comporta como siempre', () => {
            expect(textoParaVendedor(3, 0)).toBe('3 disponibles');
            expect(textoParaVendedor(0, 0)).toBe('Sin stock');
        });
    });
});

/**
 * Fase 2: cuánto se puede prometer sin vender dos veces lo mismo.
 * El caso que lo motivó: dos vendedoras ven las mismas 3 unidades que vienen.
 */
describe('disponibilidad completa', () => {
    const {
        entregableAhora, saldoPrometible, puedePrometer,
        situacionDisponibilidad, avisoParaElVendedor, normalizarDisponibilidad,
    } = require('./stock-en-camino');

    describe('el caso de las dos vendedoras', () => {
        const talla39 = { stock: 0, reservado: 0, enCamino: 3, comprometido: 0 };

        it('la primera puede comprometer las 3 que vienen', () => {
            expect(saldoPrometible(talla39)).toBe(3);
            expect(puedePrometer(talla39, 3)).toBe(true);
        });

        it('tomado un pedido de 2, solo queda 1 por prometer', () => {
            const despues = { ...talla39, comprometido: 2 };
            expect(saldoPrometible(despues)).toBe(1);
            expect(puedePrometer(despues, 2)).toBe(false);
            expect(puedePrometer(despues, 1)).toBe(true);
        });

        it('comprometidas las 3, la segunda vendedora ya no puede prometer nada', () => {
            const agotado = { ...talla39, comprometido: 3 };
            expect(saldoPrometible(agotado)).toBe(0);
            expect(puedePrometer(agotado, 1)).toBe(false);
            expect(situacionDisponibilidad(agotado)).toBe('comprometido');
        });

        it('si igual se prometió de más, el número lo muestra en negativo', () => {
            const pasado = { ...talla39, comprometido: 5 };
            expect(saldoPrometible(pasado)).toBe(-2);
            expect(avisoParaElVendedor(pasado)).toContain('Ya se prometieron 2 más');
        });
    });

    describe('entregableAhora', () => {
        it('lo prometido no se puede volver a entregar', () => {
            expect(entregableAhora({ stock: 10, comprometido: 4 })).toBe(6);
        });

        it('las reservas también restan', () => {
            expect(entregableAhora({ stock: 10, reservado: 3, comprometido: 4 })).toBe(3);
        });

        it('nunca devuelve negativo', () => {
            expect(entregableAhora({ stock: 2, comprometido: 9 })).toBe(0);
        });

        it('lo que viene en camino NO se puede entregar hoy', () => {
            expect(entregableAhora({ stock: 0, enCamino: 50 })).toBe(0);
        });
    });

    describe('situacionDisponibilidad', () => {
        it('hay libre en el almacén: disponible', () => {
            expect(situacionDisponibilidad({ stock: 5, comprometido: 2 })).toBe('disponible');
        });

        it('no hay libre pero viene y queda saldo: por llegar', () => {
            expect(situacionDisponibilidad({ stock: 0, enCamino: 4, comprometido: 1 })).toBe('por-llegar');
        });

        it('todo lo que hay y lo que viene ya está vendido: comprometido', () => {
            expect(situacionDisponibilidad({ stock: 2, enCamino: 3, comprometido: 5 })).toBe('comprometido');
        });

        it('ni stock ni reposición: agotado', () => {
            expect(situacionDisponibilidad({ stock: 0 })).toBe('agotado');
        });
    });

    describe('avisoParaElVendedor', () => {
        it('dice cuántas puede comprometer, no cuántas vienen', () => {
            expect(avisoParaElVendedor({ stock: 0, enCamino: 6, comprometido: 4 }))
                .toBe('Sin stock libre · puedes comprometer 2 de los 6 que vienen');
        });

        it('con stock libre, dice lo que puede entregar ya', () => {
            expect(avisoParaElVendedor({ stock: 5, comprometido: 2 })).toBe('3 para entregar ahora');
        });
    });

    describe('datos sucios', () => {
        it('negativos, textos y nulos se normalizan a 0', () => {
            expect(normalizarDisponibilidad({ stock: -5, reservado: 'x', enCamino: null, comprometido: undefined }))
                .toEqual({ stock: 0, reservado: 0, enCamino: 0, comprometido: 0 });
            expect(normalizarDisponibilidad(null)).toEqual({ stock: 0, reservado: 0, enCamino: 0, comprometido: 0 });
        });

        it('prometer cantidad cero o negativa nunca es válido', () => {
            expect(puedePrometer({ stock: 10 }, 0)).toBe(false);
            expect(puedePrometer({ stock: 10 }, -1)).toBe(false);
        });

        it('cantidades decimales funcionan (metros, kilos)', () => {
            expect(saldoPrometible({ stock: 2.5, enCamino: 1.25, comprometido: 0.75 })).toBe(3);
        });
    });
});

/**
 * El padre agrega lo de sus variantes.
 *
 * Hallado en la demo en vivo: la orden de compra era de la talla Negro/S y el
 * modelo se veía en la lista sin ningún distintivo. Había que abrir el
 * desglose para enterarse de que venía mercadería.
 */
describe('agregarDeVariantes', () => {
    const { agregarDeVariantes } = require('./stock-en-camino');

    it('el caso de la demo: el modelo ahora muestra lo que viene de su talla', () => {
        const r = agregarDeVariantes(
            { enCamino: 0, comprometido: 0, enCaminoProximaEntrega: null },
            [
                { enCamino: 3, comprometido: 0, enCaminoProximaEntrega: '2026-10-20' },
                { enCamino: 0, comprometido: 0, enCaminoProximaEntrega: null },
            ],
            61,
        );
        expect(r.enCamino).toBe(3);
        expect(r.enCaminoProximaEntrega).toBe('2026-10-20');
    });

    it('suma lo pedido en varias tallas del mismo modelo', () => {
        const r = agregarDeVariantes({}, [
            { enCamino: 6 }, { enCamino: 4 }, { enCamino: 2 },
        ], 0);
        expect(r.enCamino).toBe(12);
    });

    it('la próxima entrega del modelo es la más cercana de todas sus tallas', () => {
        const r = agregarDeVariantes({}, [
            { enCamino: 2, enCaminoProximaEntrega: '2026-11-15' },
            { enCamino: 3, enCaminoProximaEntrega: '2026-10-20' },
            { enCamino: 1, enCaminoProximaEntrega: null },
        ], 0);
        expect(r.enCaminoProximaEntrega).toBe('2026-10-20');
    });

    it('da igual el orden en que vengan las tallas: siempre gana la más cercana', () => {
        // Con la cercana PRIMERO: si el código se quedara con la última, fallaría.
        const r = agregarDeVariantes({}, [
            { enCamino: 3, enCaminoProximaEntrega: '2026-10-20' },
            { enCamino: 2, enCaminoProximaEntrega: '2026-11-15' },
            { enCamino: 1, enCaminoProximaEntrega: '2026-12-01' },
        ], 0);
        expect(r.enCaminoProximaEntrega).toBe('2026-10-20');
    });

    it('también agrega lo comprometido de cada talla', () => {
        const r = agregarDeVariantes({ comprometido: 0 }, [
            { enCamino: 3, comprometido: 1 },
            { enCamino: 2, comprometido: 2 },
        ], 0);
        expect(r.comprometido).toBe(3);
        expect(r.enCamino).toBe(5);
        expect(r.saldoPrometible).toBe(2);
    });

    it('lo pedido directo al modelo (sin talla) también cuenta', () => {
        // Un producto sin variantes, o una línea de la orden sobre el padre.
        const r = agregarDeVariantes({ enCamino: 5, enCaminoProximaEntrega: '2026-10-25' }, [], 10);
        expect(r.enCamino).toBe(5);
        expect(r.enCaminoProximaEntrega).toBe('2026-10-25');
    });

    it('suma lo del padre MÁS lo de las variantes, sin perder ninguno', () => {
        const r = agregarDeVariantes({ enCamino: 5 }, [{ enCamino: 3 }], 0);
        expect(r.enCamino).toBe(8);
    });

    it('un modelo sin nada pedido no muestra distintivo', () => {
        const r = agregarDeVariantes({}, [{ enCamino: 0 }, { enCamino: 0 }], 20);
        expect(r.enCamino).toBe(0);
        expect(r.enCaminoProximaEntrega).toBeNull();
    });

    it('el saldo prometible del modelo usa su stock total', () => {
        const r = agregarDeVariantes({}, [{ enCamino: 3, comprometido: 3 }], 61);
        expect(r.saldoPrometible).toBe(61);
    });

    it('las reservas del modelo también restan', () => {
        const r = agregarDeVariantes({}, [{ enCamino: 3 }], 10, 4);
        expect(r.saldoPrometible).toBe(9);
    });

    it('datos sucios no rompen el agregado', () => {
        const r = agregarDeVariantes({ enCamino: 'x' }, [
            { enCamino: null }, { enCamino: -5 }, { enCamino: 4 }, null as any,
        ], 'abc');
        expect(r.enCamino).toBe(4);
        expect(r.comprometido).toBe(0);
    });

    it('sin variantes (producto suelto) se comporta igual que antes', () => {
        const r = agregarDeVariantes({ enCamino: 7, comprometido: 2 }, null, 10);
        expect(r).toEqual({
            enCamino: 7, enCaminoProximaEntrega: null, comprometido: 2, saldoPrometible: 15,
        });
    });

    it('cantidades decimales se agregan sin arrastrar error de coma flotante', () => {
        const r = agregarDeVariantes({}, [{ enCamino: 0.1 }, { enCamino: 0.2 }], 0);
        expect(r.enCamino).toBe(0.3);
    });
});
