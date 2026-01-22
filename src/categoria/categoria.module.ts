import { Module } from '@nestjs/common';
import { S3Module } from '../s3/s3.module';
import { CategoriaService } from './categoria.service';
import { CategoriaController } from './categoria.controller';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [S3Module],
  controllers: [CategoriaController],
  providers: [CategoriaService, RolesGuard],
  exports: [CategoriaService],
})
export class CategoriaModule { }
