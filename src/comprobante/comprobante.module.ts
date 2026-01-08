import { Module, forwardRef } from '@nestjs/common';
import { ComprobanteService } from './comprobante.service';
import { ComprobanteController } from './comprobante.controller';
import { RolesGuard } from '../common/guards/roles.guard';
import { EnviarSunatService } from './enviar-sunat.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { EmpresaModule } from '../empresa/empresa.module';
import { KardexModule } from '../kardex/kardex.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { S3Module } from '../s3/s3.module';
import { ProductoModule } from '../producto/producto.module';

@Module({
  imports: [EmpresaModule, forwardRef(() => KardexModule), NotificacionesModule, S3Module, forwardRef(() => ProductoModule)],
  controllers: [ComprobanteController],
  providers: [ComprobanteService, RolesGuard, EnviarSunatService, PdfGeneratorService],
  exports: [ComprobanteService, EnviarSunatService],
})
export class ComprobanteModule { }
