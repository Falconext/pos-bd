import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ModificadoresService } from './modificadores.service';
import { CrearGrupoModificadorDto, ActualizarGrupoModificadorDto, AsignarModificadoresProductoDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('modificadores')
@UseGuards(JwtAuthGuard)
export class ModificadoresController {
  constructor(private readonly modificadoresService: ModificadoresService) {}

  // ==================== GRUPOS ====================

  @Post('grupos')
  async crearGrupo(@Req() req: any, @Body() dto: CrearGrupoModificadorDto) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.crearGrupo(empresaId, dto);
  }

  @Get('grupos')
  async listarGrupos(@Req() req: any, @Query('incluirInactivos') incluirInactivos?: string) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.listarGrupos(empresaId, incluirInactivos === 'true');
  }

  @Get('grupos/:id')
  async obtenerGrupo(@Req() req: any, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.obtenerGrupo(empresaId, +id);
  }

  @Patch('grupos/:id')
  async actualizarGrupo(@Req() req: any, @Param('id') id: string, @Body() dto: ActualizarGrupoModificadorDto) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.actualizarGrupo(empresaId, +id, dto);
  }

  @Delete('grupos/:id')
  async eliminarGrupo(@Req() req: any, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.eliminarGrupo(empresaId, +id);
  }

  // ==================== OPCIONES ====================

  @Post('grupos/:grupoId/opciones')
  async agregarOpcion(
    @Req() req: any,
    @Param('grupoId') grupoId: string,
    @Body() dto: { nombre: string; descripcion?: string; precioExtra?: number; orden?: number; esDefault?: boolean },
  ) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.agregarOpcion(empresaId, +grupoId, dto);
  }

  @Patch('opciones/:id')
  async actualizarOpcion(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { nombre?: string; descripcion?: string; precioExtra?: number; orden?: number; activo?: boolean; esDefault?: boolean },
  ) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.actualizarOpcion(empresaId, +id, dto);
  }

  @Delete('opciones/:id')
  async eliminarOpcion(@Req() req: any, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.eliminarOpcion(empresaId, +id);
  }

  // ==================== ASIGNACIÓN A PRODUCTOS ====================

  @Post('productos/:productoId')
  async asignarGruposAProducto(
    @Req() req: any,
    @Param('productoId') productoId: string,
    @Body() dto: AsignarModificadoresProductoDto,
  ) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.asignarGruposAProducto(empresaId, +productoId, dto);
  }

  @Get('productos/:productoId')
  async obtenerModificadoresProducto(@Req() req: any, @Param('productoId') productoId: string) {
    const empresaId = req.user.empresaId;
    return this.modificadoresService.obtenerModificadoresProducto(empresaId, +productoId);
  }
}
