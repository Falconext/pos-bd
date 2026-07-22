import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { VerificarPendientesSunatService } from './services/verificar-pendientes-sunat.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ComprobanteModule } from '../comprobante/comprobante.module';
import { ResellerModule } from '../reseller/reseller.module';
import { S3Module } from '../s3/s3.module';
import { GuiaRemisionModule } from '../guia-remision/guia-remision.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    NotificacionesModule,
    forwardRef(() => ComprobanteModule),
    forwardRef(() => GuiaRemisionModule),
    ResellerModule,
    S3Module,
    WhatsAppModule,
  ],
  providers: [SchedulerService, VerificarPendientesSunatService, PrismaService],
  exports: [VerificarPendientesSunatService],
})
export class SchedulerModule {}
