import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductoModule } from '../../producto/producto.module';
import { KardexModule } from '../../kardex/kardex.module';
import { ComprobanteModule } from '../../comprobante/comprobante.module';
import { ErpApiService } from './erp.service';
import { ErpVentasService } from './erp-ventas.service';
import { ErpApiController } from './erp.controller';
import { ClavesApiController } from './claves-api.controller';

/** La API de Krezka para el propio negocio (`/api/v1/erp`): catálogo, stock, ventas y sus claves. */
@Module({
  imports: [PrismaModule, ProductoModule, KardexModule, ComprobanteModule],
  controllers: [ErpApiController, ClavesApiController],
  providers: [ErpApiService, ErpVentasService],
})
export class ErpApiModule {}
