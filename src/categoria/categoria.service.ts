import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class CategoriaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) { }

  async crear(dto: CreateCategoriaDto, empresaId: number) {
    const existe = await this.prisma.categoria.findFirst({
      where: { nombre: dto.nombre, empresaId },
    });
    if (existe)
      throw new ForbiddenException(
        'Ya existe una categoría con ese nombre en tu empresa',
      );
    return this.prisma.categoria.create({ data: { nombre: dto.nombre, imagenUrl: dto.imagenUrl, empresaId } });
  }

  async listar(empresaId: number) {
    return this.prisma.categoria.findMany({
      where: { empresaId },
      orderBy: { id: 'desc' },
      include: {
        _count: {
          select: { productos: true },
        },
      },
    });
  }

  async obtenerPorId(id: number, empresaId: number) {
    const categoria = await this.prisma.categoria.findFirst({
      where: { id, empresaId },
    });
    if (!categoria) throw new NotFoundException('Categoría no encontrada');
    return categoria;
  }

  async actualizar(id: number, dto: CreateCategoriaDto, empresaId: number) {
    const categoria = await this.prisma.categoria.findFirst({
      where: { id, empresaId },
    });
    if (!categoria) throw new NotFoundException('Categoría no encontrada');
    return this.prisma.categoria.update({ where: { id }, data: { nombre: dto.nombre, imagenUrl: dto.imagenUrl } });
  }

  async eliminar(id: number, empresaId: number) {
    const categoria = await this.prisma.categoria.findFirst({
      where: { id, empresaId },
    });
    if (!categoria) throw new NotFoundException('Categoría no encontrada');
    return this.prisma.categoria.delete({ where: { id } });
  }

  async subirImagenPrincipal(
    empresaId: number,
    categoriaId: number,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    const categoria = await this.prisma.categoria.findFirst({ where: { id: categoriaId, empresaId } });
    if (!categoria) throw new NotFoundException('Categoría no encontrada');
    if (!file || !file.buffer) throw new ForbiddenException('Archivo no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct)) throw new ForbiddenException('El archivo debe ser una imagen');

    const ts = Date.now();
    const s3Key = `categorias/empresa-${empresaId}/categoria-${categoriaId}/${ts}.webp`;
    const url = await this.s3.uploadImage(file.buffer, s3Key, ct);

    await this.prisma.categoria.update({ where: { id: categoriaId }, data: { imagenUrl: url } });

    const idx = url.indexOf('amazonaws.com/');
    const objKey = idx !== -1 ? url.substring(idx + 'amazonaws.com/'.length) : '';
    const signedUrl = objKey ? await this.s3.getSignedGetUrl(objKey, 600) : url;
    return { url, signedUrl };
  }
}
