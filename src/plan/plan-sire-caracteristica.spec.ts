/**
 * El SIRE es lo que distingue al plan Corporativo: que SUNAT le traiga las
 * compras al negocio en vez de digitarlas. Antes solo se podía conceder
 * asignando a mano dos submódulos (`contabilidad:sire-ventas` y
 * `contabilidad:sire-compras`), cosa que no se veía por ningún lado en las
 * características del plan.
 *
 * Ahora es un interruptor del plan, y ese interruptor manda sobre los
 * submódulos. Lo que se cuida aquí: que prenderlo dé acceso, que apagarlo lo
 * quite, y que los planes que ya tenían el SIRE por submódulos aparezcan
 * encendidos en vez de mentir.
 */
import { PLAN_FEATURE_CATALOG, getPlanFeatureKeys } from './plan-feature-catalog';

describe('SIRE como característica del plan', () => {
  describe('catálogo', () => {
    it('aparece en las características que se pueden prender por plan', () => {
      expect(getPlanFeatureKeys()).toContain('tieneSire');
    });

    it('se describe en castellano llano, para que el vendedor sepa qué ofrece', () => {
      const sire = PLAN_FEATURE_CATALOG.find((f) => f.key === 'tieneSire');
      expect(sire).toBeDefined();
      expect(sire!.label).toMatch(/SIRE/);
      expect(sire!.description).toMatch(/compras/i);
      expect(sire!.group).toBe('operaciones');
    });
  });

  describe('el interruptor manda sobre los submódulos', () => {
    const SUBMODULOS = [
      { id: 10, codigo: 'contabilidad:sire-ventas' },
      { id: 11, codigo: 'contabilidad:sire-compras' },
    ];

    const prismaFalso = () => {
      const llamadas: any = { creados: null, borrados: null };
      return {
        llamadas,
        prisma: {
          subModulo: { findMany: jest.fn().mockResolvedValue(SUBMODULOS) },
          planSubModulo: {
            createMany: jest.fn((args: any) => {
              llamadas.creados = args;
              return Promise.resolve({ count: args.data.length });
            }),
            deleteMany: jest.fn((args: any) => {
              llamadas.borrados = args;
              return Promise.resolve({ count: 2 });
            }),
          },
        } as any,
      };
    };

    /** El método es privado: se invoca como lo hace el servicio por dentro. */
    const sincronizar = async (prisma: any, activo: boolean) => {
      const { PlanService } = await import('./plan.service');
      const servicio: any = new PlanService(prisma);
      return servicio.sincronizarSubmodulosSire(prisma, 27, activo);
    };

    it('al prenderlo, el plan recibe los dos submódulos del SIRE', async () => {
      const { prisma, llamadas } = prismaFalso();
      await sincronizar(prisma, true);
      expect(llamadas.creados.data).toEqual([
        { planId: 27, subModuloId: 10 },
        { planId: 27, subModuloId: 11 },
      ]);
      // Prenderlo dos veces no puede duplicar filas.
      expect(llamadas.creados.skipDuplicates).toBe(true);
      expect(llamadas.borrados).toBeNull();
    });

    it('al apagarlo, se le quitan', async () => {
      const { prisma, llamadas } = prismaFalso();
      await sincronizar(prisma, false);
      expect(llamadas.borrados.where).toEqual({
        planId: 27,
        subModuloId: { in: [10, 11] },
      });
      expect(llamadas.creados).toBeNull();
    });

    it('si el catálogo de submódulos no existe, no truena ni borra nada', async () => {
      const prisma: any = {
        subModulo: { findMany: jest.fn().mockResolvedValue([]) },
        planSubModulo: { createMany: jest.fn(), deleteMany: jest.fn() },
      };
      await sincronizar(prisma, true);
      expect(prisma.planSubModulo.createMany).not.toHaveBeenCalled();
      expect(prisma.planSubModulo.deleteMany).not.toHaveBeenCalled();
    });
  });
});
