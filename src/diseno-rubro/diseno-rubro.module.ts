import { Module } from '@nestjs/common';
import { DisenoRubroService } from './diseno-rubro.service';
import { DisenoRubroController } from './diseno-rubro.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DisenoRubroController],
  providers: [DisenoRubroService],
  exports: [DisenoRubroService],
})
export class DisenoRubroModule {}
