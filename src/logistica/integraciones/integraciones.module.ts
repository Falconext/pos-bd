import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys/api-keys.service';
import { WebhooksService } from './webhooks/webhooks.service';
import { ExternalOrdersService } from './external-orders/external-orders.service';
import { IntegrationLogsService } from './integration-logs/integration-logs.service';
import { RateLimitsService } from './rate-limits/rate-limits.service';
import { SandboxService } from './sandbox/sandbox.service';
import { ExternalOrdersController, TrackingController } from './external-orders/external-orders.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExternalOrdersController, TrackingController],
  providers: [
    ApiKeysService,
    WebhooksService,
    ExternalOrdersService,
    IntegrationLogsService,
    RateLimitsService,
    SandboxService,
  ],
  exports: [
    ApiKeysService,
    WebhooksService,
  ],
})
export class IntegracionesModule {}
