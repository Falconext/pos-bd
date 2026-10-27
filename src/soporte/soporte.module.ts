import { Module } from '@nestjs/common';
import { SoporteController } from './soporte.controller';
import { SoporteService } from './soporte.service';
import { SoporteBotService } from './soporte-bot.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { GeminiModule } from '../gemini/gemini.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, NotificacionesModule, GeminiModule, WhatsAppModule],
  controllers: [SoporteController],
  providers: [SoporteService, SoporteBotService],
})
export class SoporteModule {}
