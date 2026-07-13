import { Module } from '@nestjs/common';
import { GeocercasService } from './geocercas.service';
import { GeocercasController } from './geocercas.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GeocercasController],
  providers: [GeocercasService],
  exports: [GeocercasService],
})
export class GeocercasModule {}
