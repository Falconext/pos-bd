import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequiresModule } from '../common/decorators/module.decorator';
import { User } from '../common/decorators/user.decorator';
import { EstadoLeadProspecto, TipoLeadDocumento } from '@prisma/client';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Get('config')
  obtenerConfig(@User() user: any) {
    return this.service.obtenerConfig(user.empresaId);
  }

  @Patch('config')
  actualizarConfig(
    @User() user: any,
    @Body()
    body: {
      iaVentasActiva?: boolean;
      iaVentasContexto?: string;
      iaVentasSeguimiento?: boolean;
      iaVentasCotizacion?: boolean;
      iaVentasBrochureUrl?: string;
    },
  ) {
    return this.service.actualizarConfig(user.empresaId, body);
  }

  // ─── Entrenamiento de la IA (RAG) ──────────────────────────────────────────

  @Get('entrenamiento')
  listarDocumentos(@User() user: any) {
    return this.service.listarDocumentos(user.empresaId);
  }

  @Post('entrenamiento')
  crearDocumento(
    @User() user: any,
    @Body()
    body: {
      tipo: TipoLeadDocumento;
      titulo?: string;
      contenido?: string;
      url?: string;
    },
  ) {
    return this.service.crearDocumento(user.empresaId, body);
  }

  @Delete('entrenamiento/:id')
  eliminarDocumento(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.eliminarDocumento(user.empresaId, id);
  }

  @Get('prospectos')
  listarProspectos(
    @User() user: any,
    @Query('estado') estado?: EstadoLeadProspecto,
    @Query('search') search?: string,
  ) {
    return this.service.listarProspectos(user.empresaId, { estado, search });
  }

  @Get('prospectos/resumen')
  resumen(@User() user: any) {
    return this.service.resumenProspectos(user.empresaId);
  }

  @Get('conversaciones')
  listarConversaciones(@User() user: any) {
    return this.service.listarConversaciones(user.empresaId);
  }

  @Get('conversaciones/:id')
  obtenerConversacion(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.obtenerConversacion(user.empresaId, id);
  }

  @Post('prospectos/:id/convertir')
  convertirACliente(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.convertirACliente(user.empresaId, id);
  }

  @Patch('prospectos/:id/bot')
  setBotActivo(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { activo: boolean },
  ) {
    return this.service.setBotActivo(user.empresaId, id, Boolean(body?.activo));
  }
}
