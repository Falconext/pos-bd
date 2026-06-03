import { Module } from '@nestjs/common';
import { EnvioDespachoController } from './envio-despacho.controller';
import { EnvioDespachoService } from './envio-despacho.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [EnvioDespachoController],
    providers: [EnvioDespachoService],
    exports: [EnvioDespachoService],
})
export class EnvioDespachoModule {}
