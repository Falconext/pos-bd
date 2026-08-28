import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ComprasService } from './compras.service';
import { CrearCompraDto } from './dto/crear-compra.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { xmlUploadOptions, imageUploadOptions } from '../common/utils/multer.config';

@Controller('compras')
@UseGuards(JwtAuthGuard)
export class ComprasController {
  constructor(private readonly comprasService: ComprasService) {}

  @Post('parse-xml')
  @UseInterceptors(FileInterceptor('file', xmlUploadOptions))
  async parseXml(@Request() req, @UploadedFile() file: Express.Multer.File) {
    if (!file)
      throw new BadRequestException('No se proporcionó ningún archivo XML');
    return this.comprasService.parseXmlSunat(req.user.empresaId, file.buffer);
  }

  // Lee una FOTO de factura/boleta con IA y devuelve la compra pre-llenada
  // (mismo formato que parse-xml).
  @Post('parse-imagen')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async parseImagen(@Request() req, @UploadedFile() file: Express.Multer.File) {
    if (!file)
      throw new BadRequestException('No se proporcionó ninguna imagen');
    return this.comprasService.parseImagenFactura(
      req.user.empresaId,
      file.buffer,
      file.mimetype,
    );
  }

  @Post()
  async crear(@Request() req, @Body() body: CrearCompraDto) {
    return this.comprasService.crear(
      req.user.empresaId,
      req.user.id,
      body,
      req.user.sedeId,
      req.user.rol,
    );
  }

  // ── Aprobación de compras (maker-checker) ── solo ADMIN_EMPRESA ────────

  @Patch(':id/aprobar')
  @UseGuards(RolesGuard)
  @Roles('ADMIN_EMPRESA')
  async aprobarCompra(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.comprasService.aprobarCompra(
      req.user.empresaId,
      req.user.id,
      id,
    );
  }

  @Patch(':id/rechazar')
  @UseGuards(RolesGuard)
  @Roles('ADMIN_EMPRESA')
  async rechazarCompra(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.comprasService.rechazarCompra(
      req.user.empresaId,
      req.user.id,
      id,
    );
  }

  @Get()
  async listar(@Request() req, @Query() query) {
    const isAdmin = ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'].includes(req.user.rol);
    // Admin puede pasar ?sedeId=X para filtrar, o dejar vacío para ver todas las sedes
    const sedeId = isAdmin
      ? query.sedeId
        ? Number(query.sedeId)
        : null
      : req.user.sedeId;
    return this.comprasService.listar(req.user.empresaId, query, sedeId);
  }

  @Get(':id')
  async obtenerPorId(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.comprasService.obtenerPorId(
      req.user.empresaId,
      id,
      req.user.sedeId,
    );
  }

  // Editar compra: revierte los efectos de inventario anteriores y re-aplica los
  // nuevos (stock/kardex, lotes, series). No modifica los pagos ya registrados.
  @Put(':id')
  async actualizar(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CrearCompraDto,
  ) {
    return this.comprasService.actualizar(
      req.user.empresaId,
      req.user.id,
      id,
      body,
      req.user.sedeId,
    );
  }

  // Anular compra (borrado lógico): marca estado ANULADO y revierte el stock con
  // un movimiento de kardex compensatorio. No borra el registro (auditoría).
  @Delete(':id')
  async anular(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.comprasService.anular(
      req.user.empresaId,
      req.user.id,
      id,
      req.user.sedeId,
    );
  }

  @Post(':id/pagos')
  async registrarPago(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.comprasService.registrarPago(
      req.user.empresaId,
      req.user.id,
      id,
      body,
      req.user.sedeId,
    );
  }

  @Post(':id/registrar-pago')
  async registrarPagoAlias(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.comprasService.registrarPago(
      req.user.empresaId,
      req.user.id,
      id,
      body,
      req.user.sedeId,
    );
  }

  @Get(':id/pagos')
  async historialPagos(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.comprasService.getHistorialPagos(
      req.user.empresaId,
      id,
      req.user.sedeId,
    );
  }
}
