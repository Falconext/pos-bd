import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ComprobanteService } from './comprobante.service';
import { EnviarSunatService } from './enviar-sunat.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import type { Response } from 'express';
import { ListComprobanteDto } from './dto/list-comprobante.dto';
import { CrearComprobanteDto } from './dto/crear-comprobante.dto';
import { EmpresaService } from '../empresa/empresa.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('comprobante')
export class ComprobanteController {
  constructor(
    private readonly service: ComprobanteService,
    private readonly enviarSunat: EnviarSunatService,
    private readonly empresaService: EmpresaService,
  ) { }

  @Get('tipo-operacion')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listarTipoOperacion() {
    return this.service.listarTipoOperacion();
  }

  @Get('tipos-detraccion')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listarTiposDetraccion() {
    return this.service.listarTiposDetraccion();
  }

  @Get('medios-pago-detraccion')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listarMediosPagoDetraccion() {
    return this.service.listarMediosPagoDetraccion();
  }

  /**
   * Obtiene las estadísticas de uso de comprobantes SUNAT del mes actual
   */
  @Get('usage')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async getUsageStats(@User() user: any) {
    return this.service.getUsageStats(user.empresaId);
  }

  /**
   * Obtiene las estadísticas de uso de una empresa específica (solo ADMIN_SISTEMA)
   */
  @Get('usage/:empresaId')
  @Roles('ADMIN_SISTEMA')
  async getUsageStatsForEmpresa(@Param('empresaId', ParseIntPipe) empresaId: number) {
    return this.service.getUsageStats(empresaId);
  }

  @Get('listar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listar(
    @User() user: any,
    @Query() query: ListComprobanteDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (
      !query.tipoComprobante ||
      !['FORMAL', 'INFORMAL', 'COTIZACION', 'TODOS'].includes(query.tipoComprobante)
    ) {
      throw new BadRequestException(
        'El parámetro tipoComprobante debe ser FORMAL, INFORMAL, COTIZACION o TODOS',
      );
    }
    const resultado = await this.service.listar({
      empresaId: user.empresaId,
      tipoComprobante: query.tipoComprobante,
      search: query.search,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      fechaInicio: query.fechaInicio,
      fechaFin: query.fechaFin,
      estado: query.estado as any,
      tipoDoc: query.tipoDoc,
    });
    res.locals.message = 'Comprobantes listados correctamente';
    return resultado;
  }

  // Alternativa con path params para evitar errores de parseo en query de fechas, etc.
  @Get('empresa/:empresaId/listar/:tipoComprobante')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listarPath(
    @Param('empresaId') empresaIdParam: string,
    @Param('tipoComprobante') tipoComprobante: 'FORMAL' | 'INFORMAL',
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: 'asc' | 'desc',
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('estado') estado?: string,
    @Query('tipoDoc') tipoDoc?: string,
  ) {
    const empresaId = Number(empresaIdParam);
    if (!empresaId || Number.isNaN(empresaId))
      throw new BadRequestException('empresaId inválido');
    if (!['FORMAL', 'INFORMAL'].includes(tipoComprobante))
      throw new BadRequestException('tipoComprobante inválido');
    return this.service.listar({
      empresaId,
      tipoComprobante,
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
      sort: sort || 'fechaEmision',
      order: order || 'desc',
      fechaInicio,
      fechaFin,
      estado: estado as any,
      tipoDoc,
    });
  }

  // Alternativa con path params
  @Get('empresa/:empresaId/siguiente-correlativo/:tipoDoc')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async siguienteCorrelativoPath(
    @Param('empresaId') empresaIdParam: string,
    @Param('tipoDoc') tipoDoc: string,
    @Query('tipDocAfectado') tipDocAfectado?: string,
  ) {
    const empresaId = Number(empresaIdParam);
    if (!empresaId || Number.isNaN(empresaId))
      throw new BadRequestException('empresaId inválido');
    return this.service.siguienteCorrelativo(
      empresaId,
      tipoDoc,
      tipDocAfectado,
    );
  }

