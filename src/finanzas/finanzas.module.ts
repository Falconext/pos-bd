import { Module } from '@nestjs/common';
import { FinanzasService } from './finanzas.service';
import { FinanzasController } from './finanzas.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [FinanzasController],
    providers: [FinanzasService],
    exports: [FinanzasService],
})
export class FinanzasModule { }
