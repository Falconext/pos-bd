import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IdempotenciaService } from './idempotencia.service';
import { IdempotenciaInterceptor } from './idempotencia.interceptor';

/**
 * Idempotencia de la API pública, disponible para cualquier producto que
 * exponga endpoints de escritura (facturación hoy, logística después).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [IdempotenciaService, IdempotenciaInterceptor],
  exports: [IdempotenciaService, IdempotenciaInterceptor],
})
export class IdempotenciaModule {}