  @Get('detalle')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async detalle(
    @User() user: any,
    @Query('serie') serie: string,
    @Query('correlativo') correlativoRaw: string,
  ) {
    const correlativo = Number(correlativoRaw);
    if (!serie || Number.isNaN(correlativo))
      throw new BadRequestException('Serie y correlativo son requeridos');
    return this.service.detalle(user.empresaId, serie, correlativo);
  }

  // Alternativa con path params
  @Get('empresa/:empresaId/detalle/:serie/:correlativo')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async detallePath(
    @Param('empresaId') empresaIdParam: string,
    @Param('serie') serie: string,
    @Param('correlativo') correlativoParam: string,
  ) {
    const empresaId = Number(empresaIdParam);
    const correlativo = Number(correlativoParam);
    if (!empresaId || Number.isNaN(empresaId))
      throw new BadRequestException('empresaId inválido');
    if (!serie || Number.isNaN(correlativo))
      throw new BadRequestException('Serie y correlativo son requeridos');
    return this.service.detalle(empresaId, serie, correlativo);
  }

  @Get(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerPorId(@Param('id', ParseIntPipe) id: number, @User() user: any) {
    return this.service.obtenerPorId(user.empresaId, id);
  }

  // Estado y pagos
  @Patch(':comprobanteId/anular')
  @Roles('ADMIN_EMPRESA')
  async anularComprobante(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
  ) {
    return this.service.anularComprobante(comprobanteId);
  }

  @Patch(':comprobanteId/completar-pago')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async completarPago(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() input: any,
    @User() user: any,
  ) {
    // Soporta pagos parciales para: OT (Orden de Trabajo), NP (Nota de Pedido), NV (Nota de Venta), TICKET
    return this.service.completarPagoOT(
      comprobanteId,
      input,
      user.id,
      user.empresaId,
    );
  }

  @Patch(':comprobanteId/ot-estado')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizarEstadoOT(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() input: { estadoOT: string; fechaRecojo?: string },
  ) {
    return this.service.actualizarEstadoOT(comprobanteId, input);
  }

  // Crear endpoints (stubs: la lógica completa de emitir + enviar SUNAT se implementa en una segunda fase)
  @Post('boleta')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crearBoleta(@User() user: any, @Body() dto: CrearComprobanteDto) {
    try {
      console.log('[crearBoleta] Starting - empresaId:', user.empresaId, 'dto:', JSON.stringify(dto));
      const empresa = await this.empresaService.obtenerMiEmpresa(user.empresaId);
      if (!empresa.providerToken || !empresa.providerId) {
        throw new ForbiddenException(
          'Aún no cuenta con permisos para generar comprobantes para SUNAT, contacte con el soporte de falconext',
        );
      }
      console.log('[crearBoleta] Creating comprobante...');
      const comp = await this.service.crearFormal(dto, user.empresaId, '03', user.id);
      console.log('[crearBoleta] Comprobante created:', comp.id, '- Sending to SUNAT...');
      const sunatResp = await this.enviarSunat.execute(comp.id);
      console.log('[crearBoleta] SUNAT response:', JSON.stringify(sunatResp));
      return sunatResp;
    } catch (error: any) {
      console.error('[crearBoleta] ERROR:', error.message, error.stack);
      throw error;
    }
  }
  @Post('factura')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crearFactura(@User() user: any, @Body() dto: CrearComprobanteDto) {
    try {
      console.log('[crearFactura] Starting - empresaId:', user.empresaId, 'dto:', JSON.stringify(dto));
      const empresa = await this.empresaService.obtenerMiEmpresa(user.empresaId);
      if (!empresa.providerToken || !empresa.providerId) {
        throw new ForbiddenException(
          'Aún no cuenta con permisos para generar comprobantes para SUNAT, contacte con el soporte de falconext',
        );
      }
      console.log('[crearFactura] Creating comprobante...');
      const comp = await this.service.crearFormal(dto, user.empresaId, '01', user.id);
      console.log('[crearFactura] Comprobante created:', comp.id, '- Sending to SUNAT...');
      const sunatResp = await this.enviarSunat.execute(comp.id);
      console.log('[crearFactura] SUNAT response:', JSON.stringify(sunatResp));
      return sunatResp;
    } catch (error: any) {
      console.error('[crearFactura] ERROR:', error.message, error.stack);
      throw error;
    }
  }
  @Post('nota-credito')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crearNotaCredito(@User() user: any, @Body() dto: CrearComprobanteDto) {
    try {
      console.log('[crearNotaCredito] Starting - empresaId:', user.empresaId);
      const empresa = await this.empresaService.obtenerMiEmpresa(user.empresaId);
      if (!empresa.providerToken || !empresa.providerId) {
        throw new ForbiddenException(
          'Aún no cuenta con permisos para generar comprobantes para SUNAT, contacte con el soporte de falconext',
        );
      }
      const comp = await this.service.crearFormal(dto, user.empresaId, '07', user.id);
      const sunatResp = await this.enviarSunat.execute(comp.id);
      return sunatResp;
    } catch (error: any) {
      console.error('[crearNotaCredito] ERROR:', error.message, error.stack);
      throw error;
    }
  }
  @Post('nota-debito')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crearNotaDebito(@User() user: any, @Body() dto: CrearComprobanteDto) {
    try {
      console.log('[crearNotaDebito] Starting - empresaId:', user.empresaId);
      const empresa = await this.empresaService.obtenerMiEmpresa(user.empresaId);
      if (!empresa.providerToken || !empresa.providerId) {
        throw new ForbiddenException(
          'Aún no cuenta con permisos para generar comprobantes para SUNAT, contacte con el soporte de falconext',
        );
      }
      const comp = await this.service.crearFormal(dto, user.empresaId, '08', user.id);
      const sunatResp = await this.enviarSunat.execute(comp.id);
      return sunatResp;
    } catch (error: any) {
      console.error('[crearNotaDebito] ERROR:', error.message, error.stack);
      throw error;
    }
  }
  @Post('informal')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crearComprobanteInformal(
    @User() user: any,
    @Body() dto: CrearComprobanteDto,
  ) {
    const comp = await this.service.crearInformal(dto, user.empresaId, user.id);
    return comp;
  }

  @Post('ot')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crearOT(@User() user: any, @Body() dto: any) {
    return this.service.crearOT(dto, user.empresaId, user.id);
  }

  // Enviar comprobante existente a SUNAT
  @Post(':id/enviar-sunat')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async enviarASunat(@Param('id', ParseIntPipe) id: number) {
    return this.enviarSunat.execute(id);
  }

  @Post(':id/debug-xml')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async debugXml(@Param('id', ParseIntPipe) id: number) {
    return this.enviarSunat.debugPayload(id);
  }

  // ========================
  // DEBUG: Simulate SUNAT failure for testing retry logic
  // ========================

  @Post('debug/simulate-sunat-failure')
  @Roles('ADMIN_SISTEMA')
  async activarSimulacionFallo() {
    this.enviarSunat.simulateSunatFailure = true;
    return {
      message: '⚠️ Modo simulación ACTIVADO: Los siguientes envíos a SUNAT fallarán intencionalmente',
      simulateSunatFailure: true,
    };
  }

  @Post('debug/disable-simulation')
  @Roles('ADMIN_SISTEMA')
  async desactivarSimulacion() {
    this.enviarSunat.simulateSunatFailure = false;
    return {
      message: '✅ Modo simulación DESACTIVADO: Envíos a SUNAT funcionarán normalmente',
      simulateSunatFailure: false,
    };
  }

  @Get('debug/simulation-status')
  @Roles('ADMIN_SISTEMA')
  async estadoSimulacion() {
    return {
      simulateSunatFailure: this.enviarSunat.simulateSunatFailure,
      message: this.enviarSunat.simulateSunatFailure
        ? '⚠️ Modo simulación ACTIVO: Los envíos fallarán intencionalmente'
        : '✅ Modo normal: Envíos funcionando correctamente',
    };
  }

  @Get('debug/fallidos')
  @Roles('ADMIN_SISTEMA')
  async listarFallidos() {
    // Usado para testing: ver qué comprobantes están marcados para reintento
    // (Requiere inyectar PrismaService al controller, por simplicidad lo haremos vía service)
    return { message: 'Usa la query SQL: SELECT * FROM "Comprobante" WHERE "estadoEnvioSunat" = \'FALLIDO_ENVIO\'' };
  }

}

