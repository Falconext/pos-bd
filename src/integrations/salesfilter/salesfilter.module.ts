import { Module } from '@nestjs/common';
import { SalesfilterBridgeService } from './salesfilter-bridge.service';

/**
 * Integración MYPE → SalesFilter (provisioning de cuentas espejo).
 * PrismaService y ConfigService son globales, así que no hay que importarlos.
 */
@Module({
  providers: [SalesfilterBridgeService],
  exports: [SalesfilterBridgeService],
})
export class SalesfilterModule {}
