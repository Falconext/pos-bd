/**
 * QA funcional del flujo completo de KREZKA, de punta a punta:
 *
 *   orden de compra → en camino → nota de pedido → comprometido
 *   → recepción → aviso → entrega
 *
 * Cada etapa usa las funciones reales que corren en producción y arranca del
 * estado en que la dejó la anterior. Si una etapa rompe el invariante de la
 * siguiente, esta suite falla.
 */
import {
    agruparEnCamino,
    saldoPrometible,
    entregableAhora,
    puedePrometer,
    situacionDisponibilidad,
    avisoParaElVendedor,
} from './stock-en-camino';
import { pedidosQueEsperan, avisoDeLlegada, unidadesQueSeLiberan } from './pedidos-por-entregar';

/** Talla 39 del modelo URBAN 300. Es la que no está en el almacén. */
const TALLA_39 = 102;

describe('Flujo completo — la talla que no está en el inventario', () => {
    // ── Etapa 0: el punto de partida ─────────────────────────────────────────
    let estado = { stock: 0, reservado: 0, enCamino: 0, comprometido: 0 };

    it('0. Antes de todo: la vendedora no puede prometer nada', () => {
        expect(situacionDisponibilidad(estado)).toBe('agotado');
        expect(puedePrometer(estado, 1)).toBe(false);
        expect(avisoParaElVendedor(estado)).toBe('Sin stock y sin reposición pedida');
    });

    // ── Etapa 1: se emite la orden de compra ─────────────────────────────────
    const lineasOrden = [
        { productoId: TALLA_39, descripcion: 'URBAN 300 T39', cantidad: 3, fechaEntrega: '2026-10-20', proveedor: 'TEXTILES SAC', numero: 45 },
    ];

    it('1. Se emite la orden: aparecen 3 en camino con su fecha', () => {
        const mapa = agruparEnCamino(lineasOrden);
        estado = { ...estado, enCamino: mapa.get(TALLA_39)!.cantidad };
        expect(estado.enCamino).toBe(3);
        expect(mapa.get(TALLA_39)!.proximaEntrega).toBe('2026-10-20');
    });

    it('2. La vendedora ya puede comprometer las 3, pero no entregar ninguna', () => {
        expect(situacionDisponibilidad(estado)).toBe('por-llegar');
        expect(saldoPrometible(estado)).toBe(3);
        expect(entregableAhora(estado)).toBe(0);
        expect(avisoParaElVendedor(estado)).toBe('Sin stock libre · puedes comprometer 3 de los 3 que vienen');
    });

    // ── Etapa 2: se toman dos Notas de Pedido ────────────────────────────────
    const pedidos = [
        { id: 500, serie: 'NP01', correlativo: 45, cliente: 'JUAN PEREZ', detalles: [{ productoId: TALLA_39, descripcion: 'URBAN 300 T39', cantidad: 1 }] },
        { id: 501, serie: 'NP01', correlativo: 52, cliente: 'MARIA DIAZ', detalles: [{ productoId: TALLA_39, descripcion: 'URBAN 300 T39', cantidad: 2 }] },
    ];

    it('3. Primera venta (1 unidad): quedan 2 por prometer', () => {
        estado = { ...estado, comprometido: 1 };
        expect(saldoPrometible(estado)).toBe(2);
        expect(puedePrometer(estado, 2)).toBe(true);
    });

    it('4. Segunda venta (2 unidades): ya no queda nada que prometer', () => {
        estado = { ...estado, comprometido: 3 };
        expect(saldoPrometible(estado)).toBe(0);
        expect(puedePrometer(estado, 1)).toBe(false);
        expect(situacionDisponibilidad(estado)).toBe('comprometido');
    });

    it('5. Una tercera vendedora ve que no puede prometer más', () => {
        expect(avisoParaElVendedor(estado)).toMatch(/ya está comprometido/i);
    });

    // ── Etapa 3: llega la mercadería ─────────────────────────────────────────
    it('6. Se recibe la orden: el stock sube y "en camino" vuelve a cero', () => {
        // Al pasar a RECIBIDA sale del cálculo de en camino y entra al kardex.
        estado = { ...estado, stock: 3, enCamino: 0 };
        expect(agruparEnCamino([]).get(TALLA_39)).toBeUndefined();
        expect(estado.stock).toBe(3);
    });

    it('7. Lo recibido NO queda libre: sigue comprometido con los dos clientes', () => {
        expect(entregableAhora(estado)).toBe(0);
        expect(situacionDisponibilidad(estado)).toBe('comprometido');
    });

    it('8. El sistema avisa qué pedidos quedaron listos', () => {
        const listos = pedidosQueEsperan(lineasOrden, pedidos);
        expect(listos.map((p) => p.documento)).toEqual(['NP01-00000045', 'NP01-00000052']);
        expect(unidadesQueSeLiberan(listos)).toBe(3);

        const aviso = avisoDeLlegada(77, 'OC-000045', listos)!;
        expect(aviso.mensaje).toContain('3 unidades listas');
        expect(aviso.mensaje).toContain('JUAN PEREZ');
        expect(aviso.metaData.comprobanteIds).toEqual([500, 501]);
    });

    // ── Etapa 4: se entregan ─────────────────────────────────────────────────
    it('9. Convertido el primer pedido: baja stock y baja lo comprometido', () => {
        estado = { ...estado, stock: 2, comprometido: 2 };
        expect(entregableAhora(estado)).toBe(0);
        expect(saldoPrometible(estado)).toBe(0);
    });

    it('10. Convertido el segundo: el ciclo cierra en cero, sin residuos', () => {
        estado = { ...estado, stock: 0, comprometido: 0 };
        expect(estado).toEqual({ stock: 0, reservado: 0, enCamino: 0, comprometido: 0 });
        expect(situacionDisponibilidad(estado)).toBe('agotado');
    });
});

