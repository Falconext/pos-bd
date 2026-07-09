import { Module } from '@nestjs/common';
import { DespachoLogisticaService } from './despacho.service';
import { DespachoLogisticaController } from './despacho.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DespachoLogisticaController],
  providers: [DespachoLogisticaService],
  exports: [DespachoLogisticaService],
})
export class DespachoLogisticaModule {}
