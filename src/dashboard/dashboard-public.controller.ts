import { Controller, Get, Post, Body, Query, Param, ParseIntPipe } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../gemini/gemini.service';

/**
 * Public endpoints for the AI Dashboard module.
 * These endpoints do not require authentication and are meant for internal use.
 */
@Controller('ia')
export class DashboardPublicController {
    constructor(
        private readonly service: DashboardService,
        private readonly prisma: PrismaService,
        private readonly geminiService: GeminiService,
    ) { }

    @Get('resumen/:empresaId')
    async resumen(
        @Param('empresaId', ParseIntPipe) empresaId: number,
        @Query('fechaInicio') fechaInicio?: string,
        @Query('fechaFin') fechaFin?: string,
    ) {
        return this.service.headerResumen(empresaId, fechaInicio, fechaFin);
    }

    @Get('top-productos/:empresaId')
    async topProductos(
        @Param('empresaId', ParseIntPipe) empresaId: number,
        @Query('fechaInicio') fechaInicio?: string,
        @Query('fechaFin') fechaFin?: string,
        @Query('limit') limitRaw?: string,
    ) {
        const limit = limitRaw ? Number(limitRaw) : 10;
        return this.service.topProductos(empresaId, fechaInicio, fechaFin, limit);
    }

    @Get('productos-bajo-stock/:empresaId')
    async productosBajoStock(
        @Param('empresaId', ParseIntPipe) empresaId: number,
    ) {
        const productos = await this.prisma.producto.findMany({
            where: {
                empresaId,
                estado: 'ACTIVO',
            },
            select: {
                id: true,
                codigo: true,
                descripcion: true,
                stock: true,
                stockMinimo: true,
            },
        });

        // Filter products where stock is at or below stockMinimo + 5
        return productos.filter(
            (p) => p.stock <= (p.stockMinimo || 0) + 5 && p.stock >= 0,
        );
    }

    @Get('ingresos-medio-pago/:empresaId')
    async ingresosPorMedioPago(
        @Param('empresaId', ParseIntPipe) empresaId: number,
        @Query('fechaInicio') fechaInicio?: string,
        @Query('fechaFin') fechaFin?: string,
    ) {
        return this.service.ingresosPorMedioPago(empresaId, fechaInicio, fechaFin);
    }

    @Post('chat')
    async chat(
        @Body() body: { message: string; empresaId: number },
    ) {
        const { message, empresaId } = body;

        // 1. Gather context for the AI
        // Default to last 30 days context if no dates provided
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 30);
        const fechaFin = end.toISOString().slice(0, 10);
        const fechaInicio = start.toISOString().slice(0, 10);

        const [resumen, topProductos, bajoStock] = await Promise.all([
            this.service.headerResumen(empresaId, fechaInicio, fechaFin),
            this.service.topProductos(empresaId, fechaInicio, fechaFin, 5),
            this.productosBajoStock(empresaId)
        ]);

        const context = {
            resumen_30_dias: resumen,
            top_productos: topProductos,
            alerta_bajo_stock: bajoStock.slice(0, 10), // Limit context size
            fecha_actual: fechaFin
        };

        // 2. Ask Gemini
        const response = await this.geminiService.chat(message, context);

        return { response };
    }
}
