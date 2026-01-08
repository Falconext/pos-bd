import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';
import { PrismaModule } from '../prisma/prisma.module';
import { KardexModule } from '../kardex/kardex.module';

@Module({
    imports: [PrismaModule, KardexModule],
    controllers: [ComprasController],
    providers: [ComprasService],
})
export class ComprasModule { }
