import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Query,
  Res,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { EnvioDespachoService } from './envio-despacho.service';
import { EvidenciaEntregaService } from './evidencia-entrega.service';
import { evidenciaUploadOptions } from '../common/utils/multer.config';
import {
  RegistrarEvidenciaDto,
  EntregasSinEvidenciaQueryDto,
} from './dto/evidencia-entrega.dto';

class ActualizarSaldoDto {
  saldo: number;
}
import {
  CreateEnvioDespachoDto,
  UpdateEnvioDespachoDto,
  ExportarRepartoQueryDto,
} from './dto/envio-despacho.dto';
import { DespachoConfigDto } from './dto/despacho-config.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('envio-despacho')
export class EnvioDespachoController {
  constructor(
    private readonly service: EnvioDespachoService,
    private readonly evidencias: EvidenciaEntregaService,
  ) {}

  /**
   * D3 — evidencia de entrega.
   *
   * Entregas marcadas como ENTREGADO sin ninguna foto: son los pedidos donde,
   * si el cliente reclama, el negocio no tiene nada que mostrar. Va antes de
   * las rutas con :comprobanteId para que Nest no lea "evidencias" como id.
   */
  @Get('evidencias/faltantes')
  entregasSinEvidencia(
    @User() user: any,
    @Query() q: EntregasSinEvidenciaQueryDto,
  ) {
    return this.evidencias.entregasSinEvidencia(user.empresaId, q);
  }

  @Get('comprobante/:comprobanteId/evidencias')
  listarEvidencias(
    @User() user: any,
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
  ) {
    return this.evidencias.listar(comprobanteId, user.empresaId);
  }

  /**
   * Las fotos llegan ya convertidas a JPEG y reducidas por el navegador: el
   * repartidor sube desde la calle con datos móviles.
   */
  @Post('comprobante/:comprobanteId/evidencias')
  @UseInterceptors(FilesInterceptor('fotos', 6, evidenciaUploadOptions))
  registrarEvidencias(
    @User() user: any,
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @UploadedFiles() fotos: Express.Multer.File[],
    @Body() dto: RegistrarEvidenciaDto,
  ) {
    if (!fotos?.length) {
      throw new BadRequestException('No se adjuntó ninguna foto.');
    }
    return this.evidencias.registrar(
      comprobanteId,
      user.empresaId,
      fotos,
      dto,
      { id: user.sub ?? user.id, nombre: user.nombre, rol: user.rol },
    );
  }

  @Delete('evidencias/:id')
  anularEvidencia(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.evidencias.anular(id, user.empresaId, {
      id: user.sub ?? user.id,
      nombre: user.nombre,
      rol: user.rol,
    });
  }

  @Get()
  listAll(
    @User() user: any,
    @Query('estado') estado?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listByEmpresa(user.empresaId, {
      estado,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('config')
  getConfig(@User() user: any) {
    return this.service.getConfig(user.empresaId);
  }

  @Put('config')
  upsertConfig(@User() user: any, @Body() dto: DespachoConfigDto) {
    return this.service.upsertConfig(user.empresaId, dto);
  }

  // Activa/desactiva el rastreo automático Shalom (cron 30 min) para la empresa.
  @Patch('auto-tracking')
  setAutoTracking(@User() user: any, @Body() body: { activo: boolean }) {
    return this.service.setAutoTracking(user.empresaId, Boolean(body?.activo));
  }

  @Get('panel')
  panel(
    @User() user: any,
    @Query('fecha') fecha?: string,
    @Query('fechaEnvio') fechaEnvio?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.panelUnificado(user.empresaId, {
      fecha,
      fechaEnvio,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 100,
    });
  }

  /**
   * Reparto propio / motorizado: Excel con la plantilla de carga masiva del
   * courier de última milla (hoja PEDIDOS) + detalle interno + resumen para
   * estadísticas. Se filtra por fecha de entrega programada (o rango), sede
   * de origen del comprobante y repartidor.
   */
  @Get('reparto/exportar')
  async exportarReparto(
    @User() user: any,
    @Query() query: ExportarRepartoQueryDto,
    @Res() res: Response,
  ) {
    const { buffer, nombreArchivo } = await this.service.exportarReparto(
      user.empresaId,
      query,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${nombreArchivo}`,
    );
    res.status(200).send(buffer);
  }

  /** Resumen del reparto propio (mismos filtros que el export) para el panel. */
  @Get('reparto/resumen')
  resumenReparto(@User() user: any, @Query() query: ExportarRepartoQueryDto) {
    return this.service.resumenReparto(user.empresaId, query);
  }

  @Get('comprobante/:comprobanteId')
  getByComprobante(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @User() user: any,
  ) {
    return this.service.getByComprobante(comprobanteId, user.empresaId);
  }

  @Post('comprobante/:comprobanteId')
  create(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() dto: CreateEnvioDespachoDto,
    @User() user: any,
  ) {
    return this.service.create(
      comprobanteId,
      user.empresaId,
      dto,
      user.id ?? undefined,
    );
  }

  @Patch('comprobante/:comprobanteId/upsert')
  upsert(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() dto: CreateEnvioDespachoDto,
    @User() user: any,
  ) {
    return this.service.upsert(
      comprobanteId,
      user.empresaId,
      dto,
      user.id ?? undefined,
    );
  }

  @Put('comprobante/:comprobanteId')
  update(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() dto: UpdateEnvioDespachoDto,
    @User() user: any,
  ) {
    return this.service.update(
      comprobanteId,
      user.empresaId,
      dto,
      user.id ?? undefined,
    );
  }

  @Patch('comprobante/:comprobanteId/confirmar-pago')
  confirmarPago(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @User() user: any,
  ) {
    return this.service.confirmarPago(comprobanteId, user.empresaId);
  }

  @Patch('comprobante/:comprobanteId/actualizar-saldo')
  actualizarSaldo(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() body: ActualizarSaldoDto,
    @User() user: any,
  ) {
    return this.service.actualizarSaldo(
      comprobanteId,
      user.empresaId,
      body.saldo,
    );
  }

  @Delete('comprobante/:comprobanteId')
  remove(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @User() user: any,
  ) {
    return this.service.remove(comprobanteId, user.empresaId);
  }
}
