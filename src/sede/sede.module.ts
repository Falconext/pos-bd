import { Module } from '@nestjs/common';
import { SedeService } from './sede.service';
import { SedeController } from './sede.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [SedeController],
    providers: [SedeService],
    exports: [SedeService],
})
export class SedeModule { }
