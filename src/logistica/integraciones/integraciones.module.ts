import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks/webhooks.service';
import { ExternalOrdersService } from './external-orders/external-orders.service';
import { IntegrationLogsService } from './integration-logs/integration-logs.service';
import { SandboxService } from './sandbox/sandbox.service';
import { ExternalOrdersController, TrackingController } from './external-orders/external-orders.controller';
import { WebhookEndpointsController } from './webhooks/webhook-endpoints.controller';
import { PrismaModule } from '../../prisma/prisma.module';
// Autenticación, rate limiting e idempotencia viven en el módulo común:
// son iguales para toda API pública y duplicarlas dejaría dos sitios donde
// arreglar el día que falle la autenticación.
import { IntegracionesApiModule } from '../../integraciones/integraciones.module';

@Module({
  imports: [PrismaModule, IntegracionesApiModule],
  controllers: [
    ExternalOrdersController,
    TrackingController,
    WebhookEndpointsController,
  ],
  providers: [
    WebhooksService,
    ExternalOrdersService,
    IntegrationLogsService,
    SandboxService,
  ],
  exports: [WebhooksService],
})
export class IntegracionesModule {}
