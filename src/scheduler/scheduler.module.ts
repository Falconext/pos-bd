import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { VerificarPendientesSunatService } from './services/verificar-pendientes-sunat.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ComprobanteModule } from '../comprobante/comprobante.module';
import { ResellerModule } from '../reseller/reseller.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    NotificacionesModule,
    forwardRef(() => ComprobanteModule),
    ResellerModule,
    S3Module,
  ],
  providers: [SchedulerService, VerificarPendientesSunatService, PrismaService],
  exports: [VerificarPendientesSunatService],
})
export class SchedulerModule { }
