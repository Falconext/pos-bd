import { Module } from '@nestjs/common';
import { EmpresaService } from './empresa.service';
import { SedeModule } from '../sede/sede.module';
import { EmpresaController } from './empresa.controller';
import { RolesGuard } from '../common/guards/roles.guard';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [SedeModule, WhatsAppModule],
  controllers: [EmpresaController],
  providers: [EmpresaService, RolesGuard],
  exports: [EmpresaService],
})
export class EmpresaModule { }
