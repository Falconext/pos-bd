import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Delete,
} from '@nestjs/common';
import { ProductoService } from './producto.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import type { Response } from 'express';
import { CreateProductoDto } from './dto/create-producto.dto';
import { ListProductoDto } from './dto/list-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadOptions } from '../common/utils/multer.config';
import { GeminiService } from '../gemini/gemini.service';
import { ProductoLoteService } from './producto-lote.service';
import { CrearLoteDto } from './dto/lote.dto';
import { KardexService } from '../kardex/kardex.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('producto')
export class ProductoController {
  constructor(
    private readonly service: ProductoService,
    private readonly geminiService: GeminiService,
    private readonly loteService: ProductoLoteService,
    private readonly kardexService: KardexService,
  ) { }

  @Post('crear')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crear(
    @Body() dto: CreateProductoDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const producto = await this.service.crear(dto, user.empresaId, user.sedeId ?? undefined);
    res.locals.message = 'Producto creado correctamente';
    return producto;
  }

  @Post('ia/categorizar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async categorizarIA(@Body() body: { nombre: string }) {
    if (!this.geminiService) {
      return { success: false, message: 'Gemini Service not available' };
    }
    const result = await this.geminiService.categorizarProductos([{ id: 0, nombre: body.nombre }]);
    if (result.length > 0) {
      return { success: true, data: result[0] };
    }
    return { success: false, message: 'No se pudo categorizar' };
  }

  @Post('ia/generar-imagen')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async generarImagenIA(@Body() body: { nombre: string }) {
    const nombre = String(body?.nombre || '').trim();
    if (!nombre) {
      return { success: false, message: 'Nombre de producto requerido' };
    }

    const meaningfulTokens = nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !['de', 'con', 'sin', 'para', 'por', 'the', 'and'].includes(t));

    if (meaningfulTokens.length < 2) {
      return {
        success: false,
        message: 'Descripción muy corta. Usa al menos 2 palabras para buscar imagen relevante.',
      };
    }

    const normalize = (text: string) =>
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const tokenSet = new Set(normalize(nombre).split(' ').filter((t) => t.length >= 3));
    const bannedWords = [
      'logo', 'icon', 'svg', 'vector', 'clipart', 'sticker', 'wallpaper', 'banner',
      'facebook', 'instagram', 'tiktok', 'pinterest', 'youtube',
    ];

    type ImageResult = {
      url?: string;
      title?: string;
      alt?: string;
      width?: number;
      height?: number;
    };

    const scoreImage = (img: ImageResult): { score: number; tokenMatches: number } => {
      const sourceText = normalize(`${img.title || ''} ${img.alt || ''} ${img.url || ''}`);
      if (!sourceText) return { score: -1000, tokenMatches: 0 };

      let score = 0;
      let tokenMatches = 0;
      for (const token of tokenSet) {
        if (sourceText.includes(token)) {
          score += 5;
          tokenMatches += 1;
        }
      }
      for (const banned of bannedWords) {
        if (sourceText.includes(banned)) score -= 12;
      }

      const lowerUrl = String(img.url || '').toLowerCase();
      if (lowerUrl.endsWith('.svg')) score -= 20;
      if (lowerUrl.includes('logo') || lowerUrl.includes('icon')) score -= 10;

      if ((img.width || 0) >= 400 && (img.height || 0) >= 400) score += 4;
      if ((img.width || 0) < 180 || (img.height || 0) < 180) score -= 8;

      return { score, tokenMatches };
    };

