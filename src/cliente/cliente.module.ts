import { Module } from '@nestjs/common';
import { ClienteService } from './cliente.service';
import { ClienteController } from './cliente.controller';
import { ProveedoresController } from './proveedores.controller';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  controllers: [ClienteController, ProveedoresController],
  providers: [ClienteService, RolesGuard],
  exports: [ClienteService],
})
export class ClienteModule { }
