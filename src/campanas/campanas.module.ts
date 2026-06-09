import { Module } from '@nestjs/common';
import { CampanasController } from './campanas.controller';
import { CampanasService } from './campanas.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CampanasController],
  providers: [CampanasService],
})
export class CampanasModule {}
