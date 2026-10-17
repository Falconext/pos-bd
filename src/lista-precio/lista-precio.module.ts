import { Module } from '@nestjs/common';
import { ListaPrecioService } from './lista-precio.service';
import { ReprecioMasivoService } from './reprecio-masivo.service';
import { ListaPrecioController } from './lista-precio.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ListaPrecioController],
  providers: [ListaPrecioService, ReprecioMasivoService],
  exports: [ListaPrecioService, ReprecioMasivoService],
})
export class ListaPrecioModule {}
