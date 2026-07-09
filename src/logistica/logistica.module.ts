import { Module } from '@nestjs/common';
import { ConductorModule } from './conductor/conductor.module';
import { VehiculoLogisticaModule } from './vehiculo/vehiculo.module';
import { AlmacenLogisticaModule } from './almacen/almacen.module';
import { ZonaEntregaLogisticaModule } from './zona/zona.module';
import { ClienteLogisticaModule } from './cliente/cliente.module';
import { PedidoLogisticaModule } from './pedido/pedido.module';
import { DespachoLogisticaModule } from './despacho/despacho.module';
import { TrackingLogisticaModule } from './tracking/tracking.module';

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
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class LogisticaModule {}
