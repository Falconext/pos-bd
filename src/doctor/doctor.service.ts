import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';

@Injectable()
export class DoctorService {
  constructor(private readonly prisma: PrismaService) {}

  async crear(empresaId: number, dto: CreateDoctorDto) {
    return this.prisma.doctor.create({
      data: { ...dto, empresaId },
    });
  }

  async listar(empresaId: number, search?: string) {
    return this.prisma.doctor.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
        ...(search
          ? {
              OR: [
                { nombre: { contains: search, mode: 'insensitive' } },
                { cmp: { contains: search, mode: 'insensitive' } },
                { especialidad: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async obtener(empresaId: number, id: number) {
    const doctor = await this.prisma.doctor.findFirst({ where: { id, empresaId } });
    if (!doctor) throw new NotFoundException('Doctor no encontrado');
    return doctor;
  }

  async actualizar(empresaId: number, id: number, dto: UpdateDoctorDto) {
    await this.obtener(empresaId, id);
    return this.prisma.doctor.update({ where: { id }, data: dto });
  }

  async eliminar(empresaId: number, id: number) {
    await this.obtener(empresaId, id);
    return this.prisma.doctor.update({ where: { id }, data: { estado: 'INACTIVO' } });
  }

  async pacientes(empresaId: number, medicoId: number) {
    await this.obtener(empresaId, medicoId);
    return this.prisma.cliente.findMany({
      where: { empresaId, medicoTratanteId: medicoId, estado: 'ACTIVO' },
      orderBy: { nombre: 'asc' },
    });
  }
}
