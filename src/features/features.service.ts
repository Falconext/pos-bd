import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async validarFeature(
    empresaId: number,
    feature:
      | 'tieneBanners'
      | 'tieneGaleria'
      | 'tieneCulqi'
      | 'tieneDeliveryGPS',
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { plan: true },
    });

    if (!empresa || !empresa.plan) {
      throw new ForbiddenException('Empresa o plan no encontrado');
    }

    if (!empresa.plan[feature]) {
      throw new ForbiddenException(
        `Tu plan actual no incluye esta funcionalidad: ${feature}`,
      );
    }

    return empresa;
  }

  async validarLimite(
    empresaId: number,
    tipo: 'banners' | 'imagenesProducto',
    cantidadActual: number,
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { plan: true },
    });

    if (!empresa || !empresa.plan) return;

    let limite = 0;
    if (tipo === 'banners') limite = empresa.plan.maxBanners || 0;
    if (tipo === 'imagenesProducto')
      limite = empresa.plan.maxImagenesProducto || 0;

    if (cantidadActual >= limite) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${tipo} permitido por tu plan (${limite})`,
      );
    }
  }
}
