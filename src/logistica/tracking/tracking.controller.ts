import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TrackingLogisticaService } from './tracking.service';
import { RegistrarUbicacionDto } from './dto/registrar-ubicacion.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@Controller('logistica/tracking')
export class TrackingLogisticaController {
  constructor(private readonly trackingService: TrackingLogisticaService) {}

  @UseGuards(JwtAuthGuard, ModuleAccessGuard)
  @RequiresModule('logistica')
  @Post('ubicacion')
  registrarUbicacion(@Body() dto: RegistrarUbicacionDto, @Request() req: any) {
    return this.trackingService.registrarUbicacion(req.user.empresaId, dto);
  }

  @UseGuards(JwtAuthGuard, ModuleAccessGuard)
  @RequiresModule('logistica')
  @Get('conductores')
  obtenerUbicacionConductores(@Request() req: any) {
    return this.trackingService.obtenerUbicacionConductores(req.user.empresaId);
  }

  // Endpoint público sin Auth
  @Get('publico/:codigoTracking')
  obtenerTrackingPublico(@Param('codigoTracking') codigoTracking: string) {
    return this.trackingService.obtenerTrackingPublico(codigoTracking);
  }
}
