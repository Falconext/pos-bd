import { Module } from '@nestjs/common';
import { PedidoLogisticaService } from './pedido.service';
import { PedidoLogisticaController } from './pedido.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PedidoLogisticaController],
  providers: [PedidoLogisticaService],
  exports: [PedidoLogisticaService],
})
export class PedidoLogisticaModule {}
