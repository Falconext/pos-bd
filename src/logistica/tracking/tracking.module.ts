import { Module } from '@nestjs/common';
import { TrackingLogisticaService } from './tracking.service';
import { TrackingLogisticaController } from './tracking.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TrackingLogisticaController],
  providers: [TrackingLogisticaService],
  exports: [TrackingLogisticaService],
})
export class TrackingLogisticaModule {}
