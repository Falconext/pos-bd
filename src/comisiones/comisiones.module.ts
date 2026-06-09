import { Module } from '@nestjs/common';
import { ComisionesService } from './comisiones.service';
import { ComisionesController } from './comisiones.controller';

@Module({
  controllers: [ComisionesController],
  providers: [ComisionesService],
  exports: [ComisionesService],
})
export class ComisionesModule {}
