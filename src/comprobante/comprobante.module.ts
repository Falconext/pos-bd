import { Module, forwardRef } from '@nestjs/common';
import { ComprobanteService } from './comprobante.service';
import { ComprobanteController } from './comprobante.controller';
import { ComprobantePublicoController } from './comprobante-publico.controller';
import { RolesGuard } from '../common/guards/roles.guard';
import { EnviarSunatService } from './enviar-sunat.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { EmpresaModule } from '../empresa/empresa.module';
import { KardexModule } from '../kardex/kardex.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { S3Module } from '../s3/s3.module';
import { ProductoModule } from '../producto/producto.module';
import { QpseClient } from '../common/utils/qpse.client';
import { ApisPeruClient } from '../common/utils/apis-peru.client';
import { JambleClient } from '../common/utils/jamble.client';
import { ComisionesModule } from '../comisiones/comisiones.module';

@Module({
  imports: [EmpresaModule, forwardRef(() => KardexModule), NotificacionesModule, S3Module, forwardRef(() => ProductoModule), ComisionesModule],
  controllers: [ComprobanteController, ComprobantePublicoController],
  providers: [ComprobanteService, RolesGuard, EnviarSunatService, PdfGeneratorService, QpseClient, ApisPeruClient, JambleClient],
  exports: [ComprobanteService, EnviarSunatService, PdfGeneratorService, QpseClient, ApisPeruClient, JambleClient],
})
export class ComprobanteModule { }
