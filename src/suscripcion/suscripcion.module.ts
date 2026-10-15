import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { SuscripcionController } from './suscripcion.controller';
import { SuscripcionService } from './suscripcion.service';
import { CobroEmpresaController } from './cobro-empresa.controller';
import { CobroEmpresaService } from './cobro-empresa.service';
import { MpSuscripcionService } from './mp-suscripcion.service';

@Module({
  imports: [PrismaModule, NotificacionesModule],
  controllers: [SuscripcionController, CobroEmpresaController],
  providers: [SuscripcionService, CobroEmpresaService, MpSuscripcionService],
  exports: [CobroEmpresaService, MpSuscripcionService],
})
export class SuscripcionModule {}
