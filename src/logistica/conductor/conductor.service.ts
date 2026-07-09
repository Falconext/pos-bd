import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateConductorDto,
  EstadoConductorLogistica,
} from './dto/create-conductor.dto';
import { UpdateConductorDto } from './dto/update-conductor.dto';

@Injectable()
export class ConductorService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    empresaId: number,
    params?: { search?: string; estado?: string },
  ) {
    return this.prisma.conductorLogistica.findMany({
      where: {
        empresaId,
        ...(params?.estado
          ? { estado: params.estado as EstadoConductorLogistica }
          : {}),
        ...(params?.search
          ? {
              OR: [
                { nombre: { contains: params.search, mode: 'insensitive' } },
                { apellido: { contains: params.search, mode: 'insensitive' } },
                { dni: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const conductor = await this.prisma.conductorLogistica.findFirst({
      where: { id, empresaId },
      include: {
        repartidor: true,
      },
    });
    if (!conductor) throw new NotFoundException('Conductor no encontrado');
    return conductor;
  }

  async create(empresaId: number, dto: CreateConductorDto) {
    if (dto.repartidorId) {
      const rep = await this.prisma.repartidor.findFirst({
        where: { id: dto.repartidorId, empresaId },
      });
      if (!rep)
        throw new BadRequestException('El Repartidor referenciado no existe');
    }

    return this.prisma.conductorLogistica.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        apellido: dto.apellido,
        dni: dto.dni,
        celular: dto.celular,
        email: dto.email,
        nroLicencia: dto.nroLicencia,
        tipoLicencia: dto.tipoLicencia,
        vencimientoLicencia: dto.vencimientoLicencia
          ? new Date(dto.vencimientoLicencia)
          : null,
        tipoEmpleo: dto.tipoEmpleo,
        estado: dto.estado ?? EstadoConductorLogistica.DISPONIBLE,
        repartidorId: dto.repartidorId,
      },
    });
  }

  async update(id: number, empresaId: number, dto: UpdateConductorDto) {
    await this.findOne(id, empresaId);

    if (dto.repartidorId) {
      const rep = await this.prisma.repartidor.findFirst({
        where: { id: dto.repartidorId, empresaId },
      });
      if (!rep)
        throw new BadRequestException('El Repartidor referenciado no existe');
    }

    return this.prisma.conductorLogistica.update({
      where: { id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.apellido && { apellido: dto.apellido }),
        ...(dto.dni && { dni: dto.dni }),
        ...(dto.celular && { celular: dto.celular }),
        ...(dto.email && { email: dto.email }),
        ...(dto.nroLicencia && { nroLicencia: dto.nroLicencia }),
        ...(dto.tipoLicencia && { tipoLicencia: dto.tipoLicencia }),
        ...(dto.vencimientoLicencia && {
          vencimientoLicencia: new Date(dto.vencimientoLicencia),
        }),
        ...(dto.tipoEmpleo && { tipoEmpleo: dto.tipoEmpleo }),
        ...(dto.estado && { estado: dto.estado }),
        ...(dto.repartidorId && { repartidorId: dto.repartidorId }),
      },
    });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.conductorLogistica.update({
      where: { id },
      data: { estado: EstadoConductorLogistica.NO_DISPONIBLE },
    });
  }
}
