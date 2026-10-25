import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ConsolaFacturacionService } from './consola.service';
import { CobrosApiService } from './cobros-api.service';

/**
 * La consola de developers.krezka.com (ver consola.service.ts).
 *
 * Va con el JWT de la cuenta, no con API key: es la parte "humana" (crear
 * empresas y claves). La emisión sigue siendo /v1/invoicing con la clave.
 */
@ApiExcludeController()
@Controller('facturacion/consola')
export class ConsolaFacturacionController {
  constructor(
    private readonly consola: ConsolaFacturacionService,
    private readonly cobros: CobrosApiService,
  ) {}

  @Post('registro')
  registrar(@Body() body: any) {
    return this.consola.registrar(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('cuenta')
  perfil(@Request() req: any) {
    return this.consola.perfil(req.user.empresaId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('empresas')
  empresas(@Request() req: any) {
    return this.consola.listarEmpresas(req.user.empresaId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('empresas/:id')
  empresa(@Request() req: any, @Param('id') id: string) {
    return this.consola.verEmpresa(req.user.empresaId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Post('empresas')
  agregarEmpresa(@Request() req: any, @Body() body: any) {
    return this.consola.agregarEmpresa(req.user.empresaId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Post('empresas/:id/produccion')
  pasarAProduccion(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.consola.pasarAProduccion(req.user.empresaId, id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Post('probar')
  @HttpCode(200)
  probar(@Request() req: any, @Body() body: any) {
    return this.consola.probar(req.user.empresaId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('claves')
  claves(@Request() req: any) {
    return this.consola.listarClaves(req.user.empresaId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Post('claves')
  crearClave(@Request() req: any, @Body() body: any) {
    return this.consola.crearClave(req.user.empresaId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Delete('claves/:id')
  revocarClave(@Request() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.consola.revocarClave(req.user.empresaId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('webhooks')
  webhooks(@Request() req: any) {
    return this.consola.listarWebhooks(req.user.empresaId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Post('webhooks')
  crearWebhook(@Request() req: any, @Body() body: any) {
    return this.consola.crearWebhook(req.user.empresaId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Delete('webhooks/:id')
  borrarWebhook(@Request() req: any, @Param('id') id: string) {
    return this.consola.borrarWebhook(req.user.empresaId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('cobros')
  async listarCobros(@Request() req: any) {
    await this.consola.perfil(req.user.empresaId);
    return this.cobros.listar(req.user.empresaId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Post('cobros/:id/pagar')
  @HttpCode(200)
  async pagarCobro(@Request() req: any, @Param('id', ParseIntPipe) id: number) {
    await this.consola.perfil(req.user.empresaId);
    return this.cobros.linkDePago(req.user.empresaId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Post('cobros/:id/verificar')
  @HttpCode(200)
  async verificarCobro(@Request() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    await this.consola.perfil(req.user.empresaId);
    return this.cobros.verificar(req.user.empresaId, id, body?.payment_id ? String(body.payment_id) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('consumo')
  consumo(@Request() req: any, @Query('period') periodo?: string) {
    return this.consola.consumo(req.user.empresaId, periodo || undefined);
  }
}
