import { Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Post, Request, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { MODULO_API } from './erp.service';

/**
 * "Claves API" del panel: el negocio saca la clave para su web.
 *
 * Solo el administrador: una clave lee todo el catálogo y el stock, y no debe
 * quedar en manos de cualquier usuario de caja. Va con el JWT del panel y no
 * forma parte de la API pública (por eso no sale en el OpenAPI).
 */
@ApiExcludeController()
@UseGuards(JwtAuthGuard, ModuleAccessGuard, RolesGuard)
@RequiresModule(MODULO_API)
@Roles('ADMIN_EMPRESA')
@Controller('integraciones/claves-api')
export class ClavesApiController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  listar(@Request() req: any) {
    return this.apiKeys.listKeys(req.user.empresaId, 'erp');
  }

  /** La clave completa se devuelve UNA sola vez. */
  @Post()
  crear(@Request() req: any, @Body() body: { nombre?: string; entorno?: 'live' | 'test' }) {
    const nombre = String(body?.nombre ?? '').trim().slice(0, 60) || undefined;
    return this.apiKeys.generateKey(req.user.empresaId, 'erp', { nombre, entorno: body?.entorno });
  }

  @Delete(':id')
  async revocar(@Request() req: any, @Param('id', ParseIntPipe) id: number) {
    const r = await this.apiKeys.revokeKey(req.user.empresaId, 'erp', id);
    if (!r) throw new NotFoundException('La clave no existe.');
    return r;
  }
}
