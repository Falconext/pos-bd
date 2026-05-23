import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoReserva, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { UpdateReservaDto } from './dto/update-reserva.dto';

@Injectable()
export class ReservaService {
  constructor(private readonly prisma: PrismaService) {}

  private async validarStockDisponible(params: {
    empresaId: number;
    sedeId: number;
    productoId: number;
    cantidadSolicitada: number;
    excluirReservaId?: number;
  }) {
    const { empresaId, sedeId, productoId, cantidadSolicitada, excluirReservaId } = params;

    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { id: true, stock: true, porcentajeProvision: true, porcentajeVenta: true },
    });

    if (!producto) {
      throw new BadRequestException('El producto no existe o no pertenece a la empresa');
    }

    const stockSede = await this.prisma.productoStock.findUnique({
      where: { productoId_sedeId: { productoId, sedeId } },
      select: { stock: true },
    });

    const stockBase = stockSede?.stock ?? producto.stock ?? 0;

    const whereReservas: Prisma.ReservaWhereInput = {
      empresaId,
      sedeId,
      productoId,
      estado: { in: [EstadoReserva.PENDIENTE, EstadoReserva.CONFIRMADA] },
      ...(excluirReservaId ? { id: { not: excluirReservaId } } : {}),
    };

    const suma = await this.prisma.reserva.aggregate({
      _sum: { cantidad: true },
      where: whereReservas,
    });

    const reservado = suma._sum.cantidad ?? 0;
    const disponible = stockBase - reservado;
    const cupoProvision = Math.floor(
      (stockBase * (producto.porcentajeProvision ?? 30)) / 100,
    );
    const disponibleProvision = cupoProvision - reservado;

    if (disponible < cantidadSolicitada) {
      throw new BadRequestException(
        `Stock insuficiente para reservar. Disponible: ${disponible}, solicitado: ${cantidadSolicitada}`,
      );
    }

    if (disponibleProvision < cantidadSolicitada) {
      throw new BadRequestException(
        `La provisión supera el cupo permitido para este producto. Cupo provisión: ${cupoProvision}, ya reservado: ${reservado}, disponible para reservar: ${Math.max(0, disponibleProvision)}`,
      );
    }
  }

  async listar(params: {
    empresaId: number;
    sedeId: number;
    productoId?: number;
    estado?: EstadoReserva;
  }) {
    const { empresaId, sedeId, productoId, estado } = params;

    return this.prisma.reserva.findMany({
      where: {
        empresaId,
        sedeId,
        ...(productoId ? { productoId } : {}),
        ...(estado ? { estado } : {}),
      },
      include: {
        producto: {
          select: {
            id: true,
            descripcion: true,
            codigo: true,
            localizacion: true,
            porcentajeVenta: true,
            porcentajeProvision: true,
          },
        },
      },
      orderBy: { id: 'desc' },
    });
  }

  async obtenerPorId(id: number, empresaId: number, sedeId: number) {
    const reserva = await this.prisma.reserva.findFirst({
      where: { id, empresaId, sedeId },
      include: {
        producto: {
          select: {
            id: true,
            descripcion: true,
            codigo: true,
            localizacion: true,
            porcentajeVenta: true,
            porcentajeProvision: true,
          },
        },
      },
    });

    if (!reserva) throw new NotFoundException('Reserva no encontrada');
    return reserva;
  }

  async crear(dto: CreateReservaDto, empresaId: number, sedeId: number) {
    await this.validarStockDisponible({
      empresaId,
      sedeId,
      productoId: dto.productoId,
      cantidadSolicitada: dto.cantidad,
    });

    return this.prisma.reserva.create({
      data: {
        empresaId,
        sedeId,
        productoId: dto.productoId,
        cantidad: dto.cantidad,
        motivo: dto.motivo,
        estado: (dto.estado as EstadoReserva) || EstadoReserva.PENDIENTE,
        fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : undefined,
      },
      include: {
        producto: {
          select: {
            id: true,
            descripcion: true,
            codigo: true,
            localizacion: true,
            porcentajeVenta: true,
            porcentajeProvision: true,
          },
        },
      },
    });
  }

  async actualizar(
    id: number,
    dto: UpdateReservaDto,
    empresaId: number,
    sedeId: number,
  ) {
    const actual = await this.prisma.reserva.findFirst({
      where: { id, empresaId, sedeId },
      select: { id: true, productoId: true, cantidad: true },
    });

    if (!actual) throw new NotFoundException('Reserva no encontrada');

    if (dto.cantidad !== undefined) {
      await this.validarStockDisponible({
        empresaId,
        sedeId,
        productoId: actual.productoId,
        cantidadSolicitada: dto.cantidad,
        excluirReservaId: id,
      });
    }

    return this.prisma.reserva.update({
      where: { id },
      data: {
        ...(dto.cantidad !== undefined ? { cantidad: dto.cantidad } : {}),
        ...(dto.motivo !== undefined ? { motivo: dto.motivo } : {}),
        ...(dto.estado !== undefined ? { estado: dto.estado as EstadoReserva } : {}),
        ...(dto.fechaVencimiento !== undefined
          ? { fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null }
          : {}),
      },
      include: {
        producto: {
          select: {
            id: true,
            descripcion: true,
            codigo: true,
            localizacion: true,
            porcentajeVenta: true,
            porcentajeProvision: true,
          },
        },
      },
    });
  }

  async eliminar(id: number, empresaId: number, sedeId: number) {
    const actual = await this.prisma.reserva.findFirst({
      where: { id, empresaId, sedeId },
      select: { id: true },
    });

    if (!actual) throw new NotFoundException('Reserva no encontrada');
    await this.prisma.reserva.delete({ where: { id } });
    return { id };
  }
}
