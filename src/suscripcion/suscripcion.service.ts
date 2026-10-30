import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PLANES_VENTAS_POR_CLAVE,
  type ClavePlanVentas,
} from '../common/utils/ensure-planes-ventas';

@Injectable()
export class SuscripcionService {
  constructor(private readonly prisma: PrismaService) {}

  async verMiSuscripcion(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        razonSocial: true,
        estado: true,
        fechaActivacion: true,
        fechaExpiracion: true,
        plan: { select: { id: true, nombre: true, descripcion: true } },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    return {
      empresaId: empresa.id,
      razonSocial: empresa.razonSocial,
      estado: empresa.estado,
      fechaActivacion: empresa.fechaActivacion,
      fechaExpiracion: empresa.fechaExpiracion,
      plan: empresa.plan,
    };
  }

  /**
   * Planes de IA de Ventas que puede elegir quien está en la prueba gratis, con
   * el que marcó al registrarse como sugerido.
   */
  async planesVentasParaElegir(empresaId: number) {
    const empresa = await this.empresaDePrueba(empresaId);
    const planes = await this.prisma.plan.findMany({
      where: {
        plataforma: empresa.brand ?? 'falconext',
        producto: 'ventas',
        nombre: { in: Object.values(PLANES_VENTAS_POR_CLAVE) },
      },
      select: { nombre: true, costo: true, maxLeadsMes: true },
    });
    const registro = await this.prisma.empresaLog.findFirst({
      where: { empresaId, accion: 'REGISTRO_PRUEBA' },
      orderBy: { id: 'desc' },
      select: { detalle: true },
    });
    const claves = Object.keys(PLANES_VENTAS_POR_CLAVE) as ClavePlanVentas[];
    const sugerido =
      claves.find((c) =>
        registro?.detalle?.includes(PLANES_VENTAS_POR_CLAVE[c]),
      ) ?? 'pro';
    return {
      sugerido,
      planes: claves
        .map((clave) => {
          const p = planes.find((x) => x.nombre === PLANES_VENTAS_POR_CLAVE[clave]);
          return p
            ? { clave, nombre: p.nombre, costo: Number(p.costo), maxLeadsMes: p.maxLeadsMes }
            : null;
        })
        .filter(Boolean),
    };
  }

  /**
   * Pasa de la prueba gratis al plan pagado elegido. Solo cambia el plan: el
   * tiempo lo compra el primer pago (Mercado Pago → registrarPago), así que
   * elegir sin pagar no regala días.
   */
  async elegirPlanVentas(empresaId: number, clave: string) {
    if (!(clave in PLANES_VENTAS_POR_CLAVE)) {
      throw new BadRequestException('Plan no válido');
    }
    const empresa = await this.empresaDePrueba(empresaId);
    const plan = await this.prisma.plan.findUnique({
      where: {
        nombre_plataforma_producto: {
          nombre: PLANES_VENTAS_POR_CLAVE[clave as ClavePlanVentas],
          plataforma: empresa.brand ?? 'falconext',
          producto: 'ventas',
        },
      },
      select: { id: true, nombre: true, costo: true },
    });
    if (!plan) throw new NotFoundException('Plan no disponible');

    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { planId: plan.id, costoActivacionReseller: plan.costo },
    });
    return { plan: { nombre: plan.nombre, costo: Number(plan.costo) } };
  }

  private async empresaDePrueba(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { brand: true, plan: { select: { esPrueba: true, producto: true } } },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (!empresa.plan?.esPrueba || empresa.plan.producto !== 'ventas') {
      throw new BadRequestException(
        'Tu cuenta ya tiene un plan. Para cambiarlo, escríbenos por WhatsApp.',
      );
    }
    return empresa;
  }
}
