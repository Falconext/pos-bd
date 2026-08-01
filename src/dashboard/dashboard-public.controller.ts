import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../gemini/gemini.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';

/**
 * Endpoints del Dashboard IA.
 * Requieren autenticación: cada request debe pertenecer a la empresa del token
 * (o ser ADMIN_SISTEMA). Antes exponían datos financieros de cualquier empresa.
 */
@UseGuards(JwtAuthGuard)
@Controller('ia')
export class DashboardPublicController {
  constructor(
    private readonly service: DashboardService,
    private readonly prisma: PrismaService,
    private readonly geminiService: GeminiService,
  ) {}

  /** Impide leer datos de una empresa distinta a la del token. */
  private assertAcceso(user: any, empresaId: number) {
    if (user?.rol === 'ADMIN_SISTEMA') return;
    if (!user || user.empresaId !== empresaId) {
      throw new ForbiddenException('No autorizado para esta empresa');
    }
  }

  @Get('resumen/:empresaId')
  async resumen(
    @User() user: any,
    @Param('empresaId', ParseIntPipe) empresaId: number,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    this.assertAcceso(user, empresaId);
    return this.service.headerResumen(empresaId, fechaInicio, fechaFin);
  }

  @Get('top-productos/:empresaId')
  async topProductos(
    @User() user: any,
    @Param('empresaId', ParseIntPipe) empresaId: number,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('limit') limitRaw?: string,
  ) {
    this.assertAcceso(user, empresaId);
    const limit = limitRaw ? Number(limitRaw) : 10;
    return this.service.topProductos(empresaId, fechaInicio, fechaFin, limit);
  }

  @Get('productos-bajo-stock/:empresaId')
  async productosBajoStock(
    @Param('empresaId', ParseIntPipe) empresaId: number,
    @User() user?: any,
  ) {
    this.assertAcceso(user, empresaId);
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
      (p) =>
        Number(p.stock) <= (p.stockMinimo || 0) + 5 && Number(p.stock) >= 0,
    );
  }

  @Get('ingresos-medio-pago/:empresaId')
  async ingresosPorMedioPago(
    @User() user: any,
    @Param('empresaId', ParseIntPipe) empresaId: number,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    this.assertAcceso(user, empresaId);
    return this.service.ingresosPorMedioPago(empresaId, fechaInicio, fechaFin);
  }

  @Post('chat')
  async chat(
    @User() user: any,
    @Body() body: { message: string; empresaId: number },
  ) {
    const { message, empresaId } = body;
    this.assertAcceso(user, empresaId);

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
      this.productosBajoStock(empresaId, user),
    ]);

    const context = {
      resumen_30_dias: resumen,
      top_productos: topProductos,
      alerta_bajo_stock: bajoStock.slice(0, 10), // Limit context size
      fecha_actual: fechaFin,
    };

    // 2. Ask Gemini
    const response = await this.geminiService.chat(message, context);

    return { response };
  }
}
