import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import axios from 'axios';

export interface TipoCambioResponse {
  moneda: string;
  fecha: string;
  compra: number;
  venta: number;
}

@Injectable()
export class TipoCambioService {
  // Cache en memoria por fecha para no golpear la API en cada request.
  private readonly cache = new Map<string, TipoCambioResponse>();

  /**
   * Consulta el tipo de cambio USD -> PEN en apiperu.dev.
   * Si no se envía fecha, usa la fecha actual (zona America/Lima, forzada en main.ts).
   */
  async consultar(fecha?: string): Promise<TipoCambioResponse> {
    const fechaConsulta = this.normalizarFecha(fecha);

    const cacheada = this.cache.get(fechaConsulta);
    if (cacheada) return cacheada;

    const token = process.env.RENIEC_TOKEN;
    if (!token) {
      throw new BadRequestException('RENIEC_TOKEN no está configurado.');
    }

    try {
      const response = await axios.post(
        'https://apiperu.dev/api/tipo-de-cambio',
        { fecha: fechaConsulta },
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const data = response.data?.data;
      if (!data) {
        throw new ForbiddenException(
          response.data?.message ||
            'No se encontró tipo de cambio para la fecha indicada',
        );
      }

      const resultado: TipoCambioResponse = {
        moneda: data.moneda ?? 'USD',
        fecha: data.fecha_busqueda ?? data.date ?? fechaConsulta,
        compra: Number(data.compra ?? data.purchase),
        venta: Number(data.venta ?? data.sale),
      };

      this.cache.set(fechaConsulta, resultado);
      return resultado;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        throw new ForbiddenException(
          error.response?.data?.message ||
            error.message ||
            'Error al consultar el tipo de cambio',
        );
      }
      throw error;
    }
  }

  /** Valida/normaliza la fecha a formato yyyy-mm-dd. Por defecto, hoy. */
  private normalizarFecha(fecha?: string): string {
    if (!fecha) {
      // TZ está forzada a America/Lima en main.ts
      return new Date().toISOString().slice(0, 10);
    }
    const limpia = fecha.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(limpia)) {
      throw new BadRequestException(
        'La fecha debe tener el formato yyyy-mm-dd',
      );
    }
    return limpia;
  }
}
