import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateDocumentoDto,
  EntidadDocumentoLogistica,
} from './dto/create-documento.dto';
import { UpdateDocumentoDto } from './dto/update-documento.dto';

const MS_DIA = 1000 * 60 * 60 * 24;

@Injectable()
export class DocumentosService {
  constructor(private readonly prisma: PrismaService) {}

  private includeEntidades = {
    vehiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
    conductor: { select: { id: true, nombre: true, apellido: true, dni: true } },
  };

  /** Valida coherencia entidad ↔ id y pertenencia a la empresa. */
  private async validarEntidad(
    empresaId: number,
    entidad: EntidadDocumentoLogistica,
    vehiculoId?: number,
    conductorId?: number,
  ) {
    if (entidad === EntidadDocumentoLogistica.VEHICULO) {
      if (!vehiculoId)
        throw new BadRequestException('vehiculoId es requerido para un documento de vehículo');
      const v = await this.prisma.vehiculoLogistica.findFirst({
        where: { id: vehiculoId, empresaId },
      });
      if (!v) throw new BadRequestException('El vehículo indicado no existe');
    } else {
      if (!conductorId)
        throw new BadRequestException('conductorId es requerido para un documento de conductor');
      const c = await this.prisma.conductorLogistica.findFirst({
        where: { id: conductorId, empresaId },
      });
      if (!c) throw new BadRequestException('El conductor indicado no existe');
    }
  }

  /** Deriva el estado de vencimiento de un documento. */
  private estadoVencimiento(fechaVencimiento: Date, diasAviso = 30) {
    const hoy = new Date();
    const dias = Math.ceil(
      (fechaVencimiento.getTime() - hoy.getTime()) / MS_DIA,
    );
    let estado: 'VIGENTE' | 'POR_VENCER' | 'VENCIDO';
    if (dias < 0) estado = 'VENCIDO';
    else if (dias <= diasAviso) estado = 'POR_VENCER';
    else estado = 'VIGENTE';
    return { estado, diasRestantes: dias };
  }

  private decorar(doc: any, diasAviso = 30) {
    return { ...doc, ...this.estadoVencimiento(doc.fechaVencimiento, diasAviso) };
  }

  async findAll(
    empresaId: number,
    params?: {
      entidad?: string;
      vehiculoId?: number;
      conductorId?: number;
      tipo?: string;
      estado?: string; // VIGENTE | POR_VENCER | VENCIDO
      search?: string;
    },
  ) {
    const docs = await this.prisma.documentoLogistica.findMany({
      where: {
        empresaId,
        ...(params?.entidad
          ? { entidad: params.entidad as EntidadDocumentoLogistica }
          : {}),
        ...(params?.vehiculoId ? { vehiculoId: params.vehiculoId } : {}),
        ...(params?.conductorId ? { conductorId: params.conductorId } : {}),
        ...(params?.tipo ? { tipo: params.tipo } : {}),
        ...(params?.search
          ? {
              OR: [
                { tipo: { contains: params.search, mode: 'insensitive' } },
                { numero: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: this.includeEntidades,
      orderBy: { fechaVencimiento: 'asc' },
    });
    const decorados = docs.map((d) => this.decorar(d));
    return params?.estado
      ? decorados.filter((d) => d.estado === params.estado)
      : decorados;
  }

  async findOne(id: number, empresaId: number) {
    const doc = await this.prisma.documentoLogistica.findFirst({
      where: { id, empresaId },
      include: this.includeEntidades,
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    return this.decorar(doc);
  }

  async create(empresaId: number, dto: CreateDocumentoDto) {
    await this.validarEntidad(
      empresaId,
      dto.entidad,
      dto.vehiculoId,
      dto.conductorId,
    );
    const doc = await this.prisma.documentoLogistica.create({
      data: {
        empresaId,
        entidad: dto.entidad,
        vehiculoId:
          dto.entidad === EntidadDocumentoLogistica.VEHICULO
            ? dto.vehiculoId
            : null,
        conductorId:
          dto.entidad === EntidadDocumentoLogistica.CONDUCTOR
            ? dto.conductorId
            : null,
        tipo: dto.tipo,
        numero: dto.numero,
        fechaEmision: dto.fechaEmision ? new Date(dto.fechaEmision) : null,
        fechaVencimiento: new Date(dto.fechaVencimiento),
        archivoUrl: dto.archivoUrl,
        notas: dto.notas,
      },
      include: this.includeEntidades,
    });
    return this.decorar(doc);
  }

  async update(id: number, empresaId: number, dto: UpdateDocumentoDto) {
    const existente = await this.prisma.documentoLogistica.findFirst({
      where: { id, empresaId },
    });
    if (!existente) throw new NotFoundException('Documento no encontrado');

    if (dto.entidad || dto.vehiculoId || dto.conductorId) {
      await this.validarEntidad(
        empresaId,
        (dto.entidad ?? existente.entidad) as EntidadDocumentoLogistica,
        dto.vehiculoId ?? existente.vehiculoId ?? undefined,
        dto.conductorId ?? existente.conductorId ?? undefined,
      );
    }

    const doc = await this.prisma.documentoLogistica.update({
      where: { id },
      data: {
        ...(dto.entidad && { entidad: dto.entidad }),
        ...(dto.vehiculoId !== undefined && { vehiculoId: dto.vehiculoId }),
        ...(dto.conductorId !== undefined && { conductorId: dto.conductorId }),
        ...(dto.tipo && { tipo: dto.tipo }),
        ...(dto.numero !== undefined && { numero: dto.numero }),
        ...(dto.fechaEmision !== undefined && {
          fechaEmision: dto.fechaEmision ? new Date(dto.fechaEmision) : null,
        }),
        ...(dto.fechaVencimiento && {
          fechaVencimiento: new Date(dto.fechaVencimiento),
        }),
        ...(dto.archivoUrl !== undefined && { archivoUrl: dto.archivoUrl }),
        ...(dto.notas !== undefined && { notas: dto.notas }),
      },
      include: this.includeEntidades,
    });
    return this.decorar(doc);
  }

  async remove(id: number, empresaId: number) {
    const existente = await this.prisma.documentoLogistica.findFirst({
      where: { id, empresaId },
    });
    if (!existente) throw new NotFoundException('Documento no encontrado');
    return this.prisma.documentoLogistica.delete({ where: { id } });
  }

  /** Alertas: documentos vencidos y por vencer dentro de `dias`. */
  async alertas(empresaId: number, dias = 30) {
    const limite = new Date(Date.now() + dias * MS_DIA);
    const docs = await this.prisma.documentoLogistica.findMany({
      where: { empresaId, fechaVencimiento: { lte: limite } },
      include: this.includeEntidades,
      orderBy: { fechaVencimiento: 'asc' },
    });
    const decorados = docs.map((d) => this.decorar(d, dias));
    return {
      vencidos: decorados.filter((d) => d.estado === 'VENCIDO'),
      porVencer: decorados.filter((d) => d.estado === 'POR_VENCER'),
    };
  }

  /** Métricas para el encabezado. */
  async resumen(empresaId: number, dias = 30) {
    const docs = await this.prisma.documentoLogistica.findMany({
      where: { empresaId },
      select: { fechaVencimiento: true },
    });
    let vencidos = 0,
      porVencer = 0,
      vigentes = 0;
    for (const d of docs) {
      const { estado } = this.estadoVencimiento(d.fechaVencimiento, dias);
      if (estado === 'VENCIDO') vencidos++;
      else if (estado === 'POR_VENCER') porVencer++;
      else vigentes++;
    }
    return { total: docs.length, vencidos, porVencer, vigentes };
  }
}
