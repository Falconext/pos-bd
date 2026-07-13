import { Module } from '@nestjs/common';
import { PeajeService } from './peaje.service';
import { PeajeController } from './peaje.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PeajeController],
  providers: [PeajeService],
  exports: [PeajeService],
})
export class PeajeModule {}
