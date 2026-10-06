import {
    esAdministrador,
    esSupervisor,
    puedeLeerVentasDeTodos,
    usuarioIdParaListado,
    sedeIdParaListado,
} from './alcance-lectura';

/**
 * Pedido: que un supervisor pueda VER las ventas de los demás usuarios, de
 * todas las sedes, sin tener que ser ADMIN_EMPRESA.
 */
const admin = { id: 1, rol: 'ADMIN_EMPRESA', sedeId: 5 };
const adminSistema = { id: 2, rol: 'ADMIN_SISTEMA', sedeId: null };
const supervisor = { id: 10, rol: 'USUARIO_EMPRESA', sedeId: 5, convertirEnSupervisor: true };
const cajera = { id: 11, rol: 'USUARIO_EMPRESA', sedeId: 5, convertirEnSupervisor: false };

describe('quién es quién', () => {
    it('el admin de empresa y el de sistema son administradores', () => {
        expect(esAdministrador(admin)).toBe(true);
        expect(esAdministrador(adminSistema)).toBe(true);
    });

    it('el supervisor NO es administrador: es otra cosa', () => {
        expect(esSupervisor(supervisor)).toBe(true);
        expect(esAdministrador(supervisor)).toBe(false);
    });

    it('un admin marcado como supervisor sigue contando como admin', () => {
        expect(esSupervisor({ ...admin, convertirEnSupervisor: true })).toBe(false);
    });

    it('la cajera no es ninguna de las dos', () => {
        expect(esAdministrador(cajera)).toBe(false);
        expect(esSupervisor(cajera)).toBe(false);
    });
});

describe('puedeLeerVentasDeTodos', () => {
    it('el supervisor puede, que es justo lo que se pidió', () => {
        expect(puedeLeerVentasDeTodos(supervisor)).toBe(true);
    });

    it('los administradores pueden, como siempre', () => {
        expect(puedeLeerVentasDeTodos(admin)).toBe(true);
        expect(puedeLeerVentasDeTodos(adminSistema)).toBe(true);
    });

    it('la cajera NO puede: nada cambia para ella', () => {
        expect(puedeLeerVentasDeTodos(cajera)).toBe(false);
    });

    it('sin el permiso marcado, un usuario común no lo gana por error', () => {
        expect(puedeLeerVentasDeTodos({ id: 3, rol: 'USUARIO_EMPRESA' })).toBe(false);
        expect(puedeLeerVentasDeTodos(null)).toBe(false);
        expect(puedeLeerVentasDeTodos({ id: 3, rol: 'USUARIO_EMPRESA', convertirEnSupervisor: null })).toBe(false);
    });

    it('el rol RESELLER no se cuela como administrador', () => {
        expect(puedeLeerVentasDeTodos({ id: 4, rol: 'RESELLER' })).toBe(false);
    });
});

describe('usuarioIdParaListado — el filtro por vendedor', () => {
    it('la cajera queda clavada en sí misma', () => {
        expect(usuarioIdParaListado(cajera, undefined)).toBe(11);
    });

    it('aunque pida ver las de OTRO, se la ignora', () => {
        // El intento de ver las ventas de un compañero no puede funcionar.
        expect(usuarioIdParaListado(cajera, 99)).toBe(11);
        expect(usuarioIdParaListado(cajera, '99')).toBe(11);
    });

    it('el supervisor sin filtro ve TODAS', () => {
        expect(usuarioIdParaListado(supervisor, undefined)).toBeUndefined();
        expect(usuarioIdParaListado(supervisor, '')).toBeUndefined();
    });

    it('el supervisor puede filtrar por una vendedora concreta', () => {
        expect(usuarioIdParaListado(supervisor, 11)).toBe(11);
        expect(usuarioIdParaListado(supervisor, '11')).toBe(11);
    });

    it('el admin se comporta igual que antes', () => {
        expect(usuarioIdParaListado(admin, undefined)).toBeUndefined();
        expect(usuarioIdParaListado(admin, 11)).toBe(11);
    });

    it('un filtro con basura no abre la puerta ni la cierra mal', () => {
        expect(usuarioIdParaListado(supervisor, 'abc')).toBeUndefined();
        expect(usuarioIdParaListado(supervisor, -1)).toBeUndefined();
        expect(usuarioIdParaListado(supervisor, 0)).toBeUndefined();
    });
});

describe('sedeIdParaListado — el alcance de sedes', () => {
    it('el supervisor ve todas las sedes si no elige ninguna', () => {
        expect(sedeIdParaListado(supervisor, undefined)).toBeUndefined();
    });

    it('el supervisor puede elegir una sede', () => {
        expect(sedeIdParaListado(supervisor, 7)).toBe(7);
        expect(sedeIdParaListado(supervisor, '7')).toBe(7);
    });

    it('la cajera queda en SU sede, pida lo que pida', () => {
        expect(sedeIdParaListado(cajera, undefined)).toBe(5);
        expect(sedeIdParaListado(cajera, 7)).toBe(5);
    });

    it('el admin sigue viendo todas por defecto', () => {
        expect(sedeIdParaListado(admin, undefined)).toBeUndefined();
        expect(sedeIdParaListado(admin, 7)).toBe(7);
    });

    it('un usuario sin sede asignada no filtra por una sede inventada', () => {
        expect(sedeIdParaListado({ id: 12, rol: 'USUARIO_EMPRESA', sedeId: null }, undefined)).toBeUndefined();
    });
});

describe('lo que este permiso NO hace', () => {
    it('ser supervisor no habilita anular comprobantes', () => {
        // Anular vive en `puedeAnularComprobantes` y se evalúa en su guard.
        expect((supervisor as any).puedeAnularComprobantes).toBeUndefined();
    });

    it('el supervisor no se convierte en ADMIN_EMPRESA por detrás', () => {
        expect(supervisor.rol).toBe('USUARIO_EMPRESA');
        expect(esAdministrador(supervisor)).toBe(false);
    });
});
