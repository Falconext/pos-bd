import { Module } from '@nestjs/common';
import { ZonaEntregaLogisticaService } from './zona.service';
import { ZonaEntregaLogisticaController } from './zona.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ZonaEntregaLogisticaController],
  providers: [ZonaEntregaLogisticaService],
  exports: [ZonaEntregaLogisticaService],
})
export class ZonaEntregaLogisticaModule {}
