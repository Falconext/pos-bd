import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';
import { LeadsEmbudoService } from './leads-embudo.service';
import { LeadsBiService } from './leads-bi.service';
import { LeadsDisparadoresService } from './leads-disparadores.service';
import { EtapaCrm } from './leads-embudo';
import { MoverEtapaDto, RechazarPagoDto, RangoBiDto } from './dto/crm.dto';

/**
 * E — el CRM de la IA de ventas: embudo, BI y 360° por cliente.
 *
 * Va aparte del controlador de leads, que ya es grande, y porque son
 * responsabilidades distintas: uno atiende el chat, este da la vista de
 * gestión.
 */
@UseGuards(JwtAuthGuard)
@Controller('leads/crm')
export class LeadsCrmController {
  constructor(
    private readonly embudo: LeadsEmbudoService,
    private readonly analitica: LeadsBiService,
    private readonly disparadores: LeadsDisparadoresService,
  ) {}

  /** El tablero del embudo: las 12 columnas con sus pedidos. */
  @Get('embudo')
  tablero(@User() user: any, @Query('porEtapa') porEtapa?: string) {
    const limite = Math.min(Math.max(Number(porEtapa) || 20, 1), 100);
    return this.embudo.tablero(user.empresaId, limite);
  }

  /**
   * Mueve un pedido de etapa. Siempre con el usuario: este endpoint es el
   * clic de una persona, y es lo que habilita las etapas con candado.
   */
  @Patch('embudo/:prospectoId')
  mover(
    @User() user: any,
    @Param('prospectoId', ParseIntPipe) prospectoId: number,
    @Body() dto: MoverEtapaDto,
  ) {
    return this.embudo.mover(prospectoId, user.empresaId, dto.etapa as EtapaCrm, {
      usuario: { id: user.sub ?? user.id, nombre: user.nombre },
      nota: dto.nota,
    });
  }

  @Get('embudo/:prospectoId/historial')
  historial(
    @User() user: any,
    @Param('prospectoId', ParseIntPipe) prospectoId: number,
  ) {
    return this.embudo.historial(prospectoId, user.empresaId);
  }

  /** El candado de pago: "vi el voucher y está bien". */
  @Post('pagos/:pagoId/validar')
  validarPago(
    @User() user: any,
    @Param('pagoId', ParseIntPipe) pagoId: number,
    @Body() body: { pasarADespacho?: boolean },
  ) {
    return this.embudo.validarPago(
      pagoId,
      user.empresaId,
      { id: user.sub ?? user.id, nombre: user.nombre },
      body?.pasarADespacho !== false,
    );
  }

  @Post('pagos/:pagoId/rechazar')
  rechazarPago(
    @User() user: any,
    @Param('pagoId', ParseIntPipe) pagoId: number,
    @Body() dto: RechazarPagoDto,
  ) {
    return this.embudo.rechazarPago(
      pagoId,
      user.empresaId,
      { id: user.sub ?? user.id, nombre: user.nombre },
      dto.motivo,
    );
  }

  /** BI: productos y malestares más consultados, conversión, descuentos, demografía. */
  @Get('bi')
  reporteBi(@User() user: any, @Query() q: RangoBiDto) {
    return this.analitica.resumen(user.empresaId, q);
  }

  /** 360° por cliente. El teléfono es la llave: en WhatsApp no hay otra. */
  @Get('cliente/:telefono')
  cliente(@User() user: any, @Param('telefono') telefono: string) {
    return this.analitica.historial360(user.empresaId, telefono);
  }

  // ── F — disparadores y re-engagement ──────────────────────────────────

  /** Qué avisos están por salir, qué salió y cuántos pidieron la baja. */
  @Get('disparadores')
  disparos(
    @User() user: any,
    @Query('estado') estado?: string,
    @Query('tipo') tipo?: string,
  ) {
    return this.disparadores.listar(user.empresaId, { estado, tipo });
  }

  /** La configuración: cuáles están encendidos, demoras, horario y tope. */
  @Get('disparadores/config')
  configDisparos(@User() user: any) {
    return this.disparadores.configDe(user.empresaId);
  }

  /**
   * Manda un aviso ya, sin esperar al cron. Igual pasa por TODAS las reglas:
   * la baja, el horario, el tope y la disponibilidad del producto. El botón
   * no es una puerta trasera.
   */
  @Post('disparadores/:id/enviar')
  enviarDisparo(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.disparadores.procesarUno(id);
  }

  /** Dar de baja a un número a mano, cuando lo pide por teléfono. */
  @Post('disparadores/baja/:telefono')
  darDeBaja(@User() user: any, @Param('telefono') telefono: string) {
    return this.disparadores.registrarBaja(
      user.empresaId,
      telefono,
      'Baja registrada desde el panel',
    );
  }

  /**
   * 33.1 — un producto volvió: avisar a quien lo había pedido. Se dispara
   * desde el editor de producto al ponerlo disponible.
   */
  @Post('disparadores/producto/:productoId/volvio')
  productoVolvio(
    @User() user: any,
    @Param('productoId', ParseIntPipe) productoId: number,
  ) {
    return this.disparadores.avisarVueltaDeDisponibilidad(
      user.empresaId,
      productoId,
    );
  }

  /** Posibles duplicados por nombre parecido, para que una persona decida. */
  @Get('cliente/:telefono/posibles-duplicados')
  duplicados(@User() user: any, @Param('telefono') telefono: string) {
    return this.analitica.sugerenciasDeUnion(user.empresaId, telefono);
  }
}
