import { Module } from '@nestjs/common';
import { EnvioDespachoController } from './envio-despacho.controller';
import { EnvioDespachoService } from './envio-despacho.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RepartidorModule } from '../repartidor/repartidor.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, RepartidorModule, WhatsAppModule],
  controllers: [EnvioDespachoController],
  providers: [EnvioDespachoService],
  exports: [EnvioDespachoService],
})
export class EnvioDespachoModule {}
