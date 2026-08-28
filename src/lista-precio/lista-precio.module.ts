import { Module } from '@nestjs/common';
import { ListaPrecioService } from './lista-precio.service';
import { ListaPrecioController } from './lista-precio.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ListaPrecioController],
  providers: [ListaPrecioService],
  exports: [ListaPrecioService],
})
export class ListaPrecioModule {}
