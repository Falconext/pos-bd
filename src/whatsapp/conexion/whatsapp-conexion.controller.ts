import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../common/decorators/user.decorator';
import { HEADER_SECRETO_WEBHOOK } from '../evolution';
import { WhatsappConexionService } from './whatsapp-conexion.service';

function empresaDe(user: any): number {
  if (!user?.empresaId)
    throw new BadRequestException('No hay empresa en la sesión.');
  return user.empresaId;
}

/** "Conectar mi WhatsApp" por QR (Evolution API). La empresa sale del token. */
@Controller('whatsapp/conexion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsappConexionController {
  constructor(private readonly conexion: WhatsappConexionService) {}

  @Get()
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  estado(@User() user: any) {
    return this.conexion.estado(empresaDe(user));
  }

  @Post()
  @HttpCode(200)
  @Roles('ADMIN_EMPRESA')
  conectar(@User() user: any, @Body() body: { numero?: string }) {
    return this.conexion.conectar(empresaDe(user), body?.numero);
  }

  @Get('qr')
  @Roles('ADMIN_EMPRESA')
  qr(@User() user: any) {
    return this.conexion.qr(empresaDe(user));
  }

  @Post('prueba')
  @HttpCode(200)
  @Roles('ADMIN_EMPRESA')
  probar(@User() user: any, @Body() body: { numero?: string }) {
    return this.conexion.probar(empresaDe(user), user?.id, body?.numero);
  }

  @Patch()
  @Roles('ADMIN_EMPRESA')
  configurar(@User() user: any, @Body() body: { enviarComprobante?: boolean }) {
    return this.conexion.configurar(empresaDe(user), body ?? {});
  }

  @Delete()
  @Roles('ADMIN_EMPRESA')
  desconectar(@User() user: any) {
    return this.conexion.desconectar(empresaDe(user));
  }
}

/** Eventos de Evolution (público; autenticado con EVOLUTION_WEBHOOK_SECRET en un header). */
@Controller('whatsapp/evolution')
export class EvolutionWebhookController {
  constructor(private readonly conexion: WhatsappConexionService) {}

  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Headers(HEADER_SECRETO_WEBHOOK) secreto: string | undefined,
    @Body() body: unknown,
  ) {
    return this.conexion.webhook(secreto, body);
  }
}
