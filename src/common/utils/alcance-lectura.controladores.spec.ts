/**
 * QA funcional del alcance del supervisor sobre los CONTROLADORES reales.
 *
 * Importa los controladores de verdad y les pasa un servicio espía, para
 * verificar con qué filtros terminan llamando. Lo que importa no es que la
 * función pura devuelva lo correcto, sino que cada endpoint la use.
 */
import { VentasController } from '../../ventas/ventas.controller';
import { ComprobanteController } from '../../comprobante/comprobante.controller';

const admin = { id: 1, rol: 'ADMIN_EMPRESA', empresaId: 9, sedeId: 5 };
const supervisor = { id: 10, rol: 'USUARIO_EMPRESA', empresaId: 9, sedeId: 5, convertirEnSupervisor: true };
const cajera = { id: 11, rol: 'USUARIO_EMPRESA', empresaId: 9, sedeId: 5, convertirEnSupervisor: false };

describe('Panel de Ventas', () => {
    const montar = () => {
        const panelVentas = jest.fn().mockResolvedValue({});
        const ctrl = new VentasController({ panelVentas } as any);
        return { ctrl, panelVentas };
    };

    it('la cajera solo ve sus propias ventas y su sede', async () => {
        const { ctrl, panelVentas } = montar();
        await (ctrl as any).panel(cajera, '2026-10-05');
        expect(panelVentas).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 11, sedeId: 5 }));
    });

    it('la cajera no puede espiar a otra aunque mande el filtro', async () => {
        const { ctrl, panelVentas } = montar();
        await (ctrl as any).panel(cajera, '2026-10-05', undefined, undefined, '7', '99');
        expect(panelVentas).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 11, sedeId: 5 }));
    });

    it('el SUPERVISOR ve las ventas de todos y de todas las sedes', async () => {
        const { ctrl, panelVentas } = montar();
        await (ctrl as any).panel(supervisor, '2026-10-05');
        expect(panelVentas).toHaveBeenCalledWith(
            expect.objectContaining({ usuarioId: undefined, sedeId: undefined }),
        );
    });

    it('el supervisor puede filtrar por una vendedora y una sede', async () => {
        const { ctrl, panelVentas } = montar();
        await (ctrl as any).panel(supervisor, '2026-10-05', undefined, undefined, '7', '11');
        expect(panelVentas).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 11, sedeId: 7 }));
    });

    it('el admin se comporta igual que siempre', async () => {
        const { ctrl, panelVentas } = montar();
        await (ctrl as any).panel(admin, '2026-10-05');
        expect(panelVentas).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: undefined }));
    });
});

describe('Listado de comprobantes', () => {
    const montar = () => {
        const listar = jest.fn().mockResolvedValue({ data: [], total: 0 });
        const ctrl = new ComprobanteController(
            { listar } as any, {} as any, {} as any, {} as any,
        );
        return { ctrl, listar };
    };

    const query = (extra: any = {}) => ({ tipoComprobante: 'FORMAL', ...extra });
    /** El endpoint escribe el mensaje de la respuesta en res.locals. */
    const res = () => ({ locals: {} }) as any;

    it('la cajera solo ve los comprobantes que emitió', async () => {
        const { ctrl, listar } = montar();
        await (ctrl as any).listar(cajera, query(), res());
        expect(listar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 11, sedeId: 5 }));
    });

    it('el SUPERVISOR ve los de todos, en todas las sedes', async () => {
        const { ctrl, listar } = montar();
        await (ctrl as any).listar(supervisor, query(), res());
        expect(listar).toHaveBeenCalledWith(
            expect.objectContaining({ usuarioId: undefined, sedeId: undefined }),
        );
    });

    it('el supervisor puede filtrar por vendedora', async () => {
        const { ctrl, listar } = montar();
        await (ctrl as any).listar(supervisor, query({ usuarioId: 11 }), res());
        expect(listar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 11 }));
    });

    it('las cotizaciones siguen siendo de todos, también para la cajera', async () => {
        const { ctrl, listar } = montar();
        await (ctrl as any).listar(cajera, query({ tipoComprobante: 'COTIZACION' }), res());
        expect(listar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: undefined }));
    });
});

describe('Cuentas por cobrar', () => {
    const montar = () => {
        const cuentasPorCobrar = jest.fn().mockResolvedValue([]);
        const ctrl = new ComprobanteController(
            { cuentasPorCobrar } as any, {} as any, {} as any, {} as any,
        );
        return { ctrl, cuentasPorCobrar };
    };

    it('la cajera solo ve las deudas de sus ventas', async () => {
        const { ctrl, cuentasPorCobrar } = montar();
        await (ctrl as any).cuentasPorCobrar(cajera);
        expect(cuentasPorCobrar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 11, sedeId: 5 }));
    });

    it('el SUPERVISOR ve la cobranza completa', async () => {
        const { ctrl, cuentasPorCobrar } = montar();
        await (ctrl as any).cuentasPorCobrar(supervisor);
        expect(cuentasPorCobrar).toHaveBeenCalledWith(
            expect.objectContaining({ usuarioId: undefined, sedeId: null }),
        );
    });
});
