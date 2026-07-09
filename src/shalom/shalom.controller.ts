import { Controller, Get, Post, Body, Param, Res, UseGuards, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { ShalomService, ShalomOrderInput } from './shalom.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('shalom')
export class ShalomController {
    constructor(private readonly service: ShalomService) {}

    @Get('agencias')
    getAgencias() {
        return this.service.getAgencias();
    }

    @Post('track')
    @HttpCode(200)
    track(@Body() body: { orderNumber: string; orderCode: string }, @User() user: any) {
        return this.service.track(body.orderNumber, body.orderCode, user?.empresaId);
    }

    @Post('quote')
    @HttpCode(200)
    quote(@Body() body: { origin: number; destination: number }) {
        return this.service.quote(body.origin, body.destination);
    }

    @Post('orders')
    @HttpCode(200)
    createOrder(@Body() body: ShalomOrderInput, @User() user: any) {
        return this.service.createOrder(body, user?.empresaId);
    }

    @Get('ticket/:orderNumber/:orderCode')
    async ticketImage(
        @Param('orderNumber') orderNumber: string,
        @Param('orderCode') orderCode: string,
        @User() user: any,
        @Res() res: Response,
    ) {
        // El nuevo proveedor entrega el comprobante como PDF (voucher), no PNG.
        const buffer = await this.service.ticketImage(orderNumber, orderCode, user?.empresaId);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="shalom-voucher-${orderNumber}.pdf"`,
        });
        res.send(buffer);
    }

    @Get('label/:orderNumber/:orderCode')
    async label(
        @Param('orderNumber') orderNumber: string,
        @Param('orderCode') orderCode: string,
        @User() user: any,
        @Res() res: Response,
    ) {
        const buffer = await this.service.label(orderNumber, orderCode, user?.empresaId);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="shalom-${orderNumber}.pdf"`,
        });
        res.send(buffer);
    }
}
