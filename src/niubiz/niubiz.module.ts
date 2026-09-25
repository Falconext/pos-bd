import { Module } from '@nestjs/common';
import { NiubizService } from './niubiz.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [NiubizService, PrismaService],
  exports: [NiubizService],
})
export class NiubizModule {}
