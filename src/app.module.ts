import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './usuarios/usuarios.module';
import { EmpresaModule } from './empresa/empresa.module';
import { CategoriaModule } from './categoria/categoria.module';
import { ClienteModule } from './cliente/cliente.module';
import { ProductoModule } from './producto/producto.module';
import { ComprobanteModule } from './comprobante/comprobante.module';
import { KardexModule } from './kardex/kardex.module';
import { ExtensionesModule } from './extensiones/extensiones.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ContabilidadModule } from './contabilidad/contabilidad.module';
import { SuscripcionModule } from './suscripcion/suscripcion.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { PagoModule } from './pago/pago.module';
import { CajaModule } from './caja/caja.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { S3Module } from './s3/s3.module';
import { SyncModule } from './sync/sync.module';
import { TiendaModule } from './tienda/tienda.module';
import { PreferenciasModule } from './preferencias/preferencias.module';
import { MarcaModule } from './marca/marca.module';
import { DisenoRubroModule } from './diseno-rubro/diseno-rubro.module';
import { CombosModule } from './combos/combos.module';
import { ModificadoresModule } from './modificadores/modificadores.module';
import { RubroModule } from './rubro/rubro.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    EmpresaModule,
    CategoriaModule,
    ProductoModule,
    ClienteModule,
    ComprobanteModule,
    KardexModule,
    PagoModule,
    CajaModule,
    ExtensionesModule,
    DashboardModule,
    ContabilidadModule,
    SuscripcionModule,
    SchedulerModule,
    NotificacionesModule,
    WhatsAppModule,
    S3Module,
    SyncModule,
    TiendaModule,
    PreferenciasModule,
    MarcaModule,
    DisenoRubroModule,
    CombosModule,
    ModificadoresModule,
    RubroModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
