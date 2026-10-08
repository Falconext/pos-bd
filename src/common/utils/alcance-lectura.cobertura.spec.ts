/**
 * Segunda vuelta de QA del alcance del supervisor.
 *
 * La primera vuelta cubrió 3 de los 7 endpoints. Acá van los 4 que faltaban
 * (exportaciones y finanzas) y, sobre todo, la verificación de que ampliar lo
 * que el supervisor LEE no le abrió nada para ESCRIBIR.
 */
import { ComprobanteController } from '../../comprobante/comprobante.controller';
import { FinanzasController } from '../../finanzas/finanzas.controller';

const supervisor = { id: 10, rol: 'USUARIO_EMPRESA', empresaId: 9, sedeId: 5, convertirEnSupervisor: true };
const cajera = { id: 11, rol: 'USUARIO_EMPRESA', empresaId: 9, sedeId: 5, convertirEnSupervisor: false };

const res = () => ({ locals: {}, setHeader: jest.fn(), send: jest.fn(), end: jest.fn() }) as any;

describe('Exportaciones — los 2 endpoints que faltaban', () => {
    const montar = (metodo: 'exportarComprobantesPdf' | 'exportarResumenComprobantes') => {
        const espia = jest.fn().mockResolvedValue({ buffer: Buffer.from(''), filename: 'x', mime: 'application/pdf' });
        const ctrl = new ComprobanteController({ [metodo]: espia } as any, {} as any, {} as any, {} as any);
        return { ctrl, espia };
    };

    it('Exportar PDF: la cajera solo exporta lo suyo', async () => {
        const { ctrl, espia } = montar('exportarComprobantesPdf');
        await (ctrl as any).exportarPdf(cajera, { tipoComprobante: 'FORMAL' }, res());
        expect(espia).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 11, sedeId: 5 }));
    });

    it('Exportar PDF: el supervisor exporta el de todos y todas las sedes', async () => {
        const { ctrl, espia } = montar('exportarComprobantesPdf');
        await (ctrl as any).exportarPdf(supervisor, { tipoComprobante: 'FORMAL' }, res());
        expect(espia).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: undefined, sedeId: null }));
    });

    it('Exportar resumen: la cajera solo exporta lo suyo', async () => {
        const { ctrl, espia } = montar('exportarResumenComprobantes');
        await (ctrl as any).exportarResumen(cajera, { tipoComprobante: 'INFORMAL' }, res());
        expect(espia).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 11, sedeId: 5 }));
    });

    it('Exportar resumen: el supervisor exporta todo', async () => {
        const { ctrl, espia } = montar('exportarResumenComprobantes');
        await (ctrl as any).exportarResumen(supervisor, { tipoComprobante: 'INFORMAL' }, res());
        expect(espia).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: undefined, sedeId: null }));
    });

    it('la cajera no exporta lo de otra aunque mande el filtro', async () => {
        const { ctrl, espia } = montar('exportarComprobantesPdf');
        await (ctrl as any).exportarPdf(cajera, { tipoComprobante: 'FORMAL', usuarioId: 99, sedeId: 7 }, res());
        expect(espia).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 11, sedeId: 5 }));
    });
});

