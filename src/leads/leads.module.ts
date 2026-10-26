import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LeadsController } from './leads.controller';
import { LeadsWebhookController } from './leads-webhook.controller';
import { LeadsService } from './leads.service';
import { LeadsEtiquetasService } from './leads-etiquetas.service';
import { LeadsSegmentosService } from './leads-segmentos.service';
import { LeadsPlantillasService } from './leads-plantillas.service';
import { LeadsEnviosService } from './leads-envios.service';
import { LeadsEnviosController } from './leads-envios.controller';
import { LeadsMessageProcessor } from './leads-message.processor';
import { IaVentasService } from './leads-ia.service';
import { RagVentasService } from './leads-rag.service';
import { LeadsAlertaService } from './leads-alerta.service';
import { LeadsSeguimientoService } from './leads-seguimiento.service';
import { LeadsPedidoService } from './leads-pedido.service';
import { LeadsEmbudoService } from './leads-embudo.service';
import { LeadsConsultasService } from './leads-consultas.service';
import { LeadsBiService } from './leads-bi.service';
import { LeadsDisparadoresService } from './leads-disparadores.service';
import { LeadsCrmController } from './leads-crm.controller';
import { S3Module } from '../s3/s3.module';
import { GeminiModule } from '../gemini/gemini.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { InstagramModule } from '../instagram/instagram.module';
import { LeadsVisitaService } from './leads-visita.service';
import { MessengerModule } from '../messenger/messenger.module';
import { MensajeriaService } from './mensajeria.service';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ClienteModule } from '../cliente/cliente.module';
import { ComprobanteModule } from '../comprobante/comprobante.module';
import { EnvioDespachoModule } from '../envio-despacho/envio-despacho.module';
import { PagoModule } from '../pago/pago.module';
import { MercadoPagoModule } from '../mercadopago/mercadopago.module';
import { LeadsPagoLinkService } from './leads-pago-link.service';
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
import { DashboardModule } from '../dashboard/dashboard.module';
import { ReporteDiarioService } from './reporte-diario.service';
import { ReporteDiarioController } from './reporte-diario.controller';

@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: LEADS_MESSAGES_QUEUE }),
    GeminiModule,
    WhatsAppModule,
    InstagramModule,
    MessengerModule,
    NotificacionesModule,
    ClienteModule,
    ComprobanteModule,
    EnvioDespachoModule,
    S3Module,
    PagoModule,
    MercadoPagoModule,
    DashboardModule,
  ],
  controllers: [
    LeadsController,
    LeadsWebhookController,
    LeadsCrmController,
    ReporteDiarioController,
    LeadsEnviosController,
  ],
  providers: [
    LeadsService,
    LeadsMessageProcessor,
    IaVentasService,
    RagVentasService,
    LeadsAlertaService,
    LeadsSeguimientoService,
    LeadsPedidoService,
    LeadsEmbudoService,
    LeadsConsultasService,
    LeadsBiService,
    LeadsDisparadoresService,
    LeadsPagoLinkService,
    ReporteDiarioService,
    MensajeriaService,
    LeadsVisitaService,
    LeadsEtiquetasService,
    LeadsSegmentosService,
    LeadsPlantillasService,
    LeadsEnviosService,
  ],
  exports: [LeadsService, LeadsEmbudoService, LeadsDisparadoresService],
})
export class LeadsModule {}
