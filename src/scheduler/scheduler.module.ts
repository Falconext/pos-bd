import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { VerificarPendientesSunatService } from './services/verificar-pendientes-sunat.service';
import { VerificarEnviosShalomService } from './services/verificar-envios-shalom.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ComprobanteModule } from '../comprobante/comprobante.module';
import { ResellerModule } from '../reseller/reseller.module';
import { S3Module } from '../s3/s3.module';
import { GuiaRemisionModule } from '../guia-remision/guia-remision.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ShalomModule } from '../shalom/shalom.module';
import { EnvioDespachoModule } from '../envio-despacho/envio-despacho.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    NotificacionesModule,
    forwardRef(() => ComprobanteModule),
    forwardRef(() => GuiaRemisionModule),
    ResellerModule,
    S3Module,
    WhatsAppModule,
    ShalomModule,
    EnvioDespachoModule,
  ],
  providers: [
    SchedulerService,
    VerificarPendientesSunatService,
    VerificarEnviosShalomService,
    PrismaService,
  ],
  exports: [VerificarPendientesSunatService, VerificarEnviosShalomService],
})
export class SchedulerModule {}
