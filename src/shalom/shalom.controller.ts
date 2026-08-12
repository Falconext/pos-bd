import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ShalomService } from './shalom.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';

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
    @Body() body: { orderNumber: string; orderCode: string },
    @User() user: any,
  ) {
    return this.service.track(body.orderNumber, body.orderCode, user?.empresaId);
  }

  @Post('quote')
  @HttpCode(200)
  quote(
    @Body() body: { origin: number; destination: number },
    @User() user: any,
  ) {
    return this.service.quote(body.origin, body.destination, user?.empresaId);
  }

  @Post('orders')
  @HttpCode(200)
  createOrder(@Body() body: any, @User() user: any) {
    return this.service.createOrder(body, user?.empresaId);
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
