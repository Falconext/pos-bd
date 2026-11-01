import { BadRequestException, Body, Controller, Delete, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { TiktokService } from './tiktok.service';

/**
 * A dónde puede volver el login de TikTok: la URL tiene que estar registrada
 * en la app de TikTok y además se valida acá. TIKTOK_REDIRECT_URIS (separadas
 * por coma); sin configurar, solo la del panel.
 */
export function redirectTiktokPermitido(uri: string): boolean {
  const lista = String(process.env.TIKTOK_REDIRECT_URIS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lista.length) return lista.includes(uri);
  return /^https?:\/\/[^/]+\/administrador\/tiktok\/callback$/.test(uri);
}

@Controller('tiktok')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TiktokController {
  constructor(private readonly tiktok: TiktokService) {}

  @Get('estado')
  @Roles('ADMIN_EMPRESA')
  estado(@User() user: any) {
    return this.tiktok.estado(user.empresaId);
  }

  @Get('autorizar')
  @Roles('ADMIN_EMPRESA')
  autorizar(@Query('redirectUri') redirectUri: string, @Query('state') state: string) {
    if (!redirectUri || !redirectTiktokPermitido(redirectUri)) throw new BadRequestException('Dirección de retorno no permitida.');
    return { url: this.tiktok.urlDeAutorizacion(redirectUri, String(state || '')) };
  }

  @Post('conectar')
  @Roles('ADMIN_EMPRESA')
  conectar(@User() user: any, @Body() body: { code?: string; redirectUri?: string }) {
    if (!body?.code) throw new BadRequestException('Falta el código de TikTok.');
    if (!body.redirectUri || !redirectTiktokPermitido(body.redirectUri)) throw new BadRequestException('Dirección de retorno no permitida.');
    return this.tiktok.conectar(user.empresaId, body.code, body.redirectUri);
  }

  /** Responder con la IA los comentarios de los videos. */
  @Put('comentarios')
  @Roles('ADMIN_EMPRESA')
  comentarios(@User() user: any, @Body() body: { activo?: boolean; clave?: string | null; whatsapp?: string | null }) {
    return this.tiktok.configurarComentarios(user.empresaId, Boolean(body?.activo), body?.clave ?? null, body?.whatsapp);
  }

  @Delete()
  @Roles('ADMIN_EMPRESA')
  desconectar(@User() user: any) {
    return this.tiktok.desconectar(user.empresaId);
  }
}
