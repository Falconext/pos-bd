import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { GeminiModule } from '../gemini/gemini.module';
import { TiktokService } from './tiktok.service';
import { TiktokController } from './tiktok.controller';

@Module({
  imports: [PrismaModule, NotificacionesModule, GeminiModule],
  controllers: [TiktokController],
  providers: [TiktokService],
})
export class TiktokModule {}
