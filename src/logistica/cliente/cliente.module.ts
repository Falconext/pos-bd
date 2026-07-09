import { Module } from '@nestjs/common';
import { ClienteLogisticaService } from './cliente.service';
import { ClienteLogisticaController } from './cliente.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClienteLogisticaController],
  providers: [ClienteLogisticaService],
  exports: [ClienteLogisticaService],
})
export class ClienteLogisticaModule {}
