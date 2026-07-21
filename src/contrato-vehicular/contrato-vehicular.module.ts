import { Module } from '@nestjs/common';
import { ContratoVehicularController } from './contrato-vehicular.controller';
import { ContratoVehicularService } from './contrato-vehicular.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PdfGeneratorService } from '../comprobante/pdf-generator.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContratoVehicularController],
  providers: [ContratoVehicularService, PdfGeneratorService],
  exports: [ContratoVehicularService],
})
export class ContratoVehicularModule {}
