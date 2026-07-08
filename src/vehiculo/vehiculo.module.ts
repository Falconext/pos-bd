import { Module } from '@nestjs/common';
import { VehiculoController } from './vehiculo.controller';
import { VehiculoService } from './vehiculo.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [VehiculoController],
    providers: [VehiculoService],
    exports: [VehiculoService],
})
export class VehiculoModule {}
