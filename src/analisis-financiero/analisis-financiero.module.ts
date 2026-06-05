import { Module } from '@nestjs/common';
import { AnalisisFinancieroController } from './analisis-financiero.controller';
import { AnalisisFinancieroService } from './analisis-financiero.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AnalisisFinancieroController],
  providers: [AnalisisFinancieroService],
})
export class AnalisisFinancieroModule {}
