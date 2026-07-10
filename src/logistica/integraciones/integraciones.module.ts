import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys/api-keys.service';
import { ApiKeyAuthGuard } from './api-keys/api-key-auth.guard';
import { WebhooksService } from './webhooks/webhooks.service';
import { ExternalOrdersService } from './external-orders/external-orders.service';
import { IntegrationLogsService } from './integration-logs/integration-logs.service';
import { RateLimitsService } from './rate-limits/rate-limits.service';
import { SandboxService } from './sandbox/sandbox.service';
import { ExternalOrdersController, TrackingController } from './external-orders/external-orders.controller';
import { WebhookEndpointsController } from './webhooks/webhook-endpoints.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    ExternalOrdersController,
    TrackingController,
    WebhookEndpointsController,
  ],
  providers: [
    ApiKeysService,
    ApiKeyAuthGuard,
    WebhooksService,
    ExternalOrdersService,
    IntegrationLogsService,
    RateLimitsService,
    SandboxService,
  ],
  exports: [
    ApiKeysService,
    ApiKeyAuthGuard,
    WebhooksService,
  ],
})
export class IntegracionesModule {}
