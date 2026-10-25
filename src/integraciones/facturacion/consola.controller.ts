import {
  Body,
  CallHandler,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  NestInterceptor,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IdempotenciaInterceptor } from '../idempotencia/idempotencia.interceptor';
import { ApiExcludeController } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ConsolaFacturacionService } from './consola.service';

/**
 * Emitir y anular desde la consola llevan `Idempotency-Key` como en la API:
 * un doble clic o un reintento no puede terminar en dos comprobantes. El
 * interceptor de idempotencia identifica a la cuenta por `apiEmpresaId`; con
 * la sesión, esa cuenta es la del JWT.
 */
@Injectable()
class CuentaDeLaSesion implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    req.apiEmpresaId = req.user?.empresaId;
    return next.handle();
  }
}

/**
 * La consola de developers.krezka.com (ver consola.service.ts).
 *
 * Va con el JWT de la cuenta, no con API key: es la parte "humana" (crear
 * empresas y claves). La emisión sigue siendo /v1/invoicing con la clave.
 */
@ApiExcludeController()
@Controller('facturacion/consola')
export class ConsolaFacturacionController {
  constructor(private readonly consola: ConsolaFacturacionService) {}

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
  @Get('documentos')
  documentos(@Request() req: any, @Query() q: any) {
    return this.consola.listarDocumentos(req.user.empresaId, q);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('documentos/:id')
  documento(@Request() req: any, @Param('id') id: string) {
    return this.consola.verDocumento(req.user.empresaId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('documentos/:id/:archivo')
  async archivo(
    @Request() req: any,
    @Param('id') id: string,
    @Param('archivo') archivo: string,
    @Query('format') formato: string,
    @Res() res: any,
  ) {
    const a = await this.consola.archivoDocumento(req.user.empresaId, id, archivo, formato);
    res.set({
      'Content-Type': a.contentType,
      'Content-Disposition': `attachment; filename="${a.filename}"`,
      'Content-Length': String(a.buffer.length),
    });
    return res.send(a.buffer);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Post('emitir')
  @HttpCode(202)
  @UseInterceptors(CuentaDeLaSesion, IdempotenciaInterceptor)
  emitir(@Request() req: any, @Body() body: any) {
    return this.consola.emitirDocumento(req.user.empresaId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Post('documentos/:id/anular')
  @HttpCode(202)
  @UseInterceptors(CuentaDeLaSesion, IdempotenciaInterceptor)
  anular(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.consola.anularDocumento(req.user.empresaId, id, body);
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
  @Get('consumo')
  consumo(@Request() req: any, @Query('period') periodo?: string) {
    return this.consola.consumo(req.user.empresaId, periodo || undefined);
  }
}
