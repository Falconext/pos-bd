import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductoModule } from '../../producto/producto.module';
import { KardexModule } from '../../kardex/kardex.module';
import { ComprobanteModule } from '../../comprobante/comprobante.module';
import { ErpApiService } from './erp.service';
import { ErpVentasService } from './erp-ventas.service';
import { ErpDatosService } from './erp-datos.service';
import { ErpAvisosService } from './erp-avisos.service';
import { IntegracionesModule } from '../../logistica/integraciones/integraciones.module';
import { ClienteModule } from '../../cliente/cliente.module';
import { ErpApiController } from './erp.controller';
import { ClavesApiController } from './claves-api.controller';

/** La API de Krezka para el propio negocio (`/api/v1/erp`): catálogo, stock, ventas y sus claves. */
@Module({
  imports: [PrismaModule, ProductoModule, KardexModule, ComprobanteModule, ClienteModule, IntegracionesModule],
  controllers: [ErpApiController, ClavesApiController],
  providers: [ErpApiService, ErpVentasService, ErpDatosService, ErpAvisosService],
})
export class ErpApiModule {}
