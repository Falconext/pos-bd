import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { CobroEmpresaService } from './cobro-empresa.service';
import { MpSuscripcionService } from './mp-suscripcion.service';
import {
  RegistrarPagoCobroDto,
  RegistrarPagoHistoricoDto,
} from './dto/registrar-pago-cobro.dto';

/**
 * Las mensualidades de los clientes directos. Todo lo que toca plata o el
 * estado de una cuenta es solo de ADMIN_SISTEMA; el empresario únicamente puede
 * mirar la suya.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('suscripcion/cobros')
export class CobroEmpresaController {
  constructor(
    private readonly service: CobroEmpresaService,
    private readonly mp: MpSuscripcionService,
  ) {}

  @Get()
  @Roles('ADMIN_SISTEMA')
  async listar(
    @Query('estado') estado?: string,
    @Query('empresaId') empresaId?: string,
    @Query('periodo') periodo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listar({
      estado,
      periodo,
      empresaId: empresaId ? Number(empresaId) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('resumen')
  @Roles('ADMIN_SISTEMA')
  async resumen(@Query('periodo') periodo?: string) {
    return this.service.resumen(periodo);
  }

  /** Lo que ve el empresario: su vencimiento, si está en gracia y qué debe. */
  @Get('mi-estado')
  @Roles('ADMIN_EMPRESA')
  async miEstado(@User() user: any) {
    return this.service.estadoDeMiSuscripcion(user.empresaId);
  }

  // ── Débito automático (Mercado Pago) ─────────────────────────────────

  /** Cómo está su cobro automático: si se puede activar y si está activo. */
  @Get('cobro-automatico')
  @Roles('ADMIN_EMPRESA')
  async estadoCobroAutomatico(@User() user: any) {
    return this.mp.estadoDeMiCobroAutomatico(user.empresaId);
  }

  /**
   * Devuelve el enlace de Mercado Pago donde autoriza el débito. No activa
   * nada: se activa cuando MP avisa que quedó autorizado.
   */
  @Post('cobro-automatico/activar')
  @Roles('ADMIN_EMPRESA')
  async activarCobroAutomatico(@User() user: any) {
    return this.mp.crearSuscripcion(user.empresaId);
  }

  @Post('cobro-automatico/cancelar')
  @Roles('ADMIN_EMPRESA')
  async cancelarCobroAutomatico(@User() user: any) {
    return this.mp.cancelar(user.empresaId);
  }

  /** Sus propios pagos. El id sale del token, no de la URL. */
  @Get('mi-historial')
  @Roles('ADMIN_EMPRESA')
  async miHistorial(@User() user: any) {
    return this.service.historialDeMiEmpresa(user.empresaId);
  }

  @Post('generar')
  @Roles('ADMIN_SISTEMA')
  async generar() {
    return this.service.generarCobrosDelCiclo();
  }

  @Post('procesar-vencidos')
  @Roles('ADMIN_SISTEMA')
  async procesarVencidos() {
    return this.service.procesarVencidos();
  }

  /**
   * Carga un pago de un mes ya pasado. No mueve el vencimiento: ese mes ya se
   * consumió, y extenderlo regalaría meses.
   */
  @Post('historico')
  @Roles('ADMIN_SISTEMA')
  async registrarHistorico(@Body() dto: RegistrarPagoHistoricoDto) {
    return this.service.registrarPagoHistorico({
      empresaId: dto.empresaId,
      periodo: dto.periodo,
      monto: dto.monto,
      fechaCobro: new Date(dto.fechaCobro),
      medioPago: dto.medioPago,
      referencia: dto.referencia,
    });
  }

  @Post(':id/registrar-pago')
  @Roles('ADMIN_SISTEMA')
  async registrarPago(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() dto: RegistrarPagoCobroDto,
  ) {
    return this.service.registrarPago(id, {
      medioPago: dto.medioPago,
      referencia: dto.referencia,
      monto: dto.monto,
      fechaCobro: dto.fechaCobro ? new Date(dto.fechaCobro) : undefined,
      usuarioId: user.id,
    });
  }
}
