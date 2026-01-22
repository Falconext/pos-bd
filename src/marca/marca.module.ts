import { Module } from '@nestjs/common';
import { S3Module } from '../s3/s3.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MarcaService } from './marca.service';
import { MarcaController } from './marca.controller';

@Module({
  imports: [PrismaModule, S3Module],
  providers: [MarcaService],
  controllers: [MarcaController],
  exports: [MarcaService],
})
export class MarcaModule { }
