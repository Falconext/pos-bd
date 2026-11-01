/**
 * Mocks de Prisma para el stock de la tienda en los tests (ver
 * stock-tienda.ts). Solo lo usan los *.spec.ts.
 */
export const SEDE_PRINCIPAL = {
  id: 1,
  nombre: 'Principal',
  direccion: 'Av. Siempre Viva 123',
  ubigeo: null,
  esPrincipal: true,
};

/** `producto.findMany` que devuelve, de la lista dada, los ids pedidos. */
export function productosPorIds(lista: Array<any | null | undefined>) {
  return jest.fn().mockImplementation(({ where }: any) => {
    const ids: number[] = where?.id?.in ?? [];
    return Promise.resolve(
      lista
        .filter((p) => p && ids.includes(p.id))
        .map((p) => ({
          porcentajeProvision: 0,
          atributosTecnicos: {},
          ...p,
        })),
    );
  });
}

/**
 * Empresa con UNA sede activa y sin filas por sede: la tienda usa
 * `Producto.stock` igual que antes del modo por sede.
 */
export function prismaStockUnaSede() {
  return {
    sede: { findMany: jest.fn().mockResolvedValue([SEDE_PRINCIPAL]) },
    productoStock: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    reserva: { groupBy: jest.fn().mockResolvedValue([]) },
    ubigeo: { findMany: jest.fn().mockResolvedValue([]) },
  };
}
