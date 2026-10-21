import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { SeoController } from './seo.controller';
import { ImagenPublicaController } from './imagen-publica.controller';
import { SeoService } from './seo.service';

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [SeoController, ImagenPublicaController],
  providers: [SeoService],
  exports: [SeoService],
})
export class SeoModule {}
