import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeocercasService } from '../geocercas/geocercas.service';
import { CreateDispositivoDto } from './dto/create-dispositivo.dto';
import { UpdateDispositivoDto } from './dto/update-dispositivo.dto';
import { IngestaPosicionDto } from './dto/ingesta-posicion.dto';

/** Minutos sin reportar tras los cuales un dispositivo se considera offline. */
const OFFLINE_MIN = 15;

@Injectable()
export class DispositivosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocercas: GeocercasService,
  ) {}

  private online(ultimaConexion: Date | null) {
    if (!ultimaConexion) return false;
    return Date.now() - ultimaConexion.getTime() <= OFFLINE_MIN * 60 * 1000;
  }

  private decorar(d: any) {
    return { ...d, online: this.online(d.ultimaConexion) };
  }

  async findAll(empresaId: number, params?: { search?: string }) {
    const dispositivos = await this.prisma.dispositivoGpsLogistica.findMany({
      where: {
        empresaId,
        ...(params?.search
          ? {
              OR: [
                { nombre: { contains: params.search, mode: 'insensitive' } },
                {
                  identificador: {
                    contains: params.search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        vehiculo: { select: { id: true, placa: true } },
        _count: { select: { posiciones: true } },
      },
      orderBy: { creadoEn: 'desc' },
    });
    return dispositivos.map((d) => this.decorar(d));
  }

  async findOne(id: number, empresaId: number) {
    const d = await this.prisma.dispositivoGpsLogistica.findFirst({
      where: { id, empresaId },
      include: { vehiculo: { select: { id: true, placa: true } } },
    });
    if (!d) throw new NotFoundException('Dispositivo no encontrado');
    return this.decorar(d);
  }

  async create(empresaId: number, dto: CreateDispositivoDto) {
    const existe = await this.prisma.dispositivoGpsLogistica.findUnique({
      where: {
        empresaId_identificador: {
          empresaId,
          identificador: dto.identificador,
        },
      },
    });
    if (existe)
      throw new ConflictException('Ya existe un dispositivo con ese identificador');
    if (dto.vehiculoId) {
      const v = await this.prisma.vehiculoLogistica.findFirst({
        where: { id: dto.vehiculoId, empresaId },
      });
      if (!v) throw new BadRequestException('El vehículo indicado no existe');
    }
    return this.prisma.dispositivoGpsLogistica.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        identificador: dto.identificador,
        vehiculoId: dto.vehiculoId,
        activo: dto.activo ?? true,
      },
      include: { vehiculo: { select: { id: true, placa: true } } },
    });
  }

  async update(id: number, empresaId: number, dto: UpdateDispositivoDto) {
    await this.findOne(id, empresaId);
    if (dto.vehiculoId) {
      const v = await this.prisma.vehiculoLogistica.findFirst({
        where: { id: dto.vehiculoId, empresaId },
      });
      if (!v) throw new BadRequestException('El vehículo indicado no existe');
    }
    return this.prisma.dispositivoGpsLogistica.update({
      where: { id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.identificador && { identificador: dto.identificador }),
        ...(dto.vehiculoId !== undefined && { vehiculoId: dto.vehiculoId }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
      },
      include: { vehiculo: { select: { id: true, placa: true } } },
    });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.dispositivoGpsLogistica.delete({ where: { id } });
  }

  async posiciones(
    dispositivoId: number,
    empresaId: number,
    limit = 100,
  ) {
    await this.findOne(dispositivoId, empresaId);
    return this.prisma.posicionGpsLogistica.findMany({
      where: { dispositivoId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  async resumen(empresaId: number) {
    const dispositivos = await this.prisma.dispositivoGpsLogistica.findMany({
      where: { empresaId },
      select: { ultimaConexion: true, activo: true },
    });
    const online = dispositivos.filter((d) => this.online(d.ultimaConexion))
      .length;
    return {
      total: dispositivos.length,
      online,
      offline: dispositivos.length - online,
    };
  }

  /**
   * Ingesta de una posición por token del dispositivo (sin JWT). Registra la
   * posición, actualiza el estado del dispositivo y evalúa geocercas.
   */
  async ingestar(dto: IngestaPosicionDto) {
    const dispositivo = await this.prisma.dispositivoGpsLogistica.findUnique({
      where: { token: dto.token },
    });
    if (!dispositivo) throw new UnauthorizedException('Token de dispositivo inválido');

    const [posicion] = await this.prisma.$transaction([
      this.prisma.posicionGpsLogistica.create({
        data: {
          empresaId: dispositivo.empresaId,
          dispositivoId: dispositivo.id,
          lat: dto.lat,
          lng: dto.lng,
          velocidad: dto.velocidad,
          rumbo: dto.rumbo,
        },
      }),
      this.prisma.dispositivoGpsLogistica.update({
        where: { id: dispositivo.id },
        data: {
          ultimaConexion: new Date(),
          ultimaLat: dto.lat,
          ultimaLng: dto.lng,
        },
      }),
    ]);

    const eventos = await this.geocercas.procesarPosicion(
      dispositivo.empresaId,
      {
        dispositivoId: dispositivo.id,
        vehiculoId: dispositivo.vehiculoId,
        lat: dto.lat,
        lng: dto.lng,
      },
    );

    return { ok: true, posicionId: posicion.id, eventosGenerados: eventos.length };
  }
}
