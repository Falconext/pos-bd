import { Module } from '@nestjs/common';
import { ContratoVehicularController } from './contrato-vehicular.controller';
import { ContratoVehicularService } from './contrato-vehicular.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ContratoVehicularController],
  providers: [ContratoVehicularService],
  exports: [ContratoVehicularService],
})
export class ContratoVehicularModule {}
