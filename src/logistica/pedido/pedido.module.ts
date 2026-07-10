import { Module } from '@nestjs/common';
import { PedidoLogisticaService } from './pedido.service';
import { PedidoLogisticaController } from './pedido.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegracionesModule } from '../integraciones/integraciones.module';

@Module({
  imports: [PrismaModule, IntegracionesModule],
  controllers: [PedidoLogisticaController],
  providers: [PedidoLogisticaService],
  exports: [PedidoLogisticaService],
})
export class PedidoLogisticaModule {}
