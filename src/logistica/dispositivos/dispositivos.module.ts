import { Module } from '@nestjs/common';
import { DispositivosService } from './dispositivos.service';
import { DispositivosController } from './dispositivos.controller';
import { DispositivosIngestaController } from './dispositivos-ingesta.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { GeocercasModule } from '../geocercas/geocercas.module';

@Module({
  imports: [PrismaModule, GeocercasModule],
  controllers: [DispositivosController, DispositivosIngestaController],
  providers: [DispositivosService],
  exports: [DispositivosService],
})
export class DispositivosModule {}
