import { Module } from '@nestjs/common';
import { RubroController } from './rubro.controller';
import { RubroService } from './rubro.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [RubroController],
    providers: [RubroService],
    exports: [RubroService], // Exporting just in case
})
export class RubroModule { }
