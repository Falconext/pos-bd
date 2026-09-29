import { Module } from '@nestjs/common';
import { SoporteController } from './soporte.controller';
import { SoporteService } from './soporte.service';
import { SoporteBotService } from './soporte-bot.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [PrismaModule, NotificacionesModule, GeminiModule],
  controllers: [SoporteController],
  providers: [SoporteService, SoporteBotService],
})
export class SoporteModule {}
