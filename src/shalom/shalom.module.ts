import { Module } from '@nestjs/common';
import { ShalomController } from './shalom.controller';
import { ShalomService } from './shalom.service';
import { ShalomLatService } from './shalom-lat.service';

@Module({
  controllers: [ShalomController],
  providers: [ShalomService, ShalomLatService],
  exports: [ShalomService],
})
export class ShalomModule {}
