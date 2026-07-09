import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';
import { PrismaModule } from '../prisma/prisma.module';
import { KardexModule } from '../kardex/kardex.module';
import { ProductoModule } from '../producto/producto.module';

@Module({
  imports: [PrismaModule, KardexModule, ProductoModule],
  controllers: [ComprasController],
  providers: [ComprasService],
})
export class ComprasModule {}
