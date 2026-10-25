import { BadRequestException, Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { InstagramService } from './instagram.service';

/**
 * A dónde puede volver el login de Instagram. Meta exige que la URL esté
 * registrada en la app; además se valida acá para que nadie use la plataforma
 * de rebote hacia otro sitio. Se configura con INSTAGRAM_REDIRECT_URIS
 * (separadas por coma); sin configurar, solo se aceptan las del panel.
 */
export function redirectPermitido(uri: string): boolean {
  const lista = String(process.env.INSTAGRAM_REDIRECT_URIS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lista.length) return lista.includes(uri);
  return /^https?:\/\/[^/]+\/administrador\/instagram\/callback$/.test(uri);
}

@Controller('instagram')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InstagramController {
  constructor(private readonly instagram: InstagramService) {}

  @Get('estado')
  @Roles('ADMIN_EMPRESA')
  estado(@User() user: any) {
    return this.instagram.estado(user.empresaId);
  }

  @Get('autorizar')
  @Roles('ADMIN_EMPRESA')
  autorizar(@Query('redirectUri') redirectUri: string, @Query('state') state: string) {
    if (!redirectUri || !redirectPermitido(redirectUri)) throw new BadRequestException('Dirección de retorno no permitida.');
    return { url: this.instagram.urlDeAutorizacion(redirectUri, String(state || '')) };
  }

  @Post('conectar')
  @Roles('ADMIN_EMPRESA')
  conectar(@User() user: any, @Body() body: { code?: string; redirectUri?: string }) {
    if (!body?.code) throw new BadRequestException('Falta el código de Instagram.');
    if (!body.redirectUri || !redirectPermitido(body.redirectUri)) throw new BadRequestException('Dirección de retorno no permitida.');
    return this.instagram.conectar(user.empresaId, body.code, body.redirectUri);
  }

  @Delete()
  @Roles('ADMIN_EMPRESA')
  desconectar(@User() user: any) {
    return this.instagram.desconectar(user.empresaId);
  }
}
