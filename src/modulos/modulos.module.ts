import { Module } from '@nestjs/common';
import { ModulosController } from './modulos.controller';
import { ModulosService } from './modulos.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [ModulosController],
    providers: [ModulosService],
    exports: [ModulosService],
})
export class ModulosModule { }
