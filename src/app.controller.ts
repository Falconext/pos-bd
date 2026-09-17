import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * GET /api/health — sonda ligera de la app móvil para distinguir "hay red"
   * de "hay internet y el backend responde" (modo offline-first). Sin auth.
   */
  @Get('health')
  health() {
    return { ok: true, ts: new Date().toISOString() };
  }
}
