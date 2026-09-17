import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ComprobanteModule } from '../comprobante/comprobante.module';
import { CajaModule } from '../caja/caja.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { TipoCambioModule } from '../tipo-cambio/tipo-cambio.module';
import { SyncMovilController } from './sync-movil.controller';
import { CatalogoMovilService } from './catalogo-movil.service';
import { OperacionesMovilService } from './operaciones-movil.service';

/**
 * Modo offline-first de la app móvil (Fase 1): catálogo para SQLite y
 * procesamiento idempotente de operaciones hechas sin conexión.
 */
@Module({
  imports: [
    PrismaModule,
    ComprobanteModule,
    CajaModule,
    NotificacionesModule,
    TipoCambioModule,
  ],
  controllers: [SyncMovilController],
  providers: [CatalogoMovilService, OperacionesMovilService],
  exports: [OperacionesMovilService],
})
export class SyncMovilModule {}
