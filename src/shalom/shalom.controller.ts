import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  HttpCode,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ShalomService } from './shalom.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';
import {
  ConectarInstanciaDto,
  ConfigInstanciaDto,
  CrearGuiaDto,
} from './dto/shalom.dto';

@UseGuards(JwtAuthGuard)
@Controller('shalom')
export class ShalomController {
  constructor(private readonly service: ShalomService) {}

  @Get('agencias')
  getAgencias(@User() user: any) {
    return this.service.getAgencias(user?.empresaId);
  }

  @Post('track')
  @HttpCode(200)
  track(
    @Body() body: { orderNumber: string; orderCode: string; refresh?: boolean },
    @Query('refresh') refreshQuery: string | undefined,
    @User() user: any,
  ) {
    // Read-through cache: responde al instante desde el snapshot persistido y
    // solo golpea a Shalom si está viejo (>10 min) o se pide `refresh`.
    const refresh = body?.refresh === true || refreshQuery === '1';
    return this.service.trackConCache(
      body.orderNumber,
      body.orderCode,
      user?.empresaId,
      refresh,
    );
  }

  @Post('quote')
  @HttpCode(200)
  quote(
    @Body() body: { origin: number; destination: number },
    @User() user: any,
  ) {
    return this.service.quote(body.origin, body.destination, user?.empresaId);
  }

  // ─── Cuenta Shalom Pro (característica `tieneShalomGuias` del plan) ───────
  // El rastreo funciona para todos con la API key global; crear guías exige la
  // cuenta Shalom Pro del negocio conectada como instancia en el proveedor.

  @Get('instancia')
  getInstancia(@User() user: any) {
    return this.service.getInstancia(user.empresaId);
  }

  @Post('instancia')
  @HttpCode(200)
  conectarInstancia(@Body() dto: ConectarInstanciaDto, @User() user: any) {
    return this.service.conectarInstancia(user.empresaId, dto);
  }

  @Patch('instancia')
  actualizarInstancia(@Body() dto: ConfigInstanciaDto, @User() user: any) {
    return this.service.actualizarConfigInstancia(user.empresaId, dto);
  }

  @Post('instancia/reconectar')
  @HttpCode(200)
  reconectarInstancia(@User() user: any) {
    return this.service.reconectarInstancia(user.empresaId);
  }

  @Delete('instancia')
  desconectarInstancia(@User() user: any) {
    return this.service.desconectarInstancia(user.empresaId);
  }

  // Productos disponibles para la empresa (derivados de su propia cuenta).
  @Get('productos')
  productos(@User() user: any) {
    return this.service.productos(user.empresaId);
  }

  @Get('pendientes')
  pendientes(@User() user: any) {
    return this.service.pendientes(user.empresaId);
  }

  // Genera la guía en Shalom Pro desde el despacho del comprobante y guarda el
  // N° de orden / clave devueltos (lo que el rastreo necesita después).
  @Post('guia/:comprobanteId')
  @HttpCode(200)
  crearGuia(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() dto: CrearGuiaDto,
    @User() user: any,
  ) {
    return this.service.crearGuiaDesdeDespacho(
      comprobanteId,
      user.empresaId,
      dto,
    );
  }

  // Comprobante del envío. El proveedor selecciona el formato: el antiguo
  // (falconext-mype) devuelve PDF; el nuevo (resellers) devuelve PNG. Se reenvía
  // el Content-Type real que devuelve Shalom.
  @Get('ticket/:orderNumber/:orderCode')
  async ticketImage(
    @Param('orderNumber') orderNumber: string,
    @Param('orderCode') orderCode: string,
    @Query('oseId') oseId: string | undefined,
    @User() user: any,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.ticketImage(
      orderNumber,
      orderCode,
      user?.empresaId,
      oseId,
    );
    const ext = contentType.includes('png') ? 'png' : 'pdf';
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="shalom-voucher-${orderNumber}.${ext}"`,
    });
    res.send(buffer);
  }

  // Etiqueta / rótulo del envío.
  @Get('label/:orderNumber/:orderCode')
  async label(
    @Param('orderNumber') orderNumber: string,
    @Param('orderCode') orderCode: string,
    @Query('oseId') oseId: string | undefined,
    @User() user: any,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.label(
      orderNumber,
      orderCode,
      user?.empresaId,
      oseId,
    );
    const ext = contentType.includes('png') ? 'png' : 'pdf';
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="shalom-${orderNumber}.${ext}"`,
    });
    res.send(buffer);
  }
}
