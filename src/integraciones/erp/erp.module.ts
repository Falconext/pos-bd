import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductoModule } from '../../producto/producto.module';
import { ErpApiService } from './erp.service';
import { ErpApiController } from './erp.controller';
import { ClavesApiController } from './claves-api.controller';

/** La API de Krezka para el propio negocio (`/api/v1/erp`) y sus claves. */
@Module({
  imports: [PrismaModule, ProductoModule],
  controllers: [ErpApiController, ClavesApiController],
  providers: [ErpApiService],
})
export class ErpApiModule {}
