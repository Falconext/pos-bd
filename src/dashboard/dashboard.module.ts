import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardPublicController } from './dashboard-public.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GeminiModule } from '../gemini/gemini.module';
import { ProductoModule } from '../producto/producto.module';

@Module({
  imports: [PrismaModule, GeminiModule, ProductoModule],
  controllers: [DashboardController, DashboardPublicController],
  providers: [DashboardService],
  // El reporte diario por WhatsApp (leads) usa los mismos números del panel.
  exports: [DashboardService],
})
export class DashboardModule {}
