import { Module } from '@nestjs/common';
import { FinanzasService } from './finanzas.service';
import { FinanzasController } from './finanzas.controller';
import { ConciliacionBancariaService } from './conciliacion-bancaria.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinanzasController],
  providers: [FinanzasService, ConciliacionBancariaService],
  exports: [FinanzasService],
})
export class FinanzasModule {}
