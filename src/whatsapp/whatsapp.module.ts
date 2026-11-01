import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { EvolutionEnvioService } from './evolution-envio.service';
import { NumeroNegocioService } from './numero-negocio.service';

@Module({
  controllers: [WhatsAppController],
  providers: [WhatsAppService, EvolutionEnvioService, NumeroNegocioService],
  exports: [WhatsAppService, EvolutionEnvioService, NumeroNegocioService],
})
export class WhatsAppModule {}
