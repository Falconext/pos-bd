import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReservaController } from './reserva.controller';
import { ReservaService } from './reserva.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReservaController],
  providers: [ReservaService],
  exports: [ReservaService],
})
export class ReservaModule {}
