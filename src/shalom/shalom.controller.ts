import { Controller, Get, Post, Body, Param, Res, UseGuards, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { ShalomService } from './shalom.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

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
    track(@Body() body: { orderNumber: string; orderCode: string }) {
        return this.service.track(body.orderNumber, body.orderCode);
    }

    @Post('quote')
    @HttpCode(200)
    quote(@Body() body: { origin: number; destination: number }) {
        return this.service.quote(body.origin, body.destination);
    }

    @Get('ticket/:orderNumber/:orderCode')
    async ticketImage(
        @Param('orderNumber') orderNumber: string,
        @Param('orderCode') orderCode: string,
        @Res() res: Response,
    ) {
        const buffer = await this.service.ticketImage(orderNumber, orderCode);
        res.set({ 'Content-Type': 'image/png', 'Content-Disposition': 'inline' });
        res.send(buffer);
    }

    @Get('label/:orderNumber/:orderCode')
    async label(
        @Param('orderNumber') orderNumber: string,
        @Param('orderCode') orderCode: string,
        @Res() res: Response,
    ) {
        const buffer = await this.service.label(orderNumber, orderCode);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="shalom-${orderNumber}.pdf"`,
        });
        res.send(buffer);
    }
}
