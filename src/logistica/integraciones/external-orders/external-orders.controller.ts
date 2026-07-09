import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ExternalOrdersService } from './external-orders.service';
import { SandboxService } from '../sandbox/sandbox.service';
import { RateLimitsService } from '../rate-limits/rate-limits.service';
// import { ApiKeyAuthGuard } from '../api-keys/api-key-auth.guard'; // Assume this will exist

@Controller('v1/logistics/orders')
// @UseGuards(ApiKeyAuthGuard) // Protect all endpoints in this controller
export class ExternalOrdersController {
  constructor(
    private readonly ordersService: ExternalOrdersService,
    private readonly sandboxService: SandboxService,
    private readonly rateLimitsService: RateLimitsService,
  ) {}

  @Post()
  async createOrder(@Body() payload: any) {
    return this.ordersService.createOrder(payload);
  }

  @Post('bulk')
  async createBulkOrders(@Body() payload: any[]) {
    return this.ordersService.createBulkOrders(payload);
  }

  @Get()
  async getOrders(@Query() query: any) {
    return this.ordersService.getOrders(query);
  }

  @Get(':id/status')
  async getOrderStatus(@Param('id') id: string) {
    return this.ordersService.getOrderStatus(id);
  }

  @Post(':id/cancel')
  async cancelOrder(@Param('id') id: string) {
    return this.ordersService.cancelOrder(id);
  }
}

@Controller('v1/logistics/tracking')
export class TrackingController {
  constructor(private readonly ordersService: ExternalOrdersService) {}

  @Get(':id')
  async getTracking(@Param('id') id: string) {
    return this.ordersService.getTracking(id);
  }
}
