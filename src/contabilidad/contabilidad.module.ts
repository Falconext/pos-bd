import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CajaModule } from '../caja/caja.module';
import { ContabilidadController } from './contabilidad.controller';
import { ContabilidadService } from './contabilidad.service';
import { ArqueoService } from './arqueo.service';
import { SireService } from './sire.service';

@Module({
  imports: [PrismaModule, CajaModule],
  controllers: [ContabilidadController],
  providers: [ContabilidadService, ArqueoService, SireService],
})
export class ContabilidadModule {}
