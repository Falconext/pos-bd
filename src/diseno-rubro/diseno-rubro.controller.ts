import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { DisenoRubroService } from './diseno-rubro.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('diseno-rubro')
export class DisenoRubroController {
  constructor(private readonly disenoService: DisenoRubroService) {}

  // ==================== PÚBLICOS ====================

  @Get('mi-empresa')
  @UseGuards(JwtAuthGuard)
  async obtenerMiDiseno(@Req() req: any) {
    const empresaId = req.user.empresaId;
    return this.disenoService.obtenerDisenoPorEmpresa(empresaId);
  }

  @Get('plantillas/config')
  async listarPlantillasConfig() {
    return this.disenoService.listarPlantillasConfig();
  }

  @Get(':rubroId')
  async obtenerDisenoRubro(@Param('rubroId') rubroId: string) {
    return this.disenoService.obtenerDisenoPorRubro(+rubroId);
  }

  // ==================== ADMIN_SISTEMA ====================

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async listarTodos() {
    return this.disenoService.listarTodos();
  }

  @Post('plantillas/config/:plantillaId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async guardarPlantillaConfig(
    @Param('plantillaId') plantillaId: string,
    @Body()
    body: {
      premium?: boolean;
      precioSoles?: number;
      premiumNote?: string;
    },
  ) {
    return this.disenoService.guardarPlantillaConfig(plantillaId, body);
  }

  @Post(':rubroId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async crearOActualizar(
    @Param('rubroId') rubroId: string,
    @Body()
    body: {
      colorPrimario?: string;
      colorSecundario?: string;
      colorAccento?: string;
      tipografia?: string;
      espaciado?: string;
      bordeRadius?: string;
      estiloBoton?: string;
      plantillaId?: string;
      vistaProductos?: string;
      tiempoEntregaMin?: number;
      tiempoEntregaMax?: number;
    },
  ) {
    return this.disenoService.crearOActualizar(+rubroId, body);
  }

  @Delete(':rubroId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async eliminar(@Param('rubroId') rubroId: string) {
    return this.disenoService.eliminar(+rubroId);
  }
}
