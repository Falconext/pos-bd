import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ImportarService } from './importar.service';
import { ImportarDto } from './dto/importar.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/importar')
export class ImportarController {
  constructor(private readonly importarService: ImportarService) {}

  @Get('plantilla')
  plantilla(@Query('tipo') tipo?: string) {
    if (tipo !== 'vehiculos' && tipo !== 'conductores') {
      throw new BadRequestException('tipo debe ser "vehiculos" o "conductores"');
    }
    return this.importarService.plantilla(tipo);
  }

  @Post('vehiculos')
  importarVehiculos(@Body() dto: ImportarDto, @Request() req: any) {
    return this.importarService.importarVehiculos(
      req.user.empresaId,
      dto.archivoBase64,
    );
  }

  @Post('conductores')
  importarConductores(@Body() dto: ImportarDto, @Request() req: any) {
    return this.importarService.importarConductores(
      req.user.empresaId,
      dto.archivoBase64,
    );
  }
}
