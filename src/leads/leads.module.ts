import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LeadsController } from './leads.controller';
import { LeadsWebhookController } from './leads-webhook.controller';
import { LeadsService } from './leads.service';
import { LeadsMessageProcessor } from './leads-message.processor';
import { IaVentasService } from './leads-ia.service';
import { RagVentasService } from './leads-rag.service';
import { LeadsAlertaService } from './leads-alerta.service';
import { GeminiModule } from '../gemini/gemini.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ClienteModule } from '../cliente/cliente.module';
import { LEADS_MESSAGES_QUEUE, redisConnection } from './leads.constants';

/**
 * Módulo IA de Ventas / Filtro de Leads (portado de salesfilter-ai).
 * Fase 1a: CRM de prospectos y conversaciones (lectura).
 * Fase 1b: webhook entrante + cola BullMQ (Redis) que persiste los mensajes.
 * Fase 1c: motor de IA (BANT/SPIN sobre Gemini) que responde por WhatsApp,
 *          califica el lead y alerta al vendedor cuando es caliente. Reusa la
 *          infraestructura de MYPE (WhatsApp, Gemini, notificaciones).
 * Próxima: RAG (pgvector + documentos de entrenamiento).
 */
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: LEADS_MESSAGES_QUEUE }),
    GeminiModule,
    WhatsAppModule,
    NotificacionesModule,
    ClienteModule,
  ],
  controllers: [LeadsController, LeadsWebhookController],
  providers: [
    LeadsService,
    LeadsMessageProcessor,
    IaVentasService,
    RagVentasService,
    LeadsAlertaService,
  ],
  exports: [LeadsService],
})
export class LeadsModule {}
