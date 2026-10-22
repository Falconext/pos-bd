import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KardexModule } from '../kardex/kardex.module';
import { ProductoModule } from '../producto/producto.module';
import { InventarioDocumentosController } from './inventario-documentos.controller';
import { InventarioDocumentosService } from './inventario-documentos.service';

@Module({
  imports: [PrismaModule, KardexModule, ProductoModule],
  controllers: [InventarioDocumentosController],
  providers: [InventarioDocumentosService],
})
export class InventarioDocumentosModule {}
