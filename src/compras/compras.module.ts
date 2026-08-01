import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';
import { PrismaModule } from '../prisma/prisma.module';
import { KardexModule } from '../kardex/kardex.module';
import { ProductoModule } from '../producto/producto.module';
import { CajaModule } from '../caja/caja.module';
import { ComprobanteModule } from '../comprobante/comprobante.module';
import { OrdenCompraController } from './orden-compra.controller';
import { OrdenCompraService } from './orden-compra.service';

@Module({
  imports: [PrismaModule, KardexModule, ProductoModule, CajaModule, ComprobanteModule],
  controllers: [OrdenCompraController, ComprasController],
  providers: [ComprasService, OrdenCompraService],
})
export class ComprasModule {}
