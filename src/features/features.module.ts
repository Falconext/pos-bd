import { Module, Global } from '@nestjs/common';
import { FeaturesService } from './features.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [FeaturesService],
  exports: [FeaturesService],
})
export class FeaturesModule {}
