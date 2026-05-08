import { Module } from '@nestjs/common';
import { SistemaFinanzasController } from './sistema-finanzas.controller';
import { SistemaFinanzasService } from './sistema-finanzas.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
    controllers: [SistemaFinanzasController],
    providers: [SistemaFinanzasService, PrismaService],
})
export class SistemaFinanzasModule { }
