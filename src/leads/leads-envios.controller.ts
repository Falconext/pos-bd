import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequiresModule } from '../common/decorators/module.decorator';
import { User } from '../common/decorators/user.decorator';
import { LeadsSegmentosService } from './leads-segmentos.service';
import { FiltrosDto, GuardarSegmentoDto, PlantillaDto } from './dto/envios.dto';
import { LeadsPlantillasService } from './leads-plantillas.service';
import {
  erroresDe,
  normalizarPlantilla,
  textoRenderizado,
} from './plantillas-propias';

/**
 * Envíos masivos de la IA de Ventas: segmentos, plantillas y envíos.
 * Mismo gate que el resto del módulo (plan con `leads`).
 */
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('leads')
@Controller('leads')
export class LeadsEnviosController {
  constructor(
    private readonly segmentos: LeadsSegmentosService,
    private readonly plantillas: LeadsPlantillasService,
  ) {}

  // ─── Segmentos ─────────────────────────────────────────────────────────

  @Get('segmentos')
  listarSegmentos(@User() user: any) {
    return this.segmentos.listar(user.empresaId);
  }

  @Get('segmentos/opciones')
  opcionesSegmento(@User() user: any) {
    return this.segmentos.opciones(user.empresaId);
  }

  @Get('segmentos/productos')
  buscarProductos(
    @User() user: any,
    @Query('q') q: string,
    @Query('ids') ids?: string,
  ) {
    const lista = (ids ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    return this.segmentos.buscarProductos(user.empresaId, q, lista);
  }

  /** Cuántos cumplen el filtro y cuántos recibirían, con una muestra. */
  @Post('segmentos/previsualizar')
  previsualizar(@User() user: any, @Body() dto: FiltrosDto) {
    return this.segmentos.previsualizar(user.empresaId, dto.filtros ?? {});
  }

  @Post('segmentos')
  guardarSegmento(@User() user: any, @Body() dto: GuardarSegmentoDto) {
    return this.segmentos.guardar(user.empresaId, dto);
  }

  @Delete('segmentos/:id')
  eliminarSegmento(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.segmentos.eliminar(user.empresaId, id);
  }

  // ─── Plantillas ────────────────────────────────────────────────────────

  @Get('plantillas')
  listarPlantillas(@User() user: any) {
    return this.plantillas.listar(user.empresaId);
  }

  /** Errores y vista previa mientras se escribe, con las mismas reglas que el envío a Meta. */
  @Post('plantillas/validar')
  validarPlantilla(@Body() dto: PlantillaDto) {
    const d = normalizarPlantilla(dto.plantilla);
    return {
      errores: erroresDe(d),
      vistaPrevia: textoRenderizado(d, {
        nombre: 'María',
        dato1: d.ejemplos.dato1,
        dato2: d.ejemplos.dato2,
      }),
      pie: d.pie,
    };
  }

  @Post('plantillas/imagen')
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  subirImagenPlantilla(
    @User() user: any,
    @UploadedFile() archivo: Express.Multer.File,
  ) {
    return this.plantillas.subirImagen(user.empresaId, archivo);
  }

  @Post('plantillas')
  crearPlantilla(@User() user: any, @Body() dto: PlantillaDto) {
    return this.plantillas.guardar(user.empresaId, dto.plantilla);
  }

  @Patch('plantillas/:id')
  editarPlantilla(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PlantillaDto,
  ) {
    return this.plantillas.guardar(user.empresaId, dto.plantilla, id);
  }

  @Post('plantillas/:id/enviar')
  enviarPlantilla(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.plantillas.enviarARevision(user.empresaId, id);
  }

  @Post('plantillas/:id/sincronizar')
  sincronizarPlantilla(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.plantillas.sincronizar(user.empresaId, id);
  }

  @Post('plantillas/:id/duplicar')
  duplicarPlantilla(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.plantillas.duplicar(user.empresaId, id);
  }

  @Delete('plantillas/:id')
  eliminarPlantilla(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.plantillas.eliminar(user.empresaId, id);
  }
}
