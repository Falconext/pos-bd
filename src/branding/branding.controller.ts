import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BrandingService } from './branding.service';

@Controller('branding')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get('public')
  async getPublicBranding(
    @Query('host') host: string | undefined,
    @Headers('host') headerHost: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const branding = await this.brandingService.getPublicBranding(host || headerHost);
    res.locals.message = 'Branding cargado';
    return branding;
  }
}

