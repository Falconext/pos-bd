import { Module } from '@nestjs/common';
import { PagoService } from './pago.service';
import { PagoController } from './pago.controller';
import { RolesGuard } from '../common/guards/roles.guard';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [S3Module],
  controllers: [PagoController],
  providers: [PagoService, RolesGuard],
  exports: [PagoService],
})
export class PagoModule {}
