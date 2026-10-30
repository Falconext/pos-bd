import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { ChatWebService } from './chat-web.service';

/**
 * Chat de la tienda online: público, como el resto de `public/store`. La
 * sesión la genera el navegador y es lo único que identifica al cliente.
 */
@Controller('public/store')
export class ChatWebController {
  constructor(private readonly chat: ChatWebService) {}

  @Post(':slug/chat')
  enviar(
    @Param('slug') slug: string,
    @Body() body: { sesion?: string; texto?: string; productoId?: number; nombre?: string },
    @Ip() ip: string,
  ) {
    return this.chat.enviar(slug, body, ip);
  }

  @Get(':slug/chat')
  mensajes(@Param('slug') slug: string, @Query('sesion') sesion: string) {
    return this.chat.mensajes(slug, sesion);
  }
}
