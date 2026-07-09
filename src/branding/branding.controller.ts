import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BrandingService } from './branding.service';

@Controller('branding')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get('public')
  async getPublicBranding(
    @Query('host') host: string | undefined,
    @Query('resellerId') resellerId: string | undefined,
    @Headers('host') headerHost: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsedResellerId = resellerId ? parseInt(resellerId, 10) : NaN;
    const branding = !isNaN(parsedResellerId)
      ? await this.brandingService.getPublicBrandingByResellerId(
          parsedResellerId,
        )
      : await this.brandingService.getPublicBranding(host || headerHost);
    res.locals.message = 'Branding cargado';
    return branding;
  }
}
