import { Module } from '@nestjs/common';
import { GuiaRemisionController } from './guia-remision.controller';
import { GuiaRemisionService } from './guia-remision.service';
import { SunatGuiaService } from './sunat-guia.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ComprobanteModule } from '../comprobante/comprobante.module';

@Module({
    imports: [PrismaModule, ComprobanteModule],
    controllers: [GuiaRemisionController],
    providers: [GuiaRemisionService, SunatGuiaService],
    exports: [GuiaRemisionService],
})
export class GuiaRemisionModule { }
