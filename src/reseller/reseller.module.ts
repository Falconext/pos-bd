import { Module } from '@nestjs/common';
import { ResellerService } from './reseller.service';
import { ResellerController } from './reseller.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
    controllers: [ResellerController],
    providers: [ResellerService, PrismaService],
    exports: [ResellerService],
})
export class ResellerModule { }
