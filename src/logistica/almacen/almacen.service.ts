import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAlmacenLogisticaDto } from './dto/create-almacen.dto';
import { UpdateAlmacenLogisticaDto } from './dto/update-almacen.dto';

@Injectable()
export class AlmacenLogisticaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    empresaId: number,
    params?: { search?: string; activo?: boolean },
  ) {
    return this.prisma.almacenLogistica.findMany({
      where: {
        empresaId,
        ...(params?.activo !== undefined ? { activo: params.activo } : {}),
        ...(params?.search
          ? {
              OR: [
                { nombre: { contains: params.search, mode: 'insensitive' } },
                { codigo: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const almacen = await this.prisma.almacenLogistica.findFirst({
      where: { id, empresaId },
    });
    if (!almacen) throw new NotFoundException('Almacén no encontrado');
    return almacen;
  }

  async create(empresaId: number, dto: CreateAlmacenLogisticaDto) {
    if (dto.codigo) {
      const existing = await this.prisma.almacenLogistica.findUnique({
        where: { empresaId_codigo: { empresaId, codigo: dto.codigo } },
      });
      if (existing)
        throw new ConflictException('Ya existe un almacén con ese código');
    }

    return this.prisma.almacenLogistica.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        codigo: dto.codigo,
        tipo: dto.tipo ?? 'PRINCIPAL',
        direccion: dto.direccion,
        distrito: dto.distrito,
        ciudad: dto.ciudad,
        departamento: dto.departamento,
        lat: dto.lat,
        lng: dto.lng,
        contactoNombre: dto.contactoNombre,
        contactoTelefono: dto.contactoTelefono,
        nroMuelles: dto.nroMuelles ?? 1,
        horaApertura: dto.horaApertura,
        horaCierre: dto.horaCierre,
        activo: dto.activo ?? true,
      },
    });
  }

  async update(id: number, empresaId: number, dto: UpdateAlmacenLogisticaDto) {
    await this.findOne(id, empresaId);

    if (dto.codigo) {
      const existing = await this.prisma.almacenLogistica.findFirst({
        where: { empresaId, codigo: dto.codigo, id: { not: id } },
      });
      if (existing)
        throw new ConflictException('Ya existe otro almacén con ese código');
    }

    return this.prisma.almacenLogistica.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.almacenLogistica.update({
      where: { id },
      data: { activo: false },
    });
  }
}
