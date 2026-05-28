import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('extensiones')
export class ExtensionesController {
  constructor(private readonly prisma: PrismaService) { }

  private normalizeProducto(value?: string | null): 'facturacion' | 'hotel' {
    return String(value ?? '').trim().toLowerCase() === 'hotel' ? 'hotel' : 'facturacion';
  }

  private normalizePlataforma(value?: string | null): 'falconext' | 'krezka' {
    return String(value ?? '').trim().toLowerCase() === 'krezka' ? 'krezka' : 'falconext';
  }

  @Get('unidad-medida')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA', 'ADMIN_SISTEMA')
  async listarUnidadMedida() {
    const data = await this.prisma.unidadMedida.findMany({
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: 'asc' },
    });
    return data;
  }

  @Get('ubigeos')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA', 'ADMIN_SISTEMA')
  async listarUbigeos() {
    const data = await this.prisma.ubigeo.findMany({
      select: {
        codigo: true,
        departamento: true,
        provincia: true,
        distrito: true,
      },
      orderBy: [
        { departamento: 'asc' },
        { provincia: 'asc' },
        { distrito: 'asc' },
      ],
    });
    return data;
  }

  @Get('motivos-nota')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA', 'ADMIN_SISTEMA')
  async listarMotivosNota(@Query('tipo') tipo?: 'CREDITO' | 'DEBITO') {
    if (tipo && tipo !== 'CREDITO' && tipo !== 'DEBITO') {
      throw new BadRequestException('tipo inválido, debe ser CREDITO o DEBITO');
    }
    const data: any = await this.prisma.motivoNota.findMany({
      where: tipo ? { tipo } : undefined,
      orderBy: { codigo: 'asc' },
      select: { id: true, tipo: true, codigo: true, descripcion: true },
    });
    console.log(data);
    return data;
  }

  @Get('currencies')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA', 'ADMIN_SISTEMA')
  async listarMonedas() {
    // Intenta obtener monedas distintas desde comprobantes; fallback a estático
    const rows = await this.prisma.comprobante.findMany({
      distinct: ['tipoMoneda'],
      select: { tipoMoneda: true },
    });
    const list = rows.map((r) => r.tipoMoneda).filter(Boolean);
    const uniques = Array.from(new Set(list));
    const currencies =
      uniques.length > 0
        ? uniques.map((code) => ({ code, name: code }))
        : [
          { code: 'PEN', name: 'PEN' },
          { code: 'USD', name: 'USD' },
        ];
    return currencies;
  }

  @Get('document-types')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA', 'ADMIN_SISTEMA')
  async listarTiposDocumento() {
    const documentTypes = await this.prisma.tipoDocumento.findMany({
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, descripcion: true },
    });
    return documentTypes;
  }

  @Get('planes')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA', 'ADMIN_SISTEMA')
  async listarPlanes(
    @Query('producto') producto?: string,
    @Query('plataforma') plataforma?: string,
    @User() user?: any,
  ) {
    const productoFiltro = user?.sistemaProducto
      ? this.normalizeProducto(user.sistemaProducto)
      : (producto ? this.normalizeProducto(producto) : undefined);
    const plataformaFiltro = user?.sistemaNegocio
      ? this.normalizePlataforma(user.sistemaNegocio)
      : (plataforma ? this.normalizePlataforma(plataforma) : undefined);
    const planes = await this.prisma.plan.findMany({
      where: {
        ...(productoFiltro ? { producto: productoFiltro } : {}),
        ...(plataformaFiltro ? { plataforma: plataformaFiltro } : {}),
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        nombre: true,
        plataforma: true,
        producto: true,
        descripcion: true,
        limiteUsuarios: true,
        costo: true,
        tieneTienda: true,
        duracionDias: true,
        tipoFacturacion: true,
        tieneBanners: true,
        tieneGaleria: true,
        tieneCulqi: true,
        tieneDeliveryGPS: true,
        maxBanners: true,
        maxImagenesProducto: true,
      },
    });
    return planes;
  }

  @Get('rubros')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA', 'ADMIN_SISTEMA')
  async listarRubros() {
    const rubros = await this.prisma.rubro.findMany({
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true },
    });
    return rubros;
  }
}
