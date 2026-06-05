import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RepartidorController } from './repartidor.controller';
import { RepartidorService } from './repartidor.service';

@Module({
  imports: [PrismaModule],
  controllers: [RepartidorController],
  providers: [RepartidorService],
  exports: [RepartidorService],
})
export class RepartidorModule {}
