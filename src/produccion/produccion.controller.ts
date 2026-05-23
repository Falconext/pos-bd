import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ProduccionService } from './produccion.service';
import { CreateRecetaDto } from './dto/create-receta.dto';
import { UpdateRecetaDto } from './dto/update-receta.dto';
import { CreateOrdenProduccionDto } from './dto/create-orden-produccion.dto';
import { UpdateEstadoOrdenDto } from './dto/update-estado-orden.dto';
import { RegistrarEjecucionOrdenDto } from './dto/registrar-ejecucion-orden.dto';
import { UpdateMetodoSalidaDto } from './dto/update-metodo-salida.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

type RequestConUsuario = {
  user: {
    id: number;
    nombre?: string;
    email?: string;
    empresaId?: number;
    sedeId?: number;
    rol?: string;
  };
};

@Controller('produccion')
@UseGuards(JwtAuthGuard)
export class ProduccionController {
  constructor(private readonly produccionService: ProduccionService) {}

  private resolverEmpresaId(
    req: RequestConUsuario,
    empresaIdQuery?: string,
  ) {
    const empresaToken = req?.user?.empresaId;
    if (empresaToken) return Number(empresaToken);

    if (req?.user?.rol === 'ADMIN_SISTEMA' && empresaIdQuery) {
      return Number(empresaIdQuery);
    }

    throw new BadRequestException('No se encontró empresa activa.');
  }

  @Post('recetas')
  crearReceta(
    @Request() req: RequestConUsuario,
    @Body() dto: CreateRecetaDto,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.crearReceta(empresaId, dto);
  }

  @Get('recetas')
  listarRecetas(
    @Request() req: RequestConUsuario,
    @Query('activo') activo?: string,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.listarRecetas(empresaId, activo);
  }

  @Get('recetas/:id')
  obtenerReceta(
    @Request() req: RequestConUsuario,
    @Param('id', ParseIntPipe) recetaId: number,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.obtenerReceta(empresaId, recetaId);
  }

  @Patch('recetas/:id')
  actualizarReceta(
    @Request() req: RequestConUsuario,
    @Param('id', ParseIntPipe) recetaId: number,
    @Body() dto: UpdateRecetaDto,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.actualizarReceta(empresaId, recetaId, dto);
  }

  @Post('ordenes')
  crearOrden(
    @Request() req: RequestConUsuario,
    @Body() dto: CreateOrdenProduccionDto,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.crearOrden(empresaId, dto);
  }

  @Get('ordenes')
  listarOrdenes(
    @Request() req: RequestConUsuario,
    @Query() query: any,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.listarOrdenes(empresaId, query);
  }

  @Get('ordenes/:id')
  obtenerOrden(
    @Request() req: RequestConUsuario,
    @Param('id', ParseIntPipe) ordenId: number,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.obtenerOrden(empresaId, ordenId);
  }

  @Patch('ordenes/:id/estado')
  actualizarEstadoOrden(
    @Request() req: RequestConUsuario,
    @Param('id', ParseIntPipe) ordenId: number,
    @Body() dto: UpdateEstadoOrdenDto,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.actualizarEstadoOrden(
      empresaId,
      ordenId,
      dto,
    );
  }

  @Post('ordenes/:id/ejecutar')
  ejecutarOrden(
    @Request() req: RequestConUsuario,
    @Param('id', ParseIntPipe) ordenId: number,
    @Body() dto: RegistrarEjecucionOrdenDto,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.registrarEjecucionOrden(
      empresaId,
      ordenId,
      req.user.id,
      dto,
      req.user.sedeId,
    );
  }

  @Get('ordenes/:id/resumen-materiales')
  resumenMateriales(
    @Request() req: RequestConUsuario,
    @Param('id', ParseIntPipe) ordenId: number,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.resumenMaterialesOrden(empresaId, ordenId);
  }

  @Get('config')
  obtenerConfig(
    @Request() req: RequestConUsuario,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.obtenerConfiguracionProduccion(empresaId);
  }

  @Patch('config')
  actualizarConfig(
    @Request() req: RequestConUsuario,
    @Body() dto: UpdateMetodoSalidaDto,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.actualizarConfiguracionProduccion(
      empresaId,
      dto,
      req.user.id,
    );
  }

  @Get('config/historial')
  historialConfig(
    @Request() req: RequestConUsuario,
    @Query('limit') limit?: string,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.listarHistorialConfiguracionProduccion(
      empresaId,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('plantilla-carga')
  async descargarPlantillaCarga(
    @Request() req: RequestConUsuario,
    @Query('empresaId') empresaIdQuery: string | undefined,
    @Res() res: Response,
  ) {
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    const buffer = await this.produccionService.generarPlantillaCargaMasiva(
      empresaId,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=plantilla_fabricacion_falconext.xlsx',
    );
    res.status(200).send(buffer);
  }

  @Post('importar-plantilla')
  @UseInterceptors(FileInterceptor('file'))
  async importarPlantilla(
    @Request() req: RequestConUsuario,
    @UploadedFile() file: Express.Multer.File,
    @Query('empresaId') empresaIdQuery?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException(
        'No se recibió archivo para importar plantilla.',
      );
    }
    const empresaId = this.resolverEmpresaId(req, empresaIdQuery);
    return this.produccionService.importarPlantillaFabricacion(
      file.buffer,
      empresaId,
      req.user.id,
      req.user.sedeId,
    );
  }
}
