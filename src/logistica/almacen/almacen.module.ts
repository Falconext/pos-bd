import { Module } from '@nestjs/common';
import { AlmacenLogisticaService } from './almacen.service';
import { AlmacenLogisticaController } from './almacen.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AlmacenLogisticaController],
  providers: [AlmacenLogisticaService],
  exports: [AlmacenLogisticaService],
})
export class AlmacenLogisticaModule {}
