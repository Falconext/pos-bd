import { Module } from '@nestjs/common';
import { OlvaController } from './olva.controller';
import { OlvaService } from './olva.service';
import { OlvaApiService } from './olva-api.service';

@Module({
  controllers: [OlvaController],
  providers: [OlvaService, OlvaApiService],
  exports: [OlvaService],
})
export class OlvaModule {}
