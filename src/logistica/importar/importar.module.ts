import { Module } from '@nestjs/common';
import { ImportarService } from './importar.service';
import { ImportarController } from './importar.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ImportarController],
  providers: [ImportarService],
  exports: [ImportarService],
})
export class ImportarModule {}
