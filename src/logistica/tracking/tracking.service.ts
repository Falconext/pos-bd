import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrarUbicacionDto } from './dto/registrar-ubicacion.dto';

@Injectable()
export class TrackingLogisticaService {
  constructor(private readonly prisma: PrismaService) {}

  async registrarUbicacion(empresaId: number, dto: RegistrarUbicacionDto) {
    const conductor = await this.prisma.conductorLogistica.findFirst({
      where: { id: dto.conductorId, empresaId },
    });

    if (!conductor) throw new NotFoundException('Conductor no encontrado');

    return this.prisma.conductorLogistica.update({
      where: { id: dto.conductorId },
      data: {
        lat: dto.lat,
        lng: dto.lng,
        ultimaUbicacion: new Date(),
      },
    });
  }

  async obtenerUbicacionConductores(empresaId: number) {
    return this.prisma.conductorLogistica.findMany({
      where: {
        empresaId,
        estado: 'EN_RUTA',
        lat: { not: null },
        lng: { not: null },
      },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        lat: true,
        lng: true,
        ultimaUbicacion: true,
      },
    });
  }

  async obtenerTrackingPublico(codigoTracking: string) {
    const pedido = await this.prisma.pedidoLogistica.findUnique({
      where: { codigoTracking },
      select: {
        codigoTracking: true,
        estado: true,
        fechaSolicitada: true,
        direccionEntrega: {
          select: {
            distrito: true,
            ciudad: true,
            lat: true,
            lng: true,
          },
        },
        historialEstados: {
          orderBy: { creadoEn: 'desc' },
          select: {
            estadoNuevo: true,
            motivo: true,
            creadoEn: true,
          },
        },
      },
    });

    if (!pedido) throw new NotFoundException('Código de tracking no válido');

    return pedido;
  }
}