describe('Finanzas — los 2 endpoints que faltaban', () => {
    const montar = () => {
        const getResumenFinanciero = jest.fn().mockResolvedValue({});
        const getResumenEcommerce = jest.fn().mockResolvedValue({});
        const ctrl = new FinanzasController(
            { getResumenFinanciero, getResumenEcommerce } as any,
            {} as any,
        );
        return { ctrl, getResumenFinanciero, getResumenEcommerce };
    };

    it('Resumen financiero: la cajera ve su sede y sus ventas', async () => {
        const { ctrl, getResumenFinanciero } = montar();
        await (ctrl as any).getResumen(cajera, '2026-10-01', '2026-10-31');
        const args = getResumenFinanciero.mock.calls[0];
        expect(args[3]).toBe(5);   // sedeId
        expect(args[4]).toBe(11);  // usuarioId
    });

    it('Resumen financiero: el supervisor ve todo', async () => {
        const { ctrl, getResumenFinanciero } = montar();
        await (ctrl as any).getResumen(supervisor, '2026-10-01', '2026-10-31');
        const args = getResumenFinanciero.mock.calls[0];
        expect(args[3]).toBeUndefined();
        expect(args[4]).toBeUndefined();
    });

    it('Resumen financiero: el supervisor puede filtrar por vendedora', async () => {
        const { ctrl, getResumenFinanciero } = montar();
        await (ctrl as any).getResumen(supervisor, '2026-10-01', '2026-10-31', '7', '11');
        const args = getResumenFinanciero.mock.calls[0];
        expect(args[3]).toBe(7);
        expect(args[4]).toBe(11);
    });

    it('Ecommerce: la cajera queda en su sede', async () => {
        const { ctrl, getResumenEcommerce } = montar();
        await (ctrl as any).getResumenEcommerce(cajera, '2026-10-01', '2026-10-31', '7');
        expect(getResumenEcommerce.mock.calls[0]).toContain(5);
    });

    it('Ecommerce: el supervisor elige la sede que quiera', async () => {
        const { ctrl, getResumenEcommerce } = montar();
        await (ctrl as any).getResumenEcommerce(supervisor, '2026-10-01', '2026-10-31', '7');
        expect(getResumenEcommerce.mock.calls[0]).toContain(7);
    });
});

describe('Lo que el permiso NO abrió — escritura', () => {
    /**
     * El pedido fue explícito: SOLO LECTURA. Estas pruebas fallan si alguien
     * algún día mete `puedeLeerVentasDeTodos` en un camino de escritura.
     */
    const fuente = require('fs').readFileSync(
        require('path').join(__dirname, '../../comprobante/comprobante.controller.ts'),
        'utf8',
    );

    /** Corta el archivo en un bloque por endpoint: [verbo, código]. */
    const endpoints = (): { verbo: string; cuerpo: string }[] => {
        const re = /@(Get|Post|Patch|Put|Delete)\(/g;
        const marcas: { verbo: string; desde: number }[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(fuente)) !== null) marcas.push({ verbo: m[1], desde: m.index });
        return marcas.map((marca, i) => ({
            verbo: marca.verbo,
            cuerpo: fuente.slice(marca.desde, marcas[i + 1]?.desde ?? fuente.length),
        }));
    };

    it('el archivo se pudo analizar: hay endpoints de lectura y de escritura', () => {
        // Sin esto, los dos tests de abajo pasarían sin mirar nada.
        const todos = endpoints();
        expect(todos.filter((e) => e.verbo === 'Get').length).toBeGreaterThan(3);
        expect(todos.filter((e) => e.verbo !== 'Get').length).toBeGreaterThan(3);
    });

    it('el alcance de lectura no se usa en ningún endpoint que modifique', () => {
        const escriben = endpoints().filter((e) => e.verbo !== 'Get');
        for (const { verbo, cuerpo } of escriben) {
            expect(`${verbo}:${cuerpo.includes('puedeLeerVentasDeTodos')}`).toBe(`${verbo}:false`);
            expect(`${verbo}:${cuerpo.includes('usuarioIdParaListado')}`).toBe(`${verbo}:false`);
            expect(`${verbo}:${cuerpo.includes('sedeIdParaListado')}`).toBe(`${verbo}:false`);
        }
    });

    it('y sí se usa en los de lectura: el cambio llegó a donde tenía que llegar', () => {
        const leen = endpoints().filter((e) => e.verbo === 'Get');
        const conAlcance = leen.filter((e) =>
            e.cuerpo.includes('usuarioIdParaListado') || e.cuerpo.includes('sedeIdParaListado'),
        );
        expect(conAlcance.length).toBe(4);
    });

    it('anular comprobantes sigue teniendo su propio control, aparte', () => {
        expect(fuente).toContain('verificarPuedeAnularComprobante');
        // y ese control no mira el alcance de lectura
        const i = fuente.indexOf('verificarPuedeAnularComprobante(user)');
        expect(fuente.slice(Math.max(0, i - 400), i)).not.toContain('puedeLeerVentasDeTodos');
    });
});
