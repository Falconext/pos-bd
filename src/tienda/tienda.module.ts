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
import { MercadoPagoModule } from '../mercadopago/mercadopago.module';
import { NiubizModule } from '../niubiz/niubiz.module';
import { ShalomModule } from '../shalom/shalom.module';
import { OlvaModule } from '../olva/olva.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { ComprobanteModule } from '../comprobante/comprobante.module';
import { EnvioDespachoModule } from '../envio-despacho/envio-despacho.module';
import { PedidoNotaVentaService } from './pedido-nota-venta.service';

@Module({
  imports: [
    PrismaModule,
    S3Module,
    DisenoRubroModule,
    ModificadoresModule,
    WhatsAppModule,
    NotificacionesModule,
    MercadoPagoModule,
    NiubizModule,
    // Agencias de Shalom y Olva para el checkout (envio-agencia.ts).
    ShalomModule,
    OlvaModule,
    // Pedido → nota de venta con despacho en un clic (pedido-nota-venta.service).
    ComprobanteModule,
    EnvioDespachoModule,
  ],
  controllers: [TiendaController, TiendaPublicController],
  providers: [TiendaService, PedidoNotaVentaService, RolesGuard],
  exports: [TiendaService],
})
export class TiendaModule {}
