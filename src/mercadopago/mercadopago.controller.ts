import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { MercadoPagoService } from './mercadopago.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';

@Controller('mercadopago')
export class MercadoPagoController {
  constructor(private readonly mp: MercadoPagoService) {}

  // Estado de conexión (panel admin de la empresa)
  @Get('estado')
  @UseGuards(JwtAuthGuard)
  estado(@User() user: any) {
    return this.mp.estado(user.empresaId);
  }

  // Devuelve la URL de autorización para conectar la cuenta MP de la empresa
  @Get('oauth/connect')
  @UseGuards(JwtAuthGuard)
  connect(@User() user: any) {
    return { url: this.mp.getConnectUrl(user.empresaId) };
  }

  // Callback público al que Mercado Pago redirige tras autorizar
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      await this.mp.handleCallback(code, state);
      return res.redirect(this.mp.frontendReturnUrl(true));
    } catch {
      return res.redirect(this.mp.frontendReturnUrl(false));
    }
  }

  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  disconnect(@User() user: any) {
    return this.mp.disconnect(user.empresaId);
  }

  // Webhook público de notificaciones de pago. Siempre responde 200.
  @Post('webhook')
  async webhook(
    @Query() query: any,
    @Body() body: any,
    @Headers('x-signature') xSignature?: string,
    @Headers('x-request-id') xRequestId?: string,
  ) {
    await this.mp.handleWebhook(query, body, { xSignature, xRequestId });
    return { received: true };
  }
}
