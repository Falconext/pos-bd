import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { SuscripcionController } from './suscripcion.controller';
import { SuscripcionService } from './suscripcion.service';
import { CobroEmpresaController } from './cobro-empresa.controller';
import { CobroEmpresaService } from './cobro-empresa.service';
import { MpSuscripcionService } from './mp-suscripcion.service';
import { FinDePruebaService } from './fin-de-prueba.service';
import { ComprobanteModule } from '../comprobante/comprobante.module';

@Module({
  imports: [PrismaModule, NotificacionesModule, forwardRef(() => ComprobanteModule)],
  controllers: [SuscripcionController, CobroEmpresaController],
  providers: [SuscripcionService, CobroEmpresaService, MpSuscripcionService, FinDePruebaService],
  exports: [CobroEmpresaService, MpSuscripcionService],
})
export class SuscripcionModule {}
