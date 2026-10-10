import { Module } from '@nestjs/common';
import { EnvioDespachoController } from './envio-despacho.controller';
import { EnvioDespachoService } from './envio-despacho.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RepartidorModule } from '../repartidor/repartidor.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { S3Module } from '../s3/s3.module';
import { EvidenciaEntregaService } from './evidencia-entrega.service';

@Module({
  imports: [PrismaModule, RepartidorModule, WhatsAppModule, S3Module],
  controllers: [EnvioDespachoController],
  providers: [EnvioDespachoService, EvidenciaEntregaService],
  exports: [EnvioDespachoService, EvidenciaEntregaService],
})
export class EnvioDespachoModule {}
