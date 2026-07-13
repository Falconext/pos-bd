import { Module } from '@nestjs/common';
import { ConductorModule } from './conductor/conductor.module';
import { VehiculoLogisticaModule } from './vehiculo/vehiculo.module';
import { AlmacenLogisticaModule } from './almacen/almacen.module';
import { ZonaEntregaLogisticaModule } from './zona/zona.module';
import { ClienteLogisticaModule } from './cliente/cliente.module';
import { PedidoLogisticaModule } from './pedido/pedido.module';
import { DespachoLogisticaModule } from './despacho/despacho.module';
import { TrackingLogisticaModule } from './tracking/tracking.module';
import { MantenimientoModule } from './mantenimiento/mantenimiento.module';
import { CombustibleModule } from './combustible/combustible.module';
import { PeajeModule } from './peaje/peaje.module';
import { DocumentosModule } from './documentos/documentos.module';
import { GeocercasModule } from './geocercas/geocercas.module';
import { DispositivosModule } from './dispositivos/dispositivos.module';
import { ImportarModule } from './importar/importar.module';
import { IntegracionesModule } from './integraciones/integraciones.module';
import { ApiKeysController } from './integraciones/api-keys/api-keys.controller';
import { WebhooksAdminController } from './integraciones/webhooks/webhooks-admin.controller';


@Module({
  imports: [
    ConductorModule,
    VehiculoLogisticaModule,
    AlmacenLogisticaModule,
    ZonaEntregaLogisticaModule,
    ClienteLogisticaModule,
    PedidoLogisticaModule,
    DespachoLogisticaModule,
    TrackingLogisticaModule,
    MantenimientoModule,
    CombustibleModule,
    PeajeModule,
    DocumentosModule,
    GeocercasModule,
    DispositivosModule,
    ImportarModule,
    IntegracionesModule,
  ],
  // ApiKeysController y WebhooksAdminController van aquí (no en
  // IntegracionesModule) para NO filtrarse al OpenAPI público, que solo incluye
  // IntegracionesModule. Usan servicios exportados por IntegracionesModule.
  controllers: [ApiKeysController, WebhooksAdminController],
  providers: [],
  exports: [],
})
export class LogisticaModule {}
