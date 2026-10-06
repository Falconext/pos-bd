/**
 * Hasta dónde ve un usuario cuando LEE ventas.
 *
 * Había dos extremos y nada en el medio: el ADMIN_EMPRESA veía todo, y
 * cualquier otro usuario quedaba forzado a ver solo lo suyo. Un supervisor de
 * tienda que necesita revisar lo que vendieron sus cajeras tenía que
 * convertirse en ADMIN_EMPRESA — y con eso se llevaba también anular
 * comprobantes, cambiar precios y tocar la configuración de la empresa.
 *
 * El campo `convertirEnSupervisor` ya existía y ya se respetaba en el
 * dashboard; faltaba que contara en los listados, que es donde el supervisor
 * realmente trabaja.
 *
 * IMPORTANTE: esto es SOLO LECTURA. Ampliar lo que un supervisor ve no le da
 * permiso para anular, editar ni emitir nada. Anular sigue gobernado por
 * `puedeAnularComprobantes`, que es un permiso aparte y se evalúa en su propio
 * guard.
 */

export interface UsuarioConAlcance {
    id?: number;
    rol?: string;
    sedeId?: number | null;
    convertirEnSupervisor?: boolean | null;
}

/** Dueño de la empresa o admin de la plataforma. */
export const esAdministrador = (user: UsuarioConAlcance | null | undefined): boolean =>
    user?.rol === 'ADMIN_EMPRESA' || user?.rol === 'ADMIN_SISTEMA';

/** Supervisor: lee lo de todos, pero no es administrador. */
export const esSupervisor = (user: UsuarioConAlcance | null | undefined): boolean =>
    Boolean(user?.convertirEnSupervisor) && !esAdministrador(user);

/**
 * ¿Puede leer las ventas de los demás usuarios?
 *
 * Solo responde por la LECTURA. No usar esta función para decidir si alguien
 * puede modificar algo.
 */
export const puedeLeerVentasDeTodos = (user: UsuarioConAlcance | null | undefined): boolean =>
    esAdministrador(user) || Boolean(user?.convertirEnSupervisor);

/**
 * El `usuarioId` con el que se filtra un listado de ventas.
 *
 * - Quien puede ver todo: respeta el filtro que eligió en pantalla, o ninguno.
 * - El resto: queda clavado en sí mismo, pida lo que pida.
 *
 * Que un usuario común mande `?usuarioId=otro` no cambia nada: se ignora.
 */
export const usuarioIdParaListado = (
    user: UsuarioConAlcance | null | undefined,
    usuarioIdPedido?: string | number | null,
): number | undefined => {
    if (!puedeLeerVentasDeTodos(user)) {
        const propio = Number(user?.id);
        return Number.isFinite(propio) ? propio : undefined;
    }
    if (usuarioIdPedido === null || usuarioIdPedido === undefined || usuarioIdPedido === '') {
        return undefined;
    }
    const pedido = Number(usuarioIdPedido);
    return Number.isFinite(pedido) && pedido > 0 ? pedido : undefined;
};

/**
 * La sede con la que se filtra un listado.
 *
 * El supervisor se definió "de todas las sedes", igual que ya lo trataba el
 * dashboard: puede elegir una o no filtrar. Un usuario común queda en la suya.
 */
export const sedeIdParaListado = (
    user: UsuarioConAlcance | null | undefined,
    sedeIdPedida?: string | number | null,
): number | undefined => {
    const elegida =
        sedeIdPedida === null || sedeIdPedida === undefined || sedeIdPedida === ''
            ? undefined
            : Number(sedeIdPedida);
    if (puedeLeerVentasDeTodos(user)) {
        return Number.isFinite(elegida as number) && (elegida as number) > 0 ? elegida : undefined;
    }
    const propia = Number(user?.sedeId);
    return Number.isFinite(propia) && propia > 0 ? propia : undefined;
};
