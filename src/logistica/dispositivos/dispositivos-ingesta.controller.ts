import { Controller, Post, Body } from '@nestjs/common';
import { DispositivosService } from './dispositivos.service';
import { IngestaPosicionDto } from './dto/ingesta-posicion.dto';

/**
 * Endpoint público (autenticado por token del dispositivo, no JWT) para que los
 * GPS/app de conductor reporten su ubicación.
 */
@Controller('logistica/gps')
export class DispositivosIngestaController {
  constructor(private readonly dispositivosService: DispositivosService) {}

  @Post('ingesta')
  ingestar(@Body() dto: IngestaPosicionDto) {
    return this.dispositivosService.ingestar(dto);
  }
}
