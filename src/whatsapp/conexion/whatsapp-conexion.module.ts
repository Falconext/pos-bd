import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp.module';
import { NotificacionesModule } from '../../notificaciones/notificaciones.module';
import { WhatsappConexionService } from './whatsapp-conexion.service';
import {
  EvolutionWebhookController,
  WhatsappConexionController,
} from './whatsapp-conexion.controller';

/**
 * Separado de WhatsAppModule a propósito: NotificacionesModule ya importa
 * WhatsAppModule, así que el aviso de desconexión (que usa notificaciones)
 * vive acá para no armar un ciclo de módulos.
 */
@Module({
  imports: [WhatsAppModule, NotificacionesModule],
  controllers: [WhatsappConexionController, EvolutionWebhookController],
  providers: [WhatsappConexionService],
})
export class WhatsappConexionModule {}