    try {
      // Dynamic import to avoid build issues if lib is commonjs
      const { GOOGLE_IMG_SCRAP } = await import('google-img-scrap');
      const queries = [
        `"${nombre}" producto`,
        `${nombre} producto`,
        `${nombre} packshot`,
        `${nombre} foto producto`,
      ];

      for (const query of queries) {
        const results = await GOOGLE_IMG_SCRAP({
          search: query,
          limit: 12,
          safeSearch: true,
          // @ts-ignore
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        if (results && results.result && Array.isArray(results.result) && results.result.length > 0) {
          const candidates = (results.result as ImageResult[])
            .filter((img) => !!img?.url && /^https?:\/\//i.test(String(img.url)))
            .map((img) => {
              const ranking = scoreImage(img);
              return { img, score: ranking.score, tokenMatches: ranking.tokenMatches };
            })
            .sort((a, b) => b.score - a.score);

          const curatedCandidates = candidates
            .filter((c) => c.score > 0 && c.tokenMatches >= 1 && c.img.url)
            .slice(0, 4)
            .map((c) => String(c.img.url));

          const best = candidates[0];
          if (best && best.score >= 10 && best.tokenMatches >= 2 && best.img.url) {
            return {
              success: true,
              url: best.img.url,
              confidence: best.score,
              candidates: curatedCandidates.length > 0 ? curatedCandidates : [String(best.img.url)],
            };
          }

          if (curatedCandidates.length > 0) {
            return {
              success: false,
              message: 'No se encontró una coincidencia alta; revisa opciones sugeridas.',
              candidates: curatedCandidates,
            };
          }
        }
      }

      throw new Error(
        'No encontré una imagen suficientemente relacionada. Prueba con una descripción más específica (marca + modelo + tipo de producto).',
      );
    } catch (e: any) {
      return {
        success: false,
        message:
          e.message ||
          'No se encontró una imagen suficientemente relacionada. Prueba con una descripción más específica.',
      };
    }
  }

  // ==================== IMÁGENES (S3) ====================

  @Post(':id/imagen')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirImagenPrincipal(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.subirImagenPrincipal(user.empresaId, id, { buffer: file?.buffer, mimetype: file?.mimetype });
  }

  @Post(':id/imagen-extra')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirImagenExtra(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.subirImagenExtra(user.empresaId, id, { buffer: file?.buffer, mimetype: file?.mimetype });
  }

  @Post(':id/imagen-url')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async subirImagenDesdeUrl(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: { url: string },
  ) {
    return this.service.subirImagenDesdeUrl(user.empresaId, id, body.url);
  }

  @Get('listar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listar(
    @User() user: any,
    @Query() query: ListProductoDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    console.log('Listar Query:', query);
    const isAdmin = user.rol === 'ADMIN_EMPRESA' || user.rol === 'ADMIN_SISTEMA';
    const sedeId = isAdmin
      ? (query.sedeId ? Number(query.sedeId) : null)
      : user.sedeId;
    const resultado = await this.service.listar({
      empresaId: user.empresaId,
      sedeId,
      search: query.search,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      marcaId: query.marcaId,
      categoriaId: query.categoriaId,
    });
    res.locals.message = 'Productos listados correctamente';
    return resultado;
  }

  // Eliminar (lógico) un producto
  @Delete(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async eliminarProducto(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const eliminado = await this.service.eliminar(id, user.empresaId);
    res.locals.message = 'Producto eliminado correctamente';
    return eliminado;
  }

  @Delete('empresa/eliminar-todo')
  @Roles('ADMIN_EMPRESA')
  async eliminarTodo(
    @User() user: any,
    @Query('sedeId') sedeId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sedeIdNum = sedeId ? parseInt(sedeId, 10) : undefined;
    const eliminados = await this.service.eliminarTodo(user.empresaId, sedeIdNum);
    res.locals.message = `Se eliminaron (lógicamente) ${eliminados.count} productos correctamente`;
    return eliminados;
  }

  @Get('barcode/:codigo')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async getByBarcode(
    @Param('codigo') codigo: string,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const producto = await this.service.getByBarcode(user.empresaId, codigo);
    res.locals.message = 'Producto obtenido por código de barras';
    return producto;
  }

  @Get(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerPorId(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const producto = await this.service.obtenerPorId(id, user.empresaId);
    res.locals.message = 'Producto obtenido correctamente';
    return producto;
  }

  @Put(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: Omit<UpdateProductoDto, 'id' | 'empresaId'>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actualizado = await this.service.actualizar({
      id,
      empresaId: user.empresaId,
      sedeId: user.sedeId ?? undefined, // forward JWT sedeId so stock updates target the user's sede
      ...body,
    }, user.id); // Pasar el usuarioId para el kardex
    res.locals.message = 'Producto actualizado correctamente';
    return actualizado;
  }

  @Patch(':id/publicar-tienda')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async togglePublicarEnTienda(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: { publicarEnTienda: boolean },
  ) {
    return this.service.togglePublicarEnTienda(id, user.empresaId, body.publicarEnTienda);
  }

  @Patch(':id/estado')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: { estado: 'ACTIVO' | 'INACTIVO' | 'PLACEHOLDER' },
    @Res({ passthrough: true }) res: Response,
  ) {
    const actualizado = await this.service.cambiarEstado(
      id,
      user.empresaId,
      body.estado as any,
    );
    res.locals.message = `Producto ${body.estado === 'ACTIVO' ? 'activado' : body.estado === 'INACTIVO' ? 'desactivado' : 'actualizado'} correctamente`;
    return actualizado;
  }

  @Get('empresa/:empresaId/codigo-siguiente')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async codigoSiguientePorEmpresa(@Param('empresaId') empresaIdParam: string) {
    const empresaId = Number(empresaIdParam);
    if (!empresaId || Number.isNaN(empresaId)) {
      throw new BadRequestException('empresaId debe ser un número válido');
    }
    const codigo = await this.service.obtenerSiguienteCodigo(empresaId, 'PR');
    return { codigo };
  }

  @Post('carga-masiva')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file'))
  async cargarMasivo(@UploadedFile() file: any, @User() user: any) {
    if (!file) {
      return {
        total: 0,
        exitosos: 0,
        fallidos: 0,
        detalles: [{ error: 'No se proporcionó un archivo Excel' }],
      };
    }
    return this.service.cargaMasiva(file.buffer, user.empresaId);
  }

  @Get('empresa/:empresaId/exportar-archivo/:search')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async exportarBuscar(
    @Param('empresaId') empresaIdParam: string,
    @Param('search') search: string,
    @Res() res: Response,
  ) {
    const empresaId = Number(empresaIdParam);
    if (!empresaId || Number.isNaN(empresaId)) {
      throw new BadRequestException('empresaId debe ser un número válido');
    }
    const buffer = await this.service.exportar(empresaId, search);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename=productos.xlsx');
    res.status(200).send(buffer);
  }

  @Get('empresa/:empresaId/exportar-archivo')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async exportarArchivoEmpresa(
    @Param('empresaId') empresaIdParam: string,
    @Res() res: Response,
  ) {
    const empresaId = Number(empresaIdParam);
    if (!empresaId || Number.isNaN(empresaId)) {
      throw new BadRequestException('empresaId debe ser un número válido');
    }
    const buffer = await this.service.exportar(empresaId, undefined);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename=productos.xlsx');
    res.status(200).send(buffer);
  }

  // Endpoint para compatibilidad con frontend kardex
  @Get()
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listarProductos(
    @User() user: any,
    @Query() query: ListProductoDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.service.listar({
      empresaId: user.empresaId,
      sedeId: user.sedeId,
      search: query.search,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      marcaId: query.marcaId,
      categoriaId: query.categoriaId,
    });
    res.locals.message = 'Productos listados correctamente';
    return resultado;
  }

  // ==================== GESTIÓN DE LOTES (Farmacia) ====================

  @Get(':id/lotes')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerLotesProducto(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
  ) {
    return this.loteService.obtenerLotesProducto(id, user.empresaId);
  }

  @Get(':id/lotes/disponibles')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerLotesDisponibles(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
  ) {
    return this.loteService.obtenerLotesDisponibles(id, user.empresaId);
  }

  @Post('lotes')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crearLote(
    @Body() dto: CrearLoteDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const lote = await this.loteService.crearLote({
      ...dto,
      empresaId: user.empresaId,
      fechaVencimiento: new Date(dto.fechaVencimiento),
      usuarioId: user.id,
    });
    res.locals.message = 'Lote creado correctamente';
    return lote;
  }

  @Get('lotes/por-vencer')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerProductosPorVencer(
    @User() user: any,
    @Query('dias') dias?: string,
  ) {
    const diasAnticipacion = dias ? parseInt(dias) : 30;
    return this.loteService.obtenerProductosPorVencer(user.empresaId, diasAnticipacion);
  }

  @Get('lotes/vencidos')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerLotesVencidos(@User() user: any) {
    return this.loteService.obtenerLotesVencidos(user.empresaId);
  }

  @Patch('lotes/:id/desactivar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async desactivarLote(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.loteService.desactivarLote(id, user.empresaId, user.id);
    res.locals.message = 'Lote desactivado correctamente';
    return { success: true };
  }

  @Patch('lotes/:id/ajustar-stock')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async ajustarStockLote(
    @Param('id', ParseIntPipe) loteId: number,
    @Body() body: { productoId: number; cantidad: number; tipo: 'INCREMENTO' | 'DECREMENTO'; motivo: string },
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (body.cantidad <= 0) throw new BadRequestException('Cantidad debe ser positiva');

    const tipoMovimiento = body.tipo === 'INCREMENTO' ? 'INGRESO' : 'SALIDA';

    // Obtener sede principal
    const sedePrincipal = await this.service.getSedePrincipalId(user.empresaId);

    // 1. Registrar movimiento global (Kardex)
    const movimiento = await this.kardexService.registrarMovimiento({
      productoId: body.productoId,
      empresaId: user.empresaId,
      tipoMovimiento: tipoMovimiento,
      concepto: `Ajuste Lote Manual: ${body.motivo}`,
      cantidad: body.cantidad,
      usuarioId: user.id,
      // Usar la sede del usuario si está disponible o la principal
      sedeId: user.sedeId || sedePrincipal
    });

    // 2. Ajustar lote específico
    if (body.tipo === 'INCREMENTO') {
      await this.loteService.aumentarStockLote(loteId, body.cantidad, movimiento.id);
    } else {
      // Usamos descontarStockLote pasando el ID explícito para que no haga FEFO, sino descuento a ESE lote.
      await this.loteService.descontarStockLote(body.productoId, body.cantidad, movimiento.id, loteId);
    }

    res.locals.message = 'Stock ajustado correctamente';
    return { success: true };
  }

  @Get('lotes/:id/kardex')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerKardexLote(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
  ) {
    return this.loteService.obtenerKardexLote(id, user.empresaId);
  }

  @Get('lotes/todos')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listarLotesActivos(@User() user: any) {
    return this.loteService.obtenerTodosLotes(user.empresaId);
  }
}
