import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClienteLogisticaDto } from './dto/create-cliente.dto';
import { UpdateClienteLogisticaDto } from './dto/update-cliente.dto';

@Injectable()
export class ClienteLogisticaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: number, params?: { search?: string }) {
    return this.prisma.clienteLogistica.findMany({
      where: {
        empresaId,
        ...(params?.search
          ? {
              OR: [
                { nombre: { contains: params.search, mode: 'insensitive' } },
                {
                  nroDocumento: {
                    contains: params.search,
                    mode: 'insensitive',
                  },
                },
                { email: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        direcciones: true,
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const cliente = await this.prisma.clienteLogistica.findFirst({
      where: { id, empresaId },
      include: {
        direcciones: {
          include: { zona: true },
        },
      },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    return cliente;
  }

  async create(empresaId: number, dto: CreateClienteLogisticaDto) {
    return this.prisma.clienteLogistica.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        tipoDocumento: dto.tipoDocumento,
        nroDocumento: dto.nroDocumento,
        email: dto.email,
        celular: dto.celular,
        whatsapp: dto.whatsapp,
        scoreConfianza: dto.scoreConfianza ?? 100,
      },
    });
  }

  async update(id: number, empresaId: number, dto: UpdateClienteLogisticaDto) {
    await this.findOne(id, empresaId);
    return this.prisma.clienteLogistica.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.clienteLogistica.delete({
      where: { id },
    });
  }
}
