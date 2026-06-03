import { Module } from '@nestjs/common';
import { DigemidController } from './digemid.controller';
import { DigemidService } from './digemid.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DigemidController],
  providers: [DigemidService],
  exports: [DigemidService],
})
export class DigemidModule {}
