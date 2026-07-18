import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContratoVehicularDto } from './dto/create-contrato.dto';
import { UpdateContratoVehicularDto } from './dto/update-contrato.dto';

/** Suma N meses a una fecha sin dependencia externa */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

@Injectable()
export class ContratoVehicularService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly INCLUDE_BASE = {
    vehiculo: {
      select: {
        id: true,
        placa: true,
        marca: true,
        modelo: true,
        color: true,
        cliente: { select: { id: true, nombre: true, telefono: true } },
      },
    },
    producto: { select: { id: true, descripcion: true, precioUnitario: true } },
  };

  async findAll(
    empresaId: number,
    params: {
      estado?: string;
      search?: string;
      page?: number;
      limit?: number;
      soloProximosVencer?: boolean;
    },
  ) {
    const { estado, search, page = 1, limit = 30, soloProximosVencer } = params;
    const skip = (page - 1) * limit;

    const where: any = { empresaId };

    if (estado && estado !== 'TODOS') {
      where.estado = estado;
    }

    if (soloProximosVencer) {
      const en30dias = new Date();
      en30dias.setDate(en30dias.getDate() + 30);
      where.fechaFin = { lte: en30dias };
      where.estado = { not: 'CANCELADO' };
    }

    if (search) {
      where.vehiculo = {
        OR: [
          { placa: { contains: search.toUpperCase(), mode: 'insensitive' } },
          { marca: { contains: search, mode: 'insensitive' } },
          { cliente: { nombre: { contains: search, mode: 'insensitive' } } },
        ],
      };
    }

    const [total, contratos] = await Promise.all([
      this.prisma.contratoVehicular.count({ where }),
      this.prisma.contratoVehicular.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaFin: 'asc' },
        include: this.INCLUDE_BASE,
      }),
    ]);

    return {
      data: contratos,
      paginacion: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findAlertas(empresaId: number) {
    const en30dias = new Date();
    en30dias.setDate(en30dias.getDate() + 30);

    return this.prisma.contratoVehicular.findMany({
      where: {
        empresaId,
        estado: { in: ['VIGENTE', 'POR_VENCER'] },
        fechaFin: { lte: en30dias },
      },
      orderBy: { fechaFin: 'asc' },
      include: this.INCLUDE_BASE,
    });
  }

  async create(empresaId: number, dto: CreateContratoVehicularDto) {
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: { id: dto.vehiculoId, empresaId },
    });
    if (!vehiculo) throw new NotFoundException('Vehículo no encontrado');

    // Un vehículo no puede tener más de un contrato activo a la vez.
    const activo = await this.prisma.contratoVehicular.findFirst({
      where: {
        empresaId,
        vehiculoId: dto.vehiculoId,
        estado: { in: ['VIGENTE', 'POR_VENCER'] },
      },
    });
    if (activo)
      throw new ConflictException(
        'Este vehículo ya tiene un contrato activo. Renuévalo o cancélalo antes de crear otro.',
      );

    const fechaInicio = new Date(dto.fechaInicio);
    const duracion = dto.duracionMeses ?? 12;
    const fechaFin = addMonths(fechaInicio, duracion);

    // Calcular estado inicial
    const hoy = new Date();
    const diasRestantes = Math.ceil(
      (fechaFin.getTime() - hoy.getTime()) / 86400000,
    );
    const estado =
      diasRestantes < 0
        ? 'VENCIDO'
        : diasRestantes <= 30
          ? 'POR_VENCER'
          : 'VIGENTE';

    return this.prisma.contratoVehicular.create({
      data: {
        empresaId,
        vehiculoId: dto.vehiculoId,
        productoId: dto.productoId,
        fechaInicio,
        fechaFin,
        estado,
        montoAnual: dto.montoAnual,
        observaciones: dto.observaciones,
      },
      include: this.INCLUDE_BASE,
    });
  }

  // Edición manual del contrato (por ejemplo, para corregir una renovación hecha por error).
  async update(
    id: number,
    empresaId: number,
    dto: UpdateContratoVehicularDto,
  ) {
    const contrato = await this.prisma.contratoVehicular.findFirst({
      where: { id, empresaId },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const data: any = {};
    if (dto.productoId !== undefined) data.productoId = dto.productoId;
    if (dto.montoAnual !== undefined) data.montoAnual = dto.montoAnual;
    if (dto.observaciones !== undefined) data.observaciones = dto.observaciones;

    // Si cambian la fecha de inicio o la duración, recalculamos fecha fin y estado.
    if (dto.fechaInicio !== undefined || dto.duracionMeses !== undefined) {
      const fechaInicio = dto.fechaInicio
        ? new Date(dto.fechaInicio)
        : contrato.fechaInicio;
      const duracion = dto.duracionMeses ?? 12;
      const fechaFin = addMonths(fechaInicio, duracion);
      data.fechaInicio = fechaInicio;
      data.fechaFin = fechaFin;

      // No revivimos un contrato cancelado; el resto se recalcula por fecha.
      if (contrato.estado !== 'CANCELADO') {
        const dias = Math.ceil(
          (fechaFin.getTime() - new Date().getTime()) / 86400000,
        );
        data.estado =
          dias < 0 ? 'VENCIDO' : dias <= 30 ? 'POR_VENCER' : 'VIGENTE';
      }
    }

    return this.prisma.contratoVehicular.update({
      where: { id },
      data,
      include: this.INCLUDE_BASE,
    });
  }

  async remove(id: number, empresaId: number) {
    const contrato = await this.prisma.contratoVehicular.findFirst({
      where: { id, empresaId },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    return this.prisma.contratoVehicular.delete({ where: { id } });
  }

  async renovar(id: number, empresaId: number, meses = 12) {
    const contrato = await this.prisma.contratoVehicular.findFirst({
      where: { id, empresaId },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    if (contrato.estado === 'CANCELADO')
      throw new ConflictException(
        'No se puede renovar un contrato cancelado. Crea uno nuevo.',
      );

    // La nueva fecha de inicio es la fecha fin del contrato actual (o hoy si ya venció)
    const base =
      contrato.fechaFin > new Date() ? contrato.fechaFin : new Date();
    const nuevaFechaFin = addMonths(base, meses > 0 ? meses : 12);

    return this.prisma.contratoVehicular.update({
      where: { id },
      data: {
        fechaInicio: base,
        fechaFin: nuevaFechaFin,
        estado: 'VIGENTE',
      },
      include: this.INCLUDE_BASE,
    });
  }

  async cancelar(id: number, empresaId: number) {
    const contrato = await this.prisma.contratoVehicular.findFirst({
      where: { id, empresaId },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    if (contrato.estado === 'CANCELADO')
      throw new ConflictException('El contrato ya está cancelado.');

    return this.prisma.contratoVehicular.update({
      where: { id },
      data: { estado: 'CANCELADO' },
      include: this.INCLUDE_BASE,
    });
  }

  /**
   * Llamado por el scheduler diariamente.
   * Marca como VENCIDO los contratos pasados, POR_VENCER los próximos 30 días.
   */
  async actualizarEstados() {
    const hoy = new Date();
    const en30dias = new Date();
    en30dias.setDate(en30dias.getDate() + 30);

    // Marcar VENCIDOS
    const vencidos = await this.prisma.contratoVehicular.updateMany({
      where: {
        fechaFin: { lt: hoy },
        estado: { in: ['VIGENTE', 'POR_VENCER'] },
      },
      data: { estado: 'VENCIDO' },
    });

    // Marcar POR_VENCER
    const porVencer = await this.prisma.contratoVehicular.updateMany({
      where: {
        fechaFin: { gte: hoy, lte: en30dias },
        estado: 'VIGENTE',
      },
      data: { estado: 'POR_VENCER' },
    });

    return { vencidos: vencidos.count, porVencer: porVencer.count };
  }
}
