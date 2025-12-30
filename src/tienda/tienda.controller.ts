import {
  Controller,
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

@Controller('tienda')
@UseGuards(JwtAuthGuard)
export class TiendaController {
  constructor(private readonly tiendaService: TiendaService) { }

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
    return this.tiendaService.subirQr(empresaId, tipo, { buffer: file?.buffer, mimetype: file?.mimetype });
  }
}
