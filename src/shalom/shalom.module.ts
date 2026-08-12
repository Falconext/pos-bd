import { Module } from '@nestjs/common';
import { ShalomController } from './shalom.controller';
import { ShalomService } from './shalom.service';
import { ShalomLegacyService } from './shalom-legacy.service';
import { ShalomLatService } from './shalom-lat.service';

@Module({
  controllers: [ShalomController],
  providers: [ShalomService, ShalomLegacyService, ShalomLatService],
  exports: [ShalomService],
})
export class ShalomModule {}
