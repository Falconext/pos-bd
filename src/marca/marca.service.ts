import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMarcaDto } from './dto/create-marca.dto';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class MarcaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service
  ) { }

  async crear(dto: CreateMarcaDto, empresaId: number) {
    const existe = await this.prisma.marca.findFirst({ where: { nombre: dto.nombre, empresaId } });
    if (existe) throw new ForbiddenException('Ya existe una marca con ese nombre en tu empresa');
    return this.prisma.marca.create({ data: { nombre: dto.nombre, imagenUrl: dto.imagenUrl, empresaId } });
  }

  async listar(empresaId: number) {
    return this.prisma.marca.findMany({ where: { empresaId }, orderBy: { id: 'desc' } });
  }

  async obtenerPorId(id: number, empresaId: number) {
    const marca = await this.prisma.marca.findFirst({ where: { id, empresaId } });
    if (!marca) throw new NotFoundException('Marca no encontrada');
    return marca;
  }

  async actualizar(id: number, dto: CreateMarcaDto, empresaId: number) {
    const marca = await this.prisma.marca.findFirst({ where: { id, empresaId } });
    if (!marca) throw new NotFoundException('Marca no encontrada');
    // Validar duplicado
    const existe = await this.prisma.marca.findFirst({ where: { nombre: dto.nombre, empresaId, NOT: { id } } });
    if (existe) throw new ForbiddenException('Ya existe otra marca con ese nombre');
    return this.prisma.marca.update({ where: { id }, data: { nombre: dto.nombre, imagenUrl: dto.imagenUrl } });
  }

  async eliminar(id: number, empresaId: number) {
    const marca = await this.prisma.marca.findFirst({ where: { id, empresaId } });
    if (!marca) throw new NotFoundException('Marca no encontrada');
    return this.prisma.marca.delete({ where: { id } });
  }

  async subirImagenPrincipal(
    empresaId: number,
    marcaId: number,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    const marca = await this.prisma.marca.findFirst({ where: { id: marcaId, empresaId } });
    if (!marca) throw new NotFoundException('Marca no encontrada');
    if (!file || !file.buffer) throw new ForbiddenException('Archivo no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct)) throw new ForbiddenException('El archivo debe ser una imagen');

    const ts = Date.now();
    const s3Key = `marcas/empresa-${empresaId}/marca-${marcaId}/${ts}.webp`;
    const url = await this.s3.uploadImage(file.buffer, s3Key, ct);

    await this.prisma.marca.update({ where: { id: marcaId }, data: { imagenUrl: url } });

    const idx = url.indexOf('amazonaws.com/');
    const objKey = idx !== -1 ? url.substring(idx + 'amazonaws.com/'.length) : '';
    const signedUrl = objKey ? await this.s3.getSignedGetUrl(objKey, 600) : url;
    return { url, signedUrl };
  }
}
