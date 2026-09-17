import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { CatalogoMovilService } from './catalogo-movil.service';
import { OperacionesMovilService } from './operaciones-movil.service';
import {
  DescartarOperacionDto,
  SyncOperacionesDto,
} from './dto/sync-movil.dto';

/**
 * Sincronización de la app móvil en modo offline-first (plan Fase 1).
 * Distinto de `/sync/backup` (modo informal sin cuenta): aquí la empresa es
 * Premium y las operaciones pasan por los servicios reales de venta/caja.
 */
@Controller('sync')
export class SyncMovilController {
  constructor(
    private readonly catalogo: CatalogoMovilService,
    private readonly operaciones: OperacionesMovilService,
  ) {}

  /**
   * GET /api/sync/catalogo?sedeId=10
   * Snapshot del catálogo para SQLite. Con `If-None-Match: <version>` responde
   * 304 si nada cambió (la app lo pide al abrir, al volver a primer plano y
   * al terminar de sincronizar).
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @Get('catalogo')
  async catalogoMovil(
    @User() user: any,
    @Query('sedeId') sedeIdRaw: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Headers('x-dispositivo-id') dispositivoId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sedeId = sedeIdRaw ? Number(sedeIdRaw) : (user.sedeId ?? undefined);
    const data = await this.catalogo.construir(user.empresaId, sedeId || undefined);
    res.setHeader('ETag', `"${data.version}"`);
    res.setHeader('Cache-Control', 'private, no-cache');
    const previa = String(ifNoneMatch ?? '').replace(/"/g, '');
    if (previa && previa === data.version) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    await this.operaciones.marcarCatalogoDescargado(user, dispositivoId, data.version);
    return data;
  }

  /**
   * POST /api/sync/operaciones
   * Lote de operaciones offline (ventas informales, caja). Idempotente por uuid.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @Post('operaciones')
  @HttpCode(HttpStatus.OK)
  async operacionesMovil(
    @User() user: any,
    @Body() dto: SyncOperacionesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.operaciones.procesar(user, dto);
    const ok = r.resultados.filter((x) => x.estado === 'OK').length;
    res.locals.message = `${ok}/${r.resultados.length} operaciones sincronizadas`;
    return r;
  }

  /** POST /api/sync/operaciones/descartar — auditoría de una operación que no se pudo aplicar. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @Post('operaciones/descartar')
  @HttpCode(HttpStatus.OK)
  async descartar(@User() user: any, @Body() dto: DescartarOperacionDto) {
    return this.operaciones.descartar(user, dto);
  }

  /** GET /api/sync/estado — dispositivos y últimas operaciones de la empresa (soporte). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('estado')
  async estado(@User() user: any, @Req() _req: Request) {
    return this.operaciones.estado(user.empresaId);
  }
}
