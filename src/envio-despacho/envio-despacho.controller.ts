import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Query,
} from '@nestjs/common';
import { EnvioDespachoService } from './envio-despacho.service';

class ActualizarSaldoDto {
  saldo: number;
}
import {
  CreateEnvioDespachoDto,
  UpdateEnvioDespachoDto,
} from './dto/envio-despacho.dto';
import { DespachoConfigDto } from './dto/despacho-config.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('envio-despacho')
export class EnvioDespachoController {
  constructor(private readonly service: EnvioDespachoService) {}

  @Get()
  listAll(
    @User() user: any,
    @Query('estado') estado?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listByEmpresa(user.empresaId, {
      estado,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('config')
  getConfig(@User() user: any) {
    return this.service.getConfig(user.empresaId);
  }

  @Put('config')
  upsertConfig(@User() user: any, @Body() dto: DespachoConfigDto) {
    return this.service.upsertConfig(user.empresaId, dto);
  }

  @Get('panel')
  panel(
    @User() user: any,
    @Query('fecha') fecha?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.panelUnificado(user.empresaId, {
      fecha,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 100,
    });
  }

  @Get('comprobante/:comprobanteId')
  getByComprobante(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @User() user: any,
  ) {
    return this.service.getByComprobante(comprobanteId, user.empresaId);
  }

  @Post('comprobante/:comprobanteId')
  create(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() dto: CreateEnvioDespachoDto,
    @User() user: any,
  ) {
    return this.service.create(
      comprobanteId,
      user.empresaId,
      dto,
      user.id ?? undefined,
    );
  }

  @Patch('comprobante/:comprobanteId/upsert')
  upsert(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() dto: CreateEnvioDespachoDto,
    @User() user: any,
  ) {
    return this.service.upsert(
      comprobanteId,
      user.empresaId,
      dto,
      user.id ?? undefined,
    );
  }

  @Put('comprobante/:comprobanteId')
  update(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() dto: UpdateEnvioDespachoDto,
    @User() user: any,
  ) {
    return this.service.update(
      comprobanteId,
      user.empresaId,
      dto,
      user.id ?? undefined,
    );
  }

  @Patch('comprobante/:comprobanteId/confirmar-pago')
  confirmarPago(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @User() user: any,
  ) {
    return this.service.confirmarPago(comprobanteId, user.empresaId);
  }

  @Patch('comprobante/:comprobanteId/actualizar-saldo')
  actualizarSaldo(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() body: ActualizarSaldoDto,
    @User() user: any,
  ) {
    return this.service.actualizarSaldo(
      comprobanteId,
      user.empresaId,
      body.saldo,
    );
  }

  @Delete('comprobante/:comprobanteId')
  remove(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @User() user: any,
  ) {
    return this.service.remove(comprobanteId, user.empresaId);
  }
}
