import { ensurePlanesVentas } from './ensure-planes-ventas';

/**
 * Los planes de IA de Ventas se venden con "facturación incluida": tienen que
 * nacer (y quedar al redesplegar) con los límites de un plan completo, no con
 * los valores por defecto del esquema (1 sede, sin tienda, 1 imagen).
 */
function armar() {
  let id = 0;
  const prisma = {
    modulo: {
      findFirst: jest.fn().mockResolvedValue({ id: 1, codigo: 'leads' }),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
    },
    plan: { upsert: jest.fn().mockImplementation(() => Promise.resolve({ id: ++id })) },
    planModulo: { upsert: jest.fn().mockResolvedValue({}) },
    planFeature: { upsert: jest.fn().mockResolvedValue({}) },
  };
  return prisma;
}

describe('ensurePlanesVentas', () => {
  it('deja a Ventas Start con tienda, sedes y usuarios ilimitados también al actualizar', async () => {
    const prisma = armar();
    await ensurePlanesVentas(prisma as any);

    const start = prisma.plan.upsert.mock.calls
      .map((c: any[]) => c[0])
      .find((a: any) => a.where.nombre_plataforma_producto.nombre === 'Ventas Start');
    for (const datos of [start.update, start.create]) {
      expect(datos).toMatchObject({
        costo: 199,
        maxLeadsMes: 500,
        tieneTienda: true,
        maxSedes: 0,
        limiteUsuarios: 0,
        maxComprobantes: 0,
        maxImagenesProducto: 3,
      });
    }
  });

  it('enciende las features del plan completo (Shalom, Olva, SIRE, tienda…)', async () => {
    const prisma = armar();
    await ensurePlanesVentas(prisma as any);

    const claves = new Set(
      prisma.planFeature.upsert.mock.calls.map((c: any[]) => c[0].create.featureKey),
    );
    for (const k of ['tieneTienda', 'tieneShalom', 'tieneOlva', 'tieneSire', 'tieneMultiplesSedes']) {
      expect(claves.has(k)).toBe(true);
    }
    expect(prisma.planFeature.upsert.mock.calls.every((c: any[]) => c[0].update.enabled === true)).toBe(true);
  });
});
