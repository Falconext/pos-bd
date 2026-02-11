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
    const producto = await this.service.crear(dto, user.empresaId);
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
    try {
      // Dynamic import to avoid build issues if lib is commonjs
      const { GOOGLE_IMG_SCRAP } = await import('google-img-scrap');
      const results = await GOOGLE_IMG_SCRAP({
        search: body.nombre,
        limit: 8,
        safeSearch: false,
        // @ts-ignore
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      if (results && results.result && Array.isArray(results.result) && results.result.length > 0) {
        // Prefer https
        const image = results.result.find((img: any) => img.url && img.url.startsWith('https')) || results.result.find((img: any) => img.url && img.url.startsWith('http'));

        if (image && image.url) {
          return { success: true, url: image.url };
        }
      }
      throw new Error('No images found via Google');
    } catch (e: any) {
      console.warn('Google Image Search failed, trying Bing fallback...', e.message);

      try {
        // Fallback: Bing Images
        const axios = (await import('axios')).default;
        const query = encodeURIComponent(body.nombre);
        const { data } = await axios.get(`https://www.bing.com/images/search?q=${query}&first=1`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          }
        });

        // Extract image URLs from Bing HTML (looking for murl)
        const matches = data.match(/murl&quot;:&quot;(http.*?)&quot;/g);
        if (matches && matches.length > 0) {
          // Extract URL from the first match: murl&quot;:&quot;URL&quot;
          const firstMatch = matches[0];
          const rawUrl = firstMatch.replace('murl&quot;:&quot;', '').replace('&quot;', '');
          if (rawUrl) {
            return { success: true, url: rawUrl };
          }
        }
      } catch (bingError) {
        console.error('Bing fallback also failed:', bingError);
      }

      return { success: false, message: e.message || 'Error interno al buscar imagen' };
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
    const resultado = await this.service.listar({
      empresaId: user.empresaId,
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
    @Res({ passthrough: true }) res: Response,
  ) {
    const eliminados = await this.service.eliminarTodo(user.empresaId);
    res.locals.message = `Se eliminaron (lógicamente) ${eliminados.count} productos correctamente`;
    return eliminados;
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
      ...body,
    }, user.id); // Pasar el usuarioId para el kardex
    res.locals.message = 'Producto actualizado correctamente';
    return actualizado;
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
      sedeId: sedePrincipal
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
