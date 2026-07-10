import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../../common/guards/module-access.guard';
import { RequiresModule } from '../../../common/decorators/module.decorator';

/**
 * Gestión de endpoints de webhook de Logística para la empresa autenticada
 * (panel ERP).
 *
 * NO forma parte de la API pública documentada: va montado en `LogisticaModule`
 * (no en `IntegracionesModule`) para que NO aparezca en el OpenAPI generado, y
 * está protegido por el JWT del ERP. `@ApiExcludeController` es un cinturón de
 * seguridad extra por si algún día se incluye en el scan de Swagger.
 */
@ApiExcludeController()
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/webhooks')
export class WebhooksAdminController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** Registra un endpoint de webhook. El secreto se devuelve UNA sola vez. */
  @Post()
  crear(
    @Request() req: any,
    @Body() body: { url: string; events: string[] },
  ) {
    return this.webhooks.createEndpoint(req.user.empresaId, body);
  }

  /** Lista los endpoints de la empresa (sin exponer el secreto). */
  @Get()
  listar(@Request() req: any) {
    return this.webhooks.listEndpoints(req.user.empresaId);
  }

  /** Elimina un endpoint de la empresa (id público `we_…`). */
  @Delete(':id')
  eliminar(@Request() req: any, @Param('id') id: string) {
    return this.webhooks.deleteEndpoint(req.user.empresaId, id);
  }
}
