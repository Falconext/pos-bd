import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KardexService } from './kardex.service';
import { KardexController } from './kardex.controller';
import { ComprobanteModule } from '../comprobante/comprobante.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ComprobanteModule), // Para evitar dependencias circulares
  ],
  controllers: [KardexController],
  providers: [KardexService],
  exports: [KardexService], // Exportar el servicio para que pueda ser usado por otros módulos
})
export class KardexModule {}
