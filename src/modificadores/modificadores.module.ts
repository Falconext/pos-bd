import { Module } from '@nestjs/common';
import { ModificadoresController } from './modificadores.controller';
import { ModificadoresService } from './modificadores.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ModificadoresController],
  providers: [ModificadoresService],
  exports: [ModificadoresService],
})
export class ModificadoresModule {}
