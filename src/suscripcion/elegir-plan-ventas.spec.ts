import { BadRequestException } from '@nestjs/common';
import { SuscripcionService } from './suscripcion.service';

/**
 * Salir de la prueba gratis eligiendo plan: solo desde la prueba, solo a un
 * plan de Ventas de su misma marca, y sin tocar el vencimiento (los días los
 * compra el primer pago).
 */
function armar(planActual: { esPrueba: boolean; producto: string }) {
  const prisma = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({ brand: 'krezka', plan: planActual }),
      update: jest.fn().mockResolvedValue({}),
    },
    plan: {
      findUnique: jest.fn().mockResolvedValue({ id: 42, nombre: 'Ventas Pro', costo: 299 }),
      findMany: jest.fn().mockResolvedValue([
        { nombre: 'Ventas Start', costo: 199, maxLeadsMes: 500 },
        { nombre: 'Ventas Pro', costo: 299, maxLeadsMes: 1500 },
        { nombre: 'Ventas Scale', costo: 499, maxLeadsMes: 5000 },
      ]),
    },
    empresaLog: {
      findFirst: jest.fn().mockResolvedValue({ detalle: 'Autoregistro web · eligió Ventas Scale · 999999999' }),
    },
  };
  return { prisma, service: new SuscripcionService(prisma as any) };
}

describe('elegir plan al terminar la prueba de IA de Ventas', () => {
  it('cambia al plan elegido de la misma marca sin mover el vencimiento', async () => {
    const { prisma, service } = armar({ esPrueba: true, producto: 'ventas' });

    await service.elegirPlanVentas(7, 'pro');

    expect(prisma.plan.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          nombre_plataforma_producto: { nombre: 'Ventas Pro', plataforma: 'krezka', producto: 'ventas' },
        },
      }),
    );
    const data = prisma.empresa.update.mock.calls[0][0].data;
    expect(data.planId).toBe(42);
    expect(data).not.toHaveProperty('fechaExpiracion');
  });

  it('rechaza a quien ya tiene un plan pagado', async () => {
    const { prisma, service } = armar({ esPrueba: false, producto: 'ventas' });
    await expect(service.elegirPlanVentas(7, 'start')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('rechaza claves que no son planes de Ventas', async () => {
    const { prisma, service } = armar({ esPrueba: true, producto: 'ventas' });
    await expect(service.elegirPlanVentas(7, 'Full')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('sugiere el plan que marcó al registrarse', async () => {
    const { service } = armar({ esPrueba: true, producto: 'ventas' });
    const r = await service.planesVentasParaElegir(7);
    expect(r.sugerido).toBe('scale');
    expect(r.planes.map((p: any) => p.clave)).toEqual(['start', 'pro', 'scale']);
  });
});
