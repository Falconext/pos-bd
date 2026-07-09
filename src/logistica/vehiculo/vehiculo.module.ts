import { Module } from '@nestjs/common';
import { VehiculoLogisticaService } from './vehiculo.service';
import { VehiculoLogisticaController } from './vehiculo.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VehiculoLogisticaController],
  providers: [VehiculoLogisticaService],
  exports: [VehiculoLogisticaService],
})
export class VehiculoLogisticaModule {}
