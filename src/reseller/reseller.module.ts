import { Module } from '@nestjs/common';
import { ResellerService } from './reseller.service';
import { ResellerController } from './reseller.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificacionesModule } from 'src/notificaciones/notificaciones.module';
import { SedeModule } from 'src/sede/sede.module';
import { S3Module } from 'src/s3/s3.module';

@Module({
    imports: [NotificacionesModule, SedeModule, S3Module],
    controllers: [ResellerController],
    providers: [ResellerService, PrismaService],
    exports: [ResellerService],
})
export class ResellerModule { }
