import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { EmpresaService } from './empresa.service';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { ListEmpresaDto } from './dto/list-empresa.dto';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import { CreateCuentaBancariaDto, UpdateCuentaBancariaDto } from './dto/cuenta-bancaria.dto';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';

@Controller('empresa')
export class EmpresaController {
  constructor(private readonly empresaService: EmpresaService) { }

  @Post('crear')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async crear(
    @Body() dto: CreateEmpresaDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const nueva = await this.empresaService.crear(dto, user.sistemaNegocio, user.id, user.sistemaProducto);
    res.locals.message = 'Empresa creada exitosamente';
    return nueva;
  }

  @Post('registro')
  async registro(
    @Body() dto: CreateEmpresaDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const nueva = await this.empresaService.crear(dto);
    res.locals.message = 'Empresa registrada exitosamente';
    return nueva;
  }

  @Get('mia')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerMiEmpresa(
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const empresa = await this.empresaService.obtenerMiEmpresa(user.empresaId);
    res.locals.message = 'Información de la empresa cargada correctamente';
    return empresa;
  }

  @Put('mia')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizarMiEmpresa(
    @User() user: any,
    @Body() body: Partial<UpdateEmpresaDto>,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Force ID to match user's company
    const dto: UpdateEmpresaDto = { ...body, id: user.empresaId } as UpdateEmpresaDto;
    const result = await this.empresaService.actualizar(dto);
    res.locals.message = 'Información de empresa actualizada correctamente';
    return result;
  }

  @Get('listar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async listar(
    @Query() query: ListEmpresaDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const empresas = await this.empresaService.listar(query, user.sistemaNegocio, user.sistemaProducto);
    res.locals.message = 'Empresas listadas correctamente';
    return empresas;
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Omit<UpdateEmpresaDto, 'id'>,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dto: UpdateEmpresaDto = { id, ...body } as UpdateEmpresaDto;
    const result = await this.empresaService.actualizar(dto, user.sistemaNegocio, user.sistemaProducto);
    res.locals.message = 'Empresa actualizada correctamente';
    return result;
  }

  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado: 'ACTIVO' | 'INACTIVO' },
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.empresaService.cambiarEstado(id, body.estado, user.id);
    res.locals.message = `Empresa ${body.estado === 'ACTIVO' ? 'activada' : 'desactivada'} correctamente`;
    return result;
  }

  @Post(':id/sync-hotel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async sincronizarHotel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { adminPassword?: string },
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.empresaService.sincronizarHotelDesdeMype(
      id,
      user.sistemaNegocio,
      user.sistemaProducto,
      body?.adminPassword,
    );
    res.locals.message = 'Empresa sincronizada con Falconext Hotel';
    return result;
  }

  // ── Notas internas ──────────────────────────────────────────────────────────

  @Get(':id/notas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  listarNotas(@Param('id', ParseIntPipe) id: number) {
    return this.empresaService.listarNotas(id);
  }

  @Post(':id/notas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  crearNota(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { contenido: string; notificar?: boolean },
    @User() user: any,
  ) {
    return this.empresaService.crearNota(id, body.contenido, user.id, body.notificar ?? false);
  }

  @Delete(':id/notas/:notaId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  eliminarNota(@Param('notaId', ParseIntPipe) notaId: number) {
    return this.empresaService.eliminarNota(notaId);
  }

  // ── Email Plantillas ───────────────────────────────────────────────────────

  @Post(':id/enviar-email')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async enviarEmailTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      tipo: 'BIENVENIDA' | 'AGRADECIMIENTO' | 'RECORDATORIO' | 'PROMOCION';
      mensajeCustom?: string;
      tituloPromo?: string;
      etiqueta?: string;
      pagoConcepto?: string;
      pagoMonto?: string;
      pagoReferencia?: string;
      costoInstalacion?: string;
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.empresaService.enviarEmailTemplate(id, body.tipo, {
      mensajeCustom: body.mensajeCustom,
      tituloPromo: body.tituloPromo,
      etiqueta: body.etiqueta,
      pagoConcepto: body.pagoConcepto,
      pagoMonto: body.pagoMonto,
      pagoReferencia: body.pagoReferencia,
      costoInstalacion: body.costoInstalacion,
    });
    res.locals.message = `Email enviado a ${result.enviados} administrador(es)`;
    return result;
  }

  @Post(':id/recordatorio-whatsapp')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async enviarRecordatorioWhatsapp(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.empresaService.enviarWhatsappRecordatorio(id);
    res.locals.message = `WhatsApp enviado a ${result.enviados} administrador(es)`;
    return result;
  }

  // ── Historial / Auditoría ──────────────────────────────────────────────────

  @Get(':id/log')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  listarLog(@Param('id', ParseIntPipe) id: number) {
    return this.empresaService.listarLog(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async eliminar(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.empresaService.eliminar(id);
    res.locals.message = 'Empresa eliminada correctamente';
    return result;
  }

  // ─── Cuentas Bancarias ──────────────────────────────────────────────────────
  // Estos endpoints DEBEN ir antes de @Get(':id') para evitar colisión de rutas

  @Get('cuentas-bancarias')
  @UseGuards(JwtAuthGuard)
  async listarCuentasBancarias(
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cuentas = await this.empresaService.listarCuentasBancarias(user.empresaId);
    res.locals.message = 'Cuentas bancarias obtenidas';
    return cuentas;
  }

  @Post('cuentas-bancarias')
  @UseGuards(JwtAuthGuard)
  async crearCuentaBancaria(
    @User() user: any,
    @Body() dto: CreateCuentaBancariaDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cuenta = await this.empresaService.crearCuentaBancaria(user.empresaId, dto);
    res.locals.message = 'Cuenta bancaria creada';
    return cuenta;
  }

  @Put('cuentas-bancarias/:id')
  @UseGuards(JwtAuthGuard)
  async actualizarCuentaBancaria(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCuentaBancariaDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cuenta = await this.empresaService.actualizarCuentaBancaria(user.empresaId, id, dto);
    res.locals.message = 'Cuenta bancaria actualizada';
    return cuenta;
  }

  @Delete('cuentas-bancarias/:id')
  @UseGuards(JwtAuthGuard)
  async eliminarCuentaBancaria(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.empresaService.eliminarCuentaBancaria(user.empresaId, id);
    res.locals.message = 'Cuenta bancaria desactivada';
    return null;
  }

  @Get('consultar-ruc/:ruc')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async consultarRuc(
    @Param('ruc') ruc: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!ruc || ruc.length !== 11) {
      throw new BadRequestException('RUC debe tener 11 dígitos');
    }
    const resultado = await this.empresaService.consultarRuc(ruc);
    res.locals.message = 'Consulta RUC realizada correctamente';
    return resultado;
  }

  @Get('proximas-vencer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async empresasProximasVencer(
    @Query('dias') dias: string = '7',
    @Res({ passthrough: true }) res: Response,
  ) {
    const diasAntes = parseInt(dias) || 7;
    const empresas =
      await this.empresaService.obtenerEmpresasProximasVencer(diasAntes);
    res.locals.message = `Empresas que vencen en ${diasAntes} días obtenidas correctamente`;
    return empresas;
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async obtenerPorId(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const empresa = await this.empresaService.obtenerPorId(id);
    res.locals.message = 'Empresa obtenida correctamente';
    return empresa;
  }
}
