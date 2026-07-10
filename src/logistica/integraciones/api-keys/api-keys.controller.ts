import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../../common/guards/module-access.guard';
import { RequiresModule } from '../../../common/decorators/module.decorator';

/**
 * Gestión de API keys de Logística para la empresa autenticada (panel ERP).
 *
 * NO forma parte de la API pública documentada: va montado en `LogisticaModule`
 * (no en `IntegracionesModule`) para que NO aparezca en el OpenAPI generado, y
 * está protegido por el JWT del ERP. `@ApiExcludeController` es un cinturón de
 * seguridad extra por si algún día se incluye en el scan de Swagger.
 */
@ApiExcludeController()
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  /** Genera una nueva API key. La clave en claro se devuelve UNA sola vez. */
  @Post()
  generar(
    @Request() req: any,
    @Body() body: { nombre?: string; entorno?: 'live' | 'test' },
  ) {
    return this.apiKeys.generateKey(req.user.empresaId, {
      nombre: body?.nombre,
      entorno: body?.entorno,
    });
  }

  /** Lista las API keys activas de la empresa (sin exponer el secreto). */
  @Get()
  listar(@Request() req: any) {
    return this.apiKeys.listKeys(req.user.empresaId);
  }

  /** Revoca una API key de la empresa. */
  @Delete(':id')
  revocar(@Request() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.apiKeys.revokeKey(req.user.empresaId, id);
  }
}
