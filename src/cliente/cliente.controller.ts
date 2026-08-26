import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ClienteService } from './cliente.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import type { Response } from 'express';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { ListClienteDto } from './dto/list-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { excelUploadOptions } from '../common/utils/multer.config';

@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('clientes')
export class ClienteController {
  constructor(private readonly service: ClienteService) {}

  @Post()
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crear(
    @Body() dto: CreateClienteDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cliente = await this.service.crear({
      ...dto,
      empresaId: user.empresaId,
    });
    res.locals.message = 'Cliente creado correctamente';
    return cliente;
  }

  @Get()
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listar(
    @User() user: any,
    @Query() query: ListClienteDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.service.listar({
      empresaId: user.empresaId,
      search: query.search,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      persona: query.persona,
    });
    res.locals.message = 'Clientes listados correctamente';
    return resultado;
  }

  // Rutas literales primero — siempre antes que :id para evitar conflictos de matching
  @Get('consultar')
  async consultar(
    @Query('numero') numero: string,
    @Query('tipo') tipo: string,
  ) {
    if (!numero || !tipo) {
      throw new BadRequestException(
        'Parámetros "numero" y "tipo" son requeridos',
      );
    }
    return this.service.consultarDocumento(numero.toString(), tipo);
  }

  @Get('consultar/:tipo/:numero')
  async consultarPath(
    @Param('tipo') tipo: string,
    @Param('numero') numero: string,
  ) {
    if (!numero || !tipo) {
      throw new BadRequestException(
        'Parámetros "numero" y "tipo" son requeridos',
      );
    }
    return this.service.consultarDocumento(numero.toString(), tipo);
  }

  @Get('exportar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async exportarArchivoEmpresa(
    @User() user: any,
    @Query('search') search: string | undefined,
    // Filtra por tipo de persona (ej. PROVEEDOR) para reutilizar este mismo
    // endpoint en la pantalla de Proveedores sin mezclar clientes.
    @Query('persona') persona: string | undefined,
    @Res() res: Response,
  ) {
    const buffer = await this.service.exportar(user.empresaId, search, persona);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const filename =
      persona?.toUpperCase() === 'PROVEEDOR' ? 'proveedores.xlsx' : 'clientes.xlsx';
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.status(200).send(buffer);
  }

  @Post('importar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file', excelUploadOptions))
  async cargarMasivo(
    @UploadedFile() file: any,
    @User() user: any,
    // Persona por defecto para las filas que no traen la columna PERSONA
    // (ej. "PROVEEDOR" al importar desde la pantalla de Proveedores).
    @Body('persona') persona: string | undefined,
  ) {
    if (!file) {
      return {
        total: 0,
        exitosos: 0,
        fallidos: 0,
        detalles: [{ error: 'No se proporcionó un archivo Excel' }],
      };
    }
    return this.service.cargaMasiva(file.buffer, user.empresaId, persona);
  }

  // Rutas con parámetros dinámicos al final
  @Get(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerPorId(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cliente = await this.service.obtenerPorId(id, user.empresaId);
    res.locals.message = 'Cliente obtenido correctamente';
    return cliente;
  }

  @Put(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: Omit<UpdateClienteDto, 'id'>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actualizado = await this.service.actualizar({
      id,
      empresaId: user.empresaId,
      ...body,
    });
    res.locals.message = 'Cliente actualizado correctamente';
    return actualizado;
  }

  @Patch(':id/estado')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: { estado: 'ACTIVO' | 'INACTIVO' },
    @Res({ passthrough: true }) res: Response,
  ) {
    const actualizado = await this.service.cambiarEstado(
      id,
      user.empresaId,
      body.estado,
    );
    res.locals.message = `Cliente ${body.estado === 'ACTIVO' ? 'activado' : 'desactivado'} correctamente`;
    return actualizado;
  }

  @Delete(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async eliminar(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const eliminado = await this.service.eliminar(id, user.empresaId);
    res.locals.message = 'Cliente eliminado correctamente';
    return eliminado;
  }
}
