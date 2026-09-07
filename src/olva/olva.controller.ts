import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OlvaService } from './olva.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';
import {
  ConfigOlvaDto,
  CotizarOlvaDto,
  CrearGuiaOlvaDto,
  TrackOlvaDto,
} from './dto/olva.dto';

@UseGuards(JwtAuthGuard)
@Controller('olva')
export class OlvaController {
  constructor(private readonly service: OlvaService) {}

  // ─── Catálogo (todos los planes con el módulo) ────────────────────────────

  @Get('agencias')
  getAgencias(@User() user: any) {
    return this.service.getAgencias(user?.empresaId);
  }

  @Get('agencias/cercanas')
  agenciasCercanas(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('limit') limit: string | undefined,
  ) {
    return this.service.agenciasCercanas(
      Number(lat),
      Number(lng),
      limit ? Number(limit) : 5,
    );
  }

  @Get('ubigeos')
  ubigeos() {
    return this.service.ubigeos();
  }

  @Get('categorias')
  categorias() {
    return this.service.categoriasArticulo();
  }

  @Get('tamanos')
  tamanos() {
    return this.service.tamanosEstandar();
  }

  /** Datos de RENIEC/SUNAT que expone Olva para autocompletar destinatarios. */
  @Get('persona/:tipoDoc/:nroDoc')
  buscarPersona(
    @Param('tipoDoc') tipoDoc: string,
    @Param('nroDoc') nroDoc: string,
  ) {
    return this.service.buscarPersona(tipoDoc, nroDoc);
  }

  // ─── Rastreo ──────────────────────────────────────────────────────────────

  @Post('track')
  @HttpCode(200)
  track(
    @Body() body: TrackOlvaDto,
    @Query('refresh') refreshQuery: string | undefined,
    @User() user: any,
  ) {
    // Read-through cache: responde al instante desde el snapshot persistido y
    // solo golpea a Olva si está viejo (>10 min) o se pide `refresh`.
    const refresh = body?.refresh === true || refreshQuery === '1';
    return this.service.trackConCache(
      body.trackingNumber,
      body.year,
      user?.empresaId,
      refresh,
    );
  }

  @Post('cotizar')
  @HttpCode(200)
  cotizar(@Body() dto: CotizarOlvaDto) {
    return this.service.cotizar(dto);
  }

  // ─── Configuración de la empresa ──────────────────────────────────────────

  @Get('config')
  getConfig(@User() user: any) {
    return this.service.getConfig(user?.empresaId);
  }

  @Patch('config')
  actualizarConfig(@Body() dto: ConfigOlvaDto, @User() user: any) {
    return this.service.actualizarConfig(user.empresaId, dto);
  }

  // ─── Guías (plan Corporativo) ─────────────────────────────────────────────

  // Genera la guía en Olva desde el despacho del comprobante y guarda el N° de
  // guía devuelto (lo que el rastreo necesita después).
  @Post('guia/:comprobanteId')
  @HttpCode(200)
  crearGuia(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() dto: CrearGuiaOlvaDto,
    @User() user: any,
  ) {
    return this.service.crearGuiaDesdeDespacho(
      comprobanteId,
      user.empresaId,
      dto,
    );
  }
}
