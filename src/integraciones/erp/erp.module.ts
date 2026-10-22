import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../../s3/s3.module';
import { ErpApiService } from './erp.service';
import { ErpApiController, ErpImagenesController } from './erp.controller';
import { ClavesApiController } from './claves-api.controller';

/** La API de Krezka para el propio negocio (`/api/v1/erp`) y sus claves. */
@Module({
  imports: [PrismaModule, S3Module],
  controllers: [ErpApiController, ErpImagenesController, ClavesApiController],
  providers: [ErpApiService],
})
export class ErpApiModule {}
