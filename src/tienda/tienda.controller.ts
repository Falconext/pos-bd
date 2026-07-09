import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadOptions } from '../common/utils/multer.config';
import { TiendaService } from './tienda.service';
import { ConfigurarTiendaDto } from './dto/configurar-tienda.dto';
import { ActualizarEstadoPedidoDto } from './dto/actualizar-pedido.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('tienda')
@UseGuards(JwtAuthGuard)
export class TiendaController {
  constructor(private readonly tiendaService: TiendaService) {}

  // ==================== CONFIGURACIÓN ====================

  @Get('config')
  async obtenerConfiguracion(@Req() req: any) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.obtenerConfiguracionTienda(empresaId);
  }

  @Patch('config')
  async configurarTienda(@Req() req: any, @Body() dto: ConfigurarTiendaDto) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.configurarTienda(empresaId, dto);
  }

  @Patch('diseno')
  async actualizarDiseno(@Req() req: any, @Body() body: Record<string, any>) {
    return this.tiendaService.actualizarDiseno(req.user.empresaId, body);
  }

  @Post('admin/empresas/:empresaId/templates-premium/:plantillaId/activar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async activarCompraPlantillaPremium(
    @Req() req: any,
    @Param('empresaId') empresaId: string,
    @Param('plantillaId') plantillaId: string,
    @Body() body: { precioPagado?: number },
  ) {
    return this.tiendaService.activarCompraPlantillaPremium(
      Number(empresaId),
      plantillaId,
      {
        nombre: req.user?.nombre,
        email: req.user?.email,
        precioPagado: body?.precioPagado,
      },
    );
  }

  @Get('admin/templates-premium/:plantillaId/empresas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async listarEmpresasConPlantillaPremium(
    @Param('plantillaId') plantillaId: string,
  ) {
    return this.tiendaService.listarEmpresasConPlantillaPremium(plantillaId);
  }

  @Delete('admin/empresas/:empresaId/templates-premium/:plantillaId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async desactivarCompraPlantillaPremium(
    @Req() req: any,
    @Param('empresaId') empresaId: string,
    @Param('plantillaId') plantillaId: string,
  ) {
    return this.tiendaService.desactivarCompraPlantillaPremium(
      Number(empresaId),
      plantillaId,
      {
        nombre: req.user?.nombre,
        email: req.user?.email,
      },
    );
  }

  // ==================== PEDIDOS ====================

  @Get('pedidos')
  async listarPedidos(
    @Req() req: any,
    @Query('estado') estado?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.listarPedidos(
      empresaId,
      estado,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('pedidos/:id')
  async obtenerPedido(@Req() req: any, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.obtenerPedido(empresaId, +id);
  }

  @Patch('pedidos/:id/estado')
  async actualizarEstado(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoPedidoDto,
  ) {
    const empresaId = req.user.empresaId;
    const usuarioId = req.user.id;

    return this.tiendaService.actualizarEstadoPedido(empresaId, +id, {
      ...dto,
      usuarioConfirma: usuarioId,
    });
  }

  @Get('pedidos/:id/historial')
  async obtenerHistorialEstados(@Req() req: any, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.obtenerHistorialEstados(empresaId, +id);
  }

  // ==================== RESEÑAS / RATING ====================

  @Get('reviews')
  async listarReviews(
    @Req() req: any,
    @Query('estado') estado?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tiendaService.listarReviewsAdmin(
      req.user.empresaId,
      estado,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Patch('reviews/:id/estado')
  async actualizarReview(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { estado: any },
  ) {
    return this.tiendaService.actualizarEstadoReviewAdmin(
      req.user.empresaId,
      +id,
      body.estado,
    );
  }

  // ==================== CONFIGURACIÓN DE ENVÍO ====================

  @Get('config-envio')
  async obtenerConfigEnvio(@Req() req: any) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.obtenerConfiguracionEnvio(empresaId);
  }

  @Patch('config-envio')
  async actualizarConfigEnvio(@Req() req: any, @Body() dto: any) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.actualizarConfiguracionEnvio(empresaId, dto);
  }

  // ==================== UPLOAD QR ====================

  @Post('qr/:tipo')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirQr(
    @Req() req: any,
    @Param('tipo') tipo: 'yape' | 'plin',
    @UploadedFile() file: Express.Multer.File,
  ) {
    const empresaId = req.user.empresaId;
    if (tipo !== 'yape' && tipo !== 'plin') {
      throw new BadRequestException('Tipo inválido, use yape o plin');
    }
    return this.tiendaService.subirQr(empresaId, tipo, {
      buffer: file?.buffer,
      mimetype: file?.mimetype,
    });
  }

  // ==================== UPLOAD LOGO ====================

  @Post('logo')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirLogo(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.subirLogo(empresaId, {
      buffer: file?.buffer,
      mimetype: file?.mimetype,
    });
  }

  @Post('template/imagen/:campo')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirImagenTemplate(
    @Req() req: any,
    @Param('campo') campo: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.subirImagenTemplate(empresaId, campo, {
      buffer: file?.buffer,
      mimetype: file?.mimetype,
    });
  }

  // Sube una imagen suelta (p. ej. posts del blog) y devuelve su URL sin
  // escribirla en una clave fija del diseño. El frontend guarda la URL dentro
  // de estructuras dinámicas (falconBlogPosts) y persiste vía PATCH /tienda/diseno.
  @Post('template/media')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirMediaTemplate(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const empresaId = req.user.empresaId;
    return this.tiendaService.subirMediaTemplate(empresaId, {
      buffer: file?.buffer,
      mimetype: file?.mimetype,
    });
  }
}
