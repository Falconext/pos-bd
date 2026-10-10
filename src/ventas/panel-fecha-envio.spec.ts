import { VentasController } from './ventas.controller';

/**
 * Reportado por KREZKA: "el campo de la fecha lo llenamos y aún no aparecía en
 * esa columna, solo se veía un guión".
 *
 * La causa: el Panel de Ventas lo arma `ventas.service`, pero la fecha de
 * entrega se había agregado a `envio-despacho.service` — otro endpoint. El
 * `select` del panel nunca pedía `fechaEstimada`, así que la fila llegaba sin
 * el campo y la columna caía siempre en el guion. El filtro "Sale el" tenía el
 * mismo problema: el frontend lo mandaba y el endpoint lo ignoraba.
 */
describe('Panel de Ventas — fecha de envío', () => {
    const admin = { id: 1, rol: 'ADMIN_EMPRESA', empresaId: 9, sedeId: 5 };

    const montar = () => {
        const panelVentas = jest.fn().mockResolvedValue([]);
        return { ctrl: new VentasController({ panelVentas } as any), panelVentas };
    };

    it('el filtro "Sale el" llega al servicio, no se pierde en el camino', async () => {
        const { ctrl, panelVentas } = montar();
        await (ctrl as any).panel(admin, '2026-10-05', undefined, '2026-10-20');
        expect(panelVentas).toHaveBeenCalledWith(
            expect.objectContaining({ fechaEnvio: '2026-10-20' }),
        );
    });

    it('sin el filtro, el panel sigue siendo por fecha de emisión', async () => {
        const { ctrl, panelVentas } = montar();
        await (ctrl as any).panel(admin, '2026-10-05');
        expect(panelVentas).toHaveBeenCalledWith(
            expect.objectContaining({ fecha: '2026-10-05', fechaEnvio: undefined }),
        );
    });

    it('un filtro vacío no se manda como cadena vacía', async () => {
        const { ctrl, panelVentas } = montar();
        await (ctrl as any).panel(admin, '2026-10-05', undefined, '');
        expect(panelVentas).toHaveBeenCalledWith(
            expect.objectContaining({ fechaEnvio: undefined }),
        );
    });
});

/**
 * La prueba que habría evitado el reporte: verifica contra el CÓDIGO que el
 * panel pide y mapea el campo. Es la clase de defecto que no se ve en una
 * prueba de unidad —el dato existe, el componente lo sabe pintar— porque el
 * agujero está en la consulta.
 */
describe('el panel pide y entrega el día de entrega', () => {
    const fuente = require('fs').readFileSync(
        require('path').join(__dirname, 'ventas.service.ts'),
        'utf8',
    );

    const bloqueDelPanel = (): string => {
        const i = fuente.indexOf('async panelVentas(');
        expect(i).toBeGreaterThan(-1);
        const siguiente = fuente.indexOf('\n  async ', i + 10);
        return fuente.slice(i, siguiente === -1 ? fuente.length : siguiente);
    };

    it('el select del despacho incluye fechaEstimada', () => {
        expect(bloqueDelPanel()).toContain('fechaEstimada: true');
    });

    it('la fila que devuelve el panel lleva fechaEstimada', () => {
        expect(bloqueDelPanel()).toContain('fechaEstimada: c.envioDespacho?.fechaEstimada');
    });

    it('cada campo del despacho que la fila expone fue pedido en el select', () => {
        const bloque = bloqueDelPanel();
        const expuestos = [...bloque.matchAll(/c\.envioDespacho\?\.(\w+)/g)].map((m) => m[1]);
        expect(expuestos.length).toBeGreaterThan(5);
        for (const campo of new Set(expuestos)) {
            // `repartidor` entra como relación anidada, no como escalar.
            if (campo === 'repartidor') continue;
            expect(`${campo}: ${bloque.includes(`${campo}: true`)}`).toBe(`${campo}: true`);
        }
    });

    it('el filtro por día de entrega usa el campo del despacho', () => {
        const bloque = bloqueDelPanel();
        expect(bloque).toContain('envioDespacho: { fechaEstimada: envioWhere }');
    });

    it('el rango del día se arma en UTC, no en hora de Lima', () => {
        // fechaEstimada se guarda a mediodía UTC: con -05:00 el día se corre.
        const bloque = bloqueDelPanel();
        expect(bloque).toContain("T00:00:00.000Z");
        expect(bloque).toContain("T23:59:59.999Z");
    });
});
