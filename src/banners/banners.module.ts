import { Module } from '@nestjs/common';
import { BannersService } from './banners.service';
import { BannersController } from './banners.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { FeaturesModule } from '../features/features.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [PrismaModule, FeaturesModule, S3Module],
  controllers: [BannersController],
  providers: [BannersService],
})
export class BannersModule {}
