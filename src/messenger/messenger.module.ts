import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { MessengerService } from './messenger.service';
import { MessengerController } from './messenger.controller';

@Module({
  imports: [PrismaModule, NotificacionesModule],
  controllers: [MessengerController],
  providers: [MessengerService],
  exports: [MessengerService],
})
export class MessengerModule {}
