import { Module } from '@nestjs/common';
import { StoreCatalogService } from './store-catalog.service';
import { StoreCatalogController } from './store-catalog.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StoreCatalogController],
  providers: [StoreCatalogService],
})
export class StoreCatalogModule {}
