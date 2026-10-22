import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequiresModule } from '../common/decorators/module.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiresPermission } from '../common/decorators/permission.decorator';
import { InventarioDocumentosService } from './inventario-documentos.service';

/**
 * Entradas y salidas de mercadería (NE/NS). Va con el módulo de inventario:
 * quien puede ajustar stock producto por producto, puede hacerlo en lote.
 * El plan debe traer el módulo y, si es un usuario de la empresa, él debe
 * tener el permiso de Inventario (ModuleAccessGuard solo mira el plan).
 */
@Controller('inventario-documentos')
@UseGuards(JwtAuthGuard, ModuleAccessGuard, PermissionsGuard)
@RequiresModule('kardex')
@RequiresPermission('kardex')
export class InventarioDocumentosController {
  constructor(private readonly service: InventarioDocumentosService) {}

  @Get('contexto')
  contexto(@Request() req) {
    return this.service.contexto(this.empresaDe(req));
  }

  @Get()
  listar(@Query() q: any, @Request() req) {
    // El usuario de una sede ve lo de su sede; el administrador, lo que pida.
    const sedeId = this.esAdmin(req) ? (q.sedeId ? Number(q.sedeId) : undefined) : req.user.sedeId;
    return this.service.listar(this.empresaDe(req), { ...q, sedeId });
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number, @Request() req) {
    // Igual que el historial: el usuario de una sede no abre los de otra.
    return this.service.obtener(this.empresaDe(req), id, this.esAdmin(req) ? undefined : req.user.sedeId);
  }

  @Post()
  crear(@Body() body: any, @Request() req) {
    if (!req.user.sedeId) throw new BadRequestException('Elige una sede antes de mover mercadería.');
    return this.service.crear(this.empresaDe(req), req.user.id, req.user.sedeId, body);
  }

  private esAdmin(req: any) {
    return ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'].includes(req.user?.rol);
  }

  private empresaDe(req: any): number {
    if (!req.user?.empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    return req.user.empresaId;
  }
}
