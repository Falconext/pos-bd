import { Module, forwardRef } from '@nestjs/common';
import { ProductoService } from './producto.service';
import { ProductoController } from './producto.controller';
import { ProductoPlantillaController } from './producto-plantilla.controller';
import { ProductoPlantillaService } from './producto-plantilla.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { KardexModule } from '../kardex/kardex.module';
import { S3Module } from '../s3/s3.module';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [forwardRef(() => KardexModule), S3Module, GeminiModule],
  controllers: [ProductoController, ProductoPlantillaController],
  providers: [ProductoService, ProductoPlantillaService, RolesGuard],
  exports: [ProductoService],
})
export class ProductoModule { }
