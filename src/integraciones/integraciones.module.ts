import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeysService } from './api-keys/api-keys.service';
import { ApiKeyAuthGuard } from './api-keys/api-key-auth.guard';
import { RateLimitsService } from './rate-limits/rate-limits.service';
import { IdempotenciaService } from './idempotencia/idempotencia.service';
import { IdempotenciaInterceptor } from './idempotencia/idempotencia.interceptor';

/**
 * Lo común a todas las APIs públicas: autenticación por key, rate limiting e
 * idempotencia. Un producto nuevo decora sus controladores con
 * `@ApiProducto(...)` y no agrega infraestructura.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    ApiKeysService,
    ApiKeyAuthGuard,
    RateLimitsService,
    IdempotenciaService,
    IdempotenciaInterceptor,
  ],
  exports: [
    ApiKeysService,
    ApiKeyAuthGuard,
    RateLimitsService,
    IdempotenciaService,
    IdempotenciaInterceptor,
  ],
})
export class IntegracionesApiModule {}
