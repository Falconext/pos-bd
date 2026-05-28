import { Module } from '@nestjs/common';
import { CombosService } from './combos.service';
import { CombosController } from './combos.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';

@Module({
    imports: [PrismaModule, S3Module],
    controllers: [CombosController],
    providers: [CombosService],
    exports: [CombosService]
})
export class CombosModule { }
