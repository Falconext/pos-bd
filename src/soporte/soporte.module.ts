import { Module } from '@nestjs/common';
import { SoporteController } from './soporte.controller';
import { SoporteService } from './soporte.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [PrismaModule, NotificacionesModule],
  controllers: [SoporteController],
  providers: [SoporteService],
})
export class SoporteModule {}
