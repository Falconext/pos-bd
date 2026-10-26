import { BadRequestException, Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { MessengerService } from './messenger.service';

/**
 * A dónde puede volver el login de Facebook. Igual que en Instagram: lista en
 * MESSENGER_REDIRECT_URIS (separadas por coma) o, sin configurar, solo la
 * ruta del panel.
 */
export function redirectPermitidoMessenger(uri: string): boolean {
  const lista = String(process.env.MESSENGER_REDIRECT_URIS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lista.length) return lista.includes(uri);
  return /^https?:\/\/[^/]+\/administrador\/messenger\/callback$/.test(uri);
}

@Controller('messenger')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MessengerController {
  constructor(private readonly messenger: MessengerService) {}

  @Get('estado')
  @Roles('ADMIN_EMPRESA')
  estado(@User() user: any) {
    return this.messenger.estado(user.empresaId);
  }

  @Get('autorizar')
  @Roles('ADMIN_EMPRESA')
  autorizar(@Query('redirectUri') redirectUri: string, @Query('state') state: string) {
    if (!redirectUri || !redirectPermitidoMessenger(redirectUri)) throw new BadRequestException('Dirección de retorno no permitida.');
    return { url: this.messenger.urlDeAutorizacion(redirectUri, String(state || '')) };
  }

  @Post('conectar')
  @Roles('ADMIN_EMPRESA')
  conectar(@User() user: any, @Body() body: { code?: string; redirectUri?: string }) {
    if (!body?.code) throw new BadRequestException('Falta el código de Facebook.');
    if (!body.redirectUri || !redirectPermitidoMessenger(body.redirectUri)) throw new BadRequestException('Dirección de retorno no permitida.');
    return this.messenger.conectar(user.empresaId, body.code, body.redirectUri);
  }

  @Post('pagina')
  @Roles('ADMIN_EMPRESA')
  elegirPagina(@User() user: any, @Body() body: { seleccion?: string; pageId?: string }) {
    if (!body?.seleccion || !body?.pageId) throw new BadRequestException('Falta la página.');
    return this.messenger.elegirPagina(user.empresaId, body.seleccion, body.pageId);
  }

  @Delete()
  @Roles('ADMIN_EMPRESA')
  desconectar(@User() user: any) {
    return this.messenger.desconectar(user.empresaId);
  }
}
