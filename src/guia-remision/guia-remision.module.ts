import { Module } from '@nestjs/common';
import { GuiaRemisionController } from './guia-remision.controller';
import { GuiaRemisionService } from './guia-remision.service';
import { SunatGuiaService } from './sunat-guia.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [GuiaRemisionController],
    providers: [GuiaRemisionService, SunatGuiaService],
    exports: [GuiaRemisionService],
})
export class GuiaRemisionModule { }
