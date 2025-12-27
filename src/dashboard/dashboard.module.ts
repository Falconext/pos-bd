import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardPublicController } from './dashboard-public.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [PrismaModule, GeminiModule],
  controllers: [DashboardController, DashboardPublicController],
  providers: [DashboardService],
})
export class DashboardModule { }