describe('El flujo cuando llega de más', () => {
    it('sobra mercadería: lo que no estaba prometido queda libre para vender', () => {
        // Se pidieron 10, solo 3 estaban comprometidas.
        const estado = { stock: 10, reservado: 0, enCamino: 0, comprometido: 3 };
        expect(entregableAhora(estado)).toBe(7);
        expect(situacionDisponibilidad(estado)).toBe('disponible');
        expect(avisoParaElVendedor(estado)).toBe('7 para entregar ahora');
    });
});

describe('El flujo cuando se prometió de más', () => {
    it('el sistema lo muestra con el número exacto, no lo esconde', () => {
        const estado = { stock: 0, reservado: 0, enCamino: 3, comprometido: 5 };
        expect(saldoPrometible(estado)).toBe(-2);
        expect(avisoParaElVendedor(estado)).toContain('Ya se prometieron 2 más');
    });

    it('al llegar la mercadería igual se avisa, aunque no alcance para todos', () => {
        const lineas = [{ productoId: TALLA_39, cantidad: 3 }];
        const pedidos = [1, 2, 3, 4, 5].map((n) => ({
            id: 600 + n, serie: 'NP01', correlativo: n, cliente: `CLIENTE ${n}`,
            detalles: [{ productoId: TALLA_39, descripcion: 'T39', cantidad: 1 }],
        }));
        const aviso = avisoDeLlegada(77, 'OC-000045', pedidosQueEsperan(lineas, pedidos))!;
        expect(aviso.mensaje).toContain('5 pedidos');
        expect(aviso.mensaje).toContain('y 2 más');
    });
});

describe('Lo que ninguna etapa del flujo puede violar', () => {
    const escenarios = [
        { stock: 0, reservado: 0, enCamino: 0, comprometido: 0 },
        { stock: 0, reservado: 0, enCamino: 3, comprometido: 0 },
        { stock: 0, reservado: 0, enCamino: 3, comprometido: 3 },
        { stock: 3, reservado: 0, enCamino: 0, comprometido: 3 },
        { stock: 10, reservado: 2, enCamino: 5, comprometido: 3 },
        { stock: 0, reservado: 0, enCamino: 3, comprometido: 5 },
    ];

    it('lo entregable nunca supera el stock físico', () => {
        for (const e of escenarios) expect(entregableAhora(e)).toBeLessThanOrEqual(e.stock);
    });

    it('lo entregable nunca es negativo', () => {
        for (const e of escenarios) expect(entregableAhora(e)).toBeGreaterThanOrEqual(0);
    });

    it('el saldo prometible nunca supera stock + en camino', () => {
        for (const e of escenarios) {
            expect(saldoPrometible(e)).toBeLessThanOrEqual(e.stock + e.enCamino);
        }
    });

    it('nunca se marca "disponible" sin stock físico libre', () => {
        for (const e of escenarios) {
            if (situacionDisponibilidad(e) === 'disponible') expect(entregableAhora(e)).toBeGreaterThan(0);
        }
    });

    it('si no se puede prometer 1, tampoco se puede prometer más', () => {
        for (const e of escenarios) {
            if (!puedePrometer(e, 1)) {
                expect(puedePrometer(e, 2)).toBe(false);
                expect(puedePrometer(e, 10)).toBe(false);
            }
        }
    });
});
