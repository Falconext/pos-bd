import { Module, forwardRef } from '@nestjs/common';
import { TiendaService } from './tienda.service';
import { TiendaController } from './tienda.controller';
import { TiendaPublicController } from './tienda-public.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DisenoRubroModule } from '../diseno-rubro/diseno-rubro.module';
import { S3Module } from 'src/s3/s3.module';
import { ModificadoresModule } from '../modificadores/modificadores.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [
    PrismaModule,
    S3Module,
    DisenoRubroModule,
    ModificadoresModule,
    WhatsAppModule,
    NotificacionesModule,
  ],
  controllers: [TiendaController, TiendaPublicController],
  providers: [TiendaService, RolesGuard],
  exports: [TiendaService],
})
export class TiendaModule {}
