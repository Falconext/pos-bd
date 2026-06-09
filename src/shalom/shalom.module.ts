import { Module } from '@nestjs/common';
import { ShalomController } from './shalom.controller';
import { ShalomService } from './shalom.service';

@Module({
  controllers: [ShalomController],
  providers: [ShalomService],
  exports: [ShalomService],
})
export class ShalomModule {}
