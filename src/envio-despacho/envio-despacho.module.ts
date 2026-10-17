import { Module } from '@nestjs/common';
import { EnvioDespachoController } from './envio-despacho.controller';
import { EnvioDespachoService } from './envio-despacho.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RepartidorModule } from '../repartidor/repartidor.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { S3Module } from '../s3/s3.module';
import { EvidenciaEntregaService } from './evidencia-entrega.service';
import { EntregaPublicaController } from './entrega-publica.controller';

@Module({
  imports: [PrismaModule, RepartidorModule, WhatsAppModule, S3Module],
  // `EntregaPublicaController` va SIN guard a propósito: el repartidor no
  // tiene cuenta y el token del enlace es su credencial. Ver
  // `acceso-repartidor.ts`.
  controllers: [EnvioDespachoController, EntregaPublicaController],
  providers: [EnvioDespachoService, EvidenciaEntregaService],
  exports: [EnvioDespachoService, EvidenciaEntregaService],
})
export class EnvioDespachoModule {}
