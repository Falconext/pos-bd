import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShalomLegacyService } from './shalom-legacy.service';
import { ShalomLatService } from './shalom-lat.service';

export type { ShalomAgencia, ShalomOrderInput } from './shalom-lat.service';

/**
 * Dispatcher de proveedores Shalom. Selecciona el cliente según la empresa:
 *
 *  - Empresas de un reseller (`empresa.resellerId != null`) → proveedor NUEVO
 *    (shalom-api.lat, `ShalomLatService`, auth por API key global).
 *  - Empresas directas de falconext-mype (`resellerId == null`) o sin empresa →
 *    proveedor ANTIGUO (api.shalom-api-peru.com, `ShalomLegacyService`, con
 *    credenciales Shalom Pro).
 *
 * Los documentos (comprobante/etiqueta) se normalizan a `{ buffer, contentType }`
 * (el legacy devuelve siempre PDF; el nuevo puede devolver PNG o PDF).
 */
@Injectable()
export class ShalomService {
  private readonly logger = new Logger(ShalomService.name);
  // Caché de la relación empresa→reseller (rara vez cambia en runtime).
  private esResellerCache = new Map<number, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly legacy: ShalomLegacyService,
    private readonly lat: ShalomLatService,
  ) {}

  /** True si la empresa pertenece a un reseller (usa el proveedor nuevo). */
  private async esReseller(empresaId?: number): Promise<boolean> {
    if (!empresaId) return false;
    const cached = this.esResellerCache.get(empresaId);
    if (cached !== undefined) return cached;
    const emp = await this.prisma.empresa
      .findUnique({ where: { id: empresaId }, select: { resellerId: true } })
      .catch(() => null);
    const esReseller = Boolean(emp?.resellerId);
    this.esResellerCache.set(empresaId, esReseller);
    this.logger.log(
      `Empresa ${empresaId} → proveedor Shalom ${esReseller ? 'NUEVO (shalom-api.lat)' : 'ANTIGUO (shalom-api-peru)'}`,
    );
    return esReseller;
  }

  async getAgencias(empresaId?: number) {
    return (await this.esReseller(empresaId))
      ? this.lat.getAgencias()
      : this.legacy.getAgencias();
  }

  async track(orderNumber: string, orderCode: string, empresaId?: number) {
    return (await this.esReseller(empresaId))
      ? this.lat.track(orderNumber, orderCode, empresaId)
      : this.legacy.track(orderNumber, orderCode, empresaId);
  }

  async quote(origin: number, destination: number, empresaId?: number) {
    return (await this.esReseller(empresaId))
      ? this.lat.quote(origin, destination)
      : this.legacy.quote(origin, destination);
  }

  async createOrder(body: any, empresaId?: number) {
    return (await this.esReseller(empresaId))
      ? this.lat.createOrder(body)
      : this.legacy.createOrder(body, empresaId);
  }

  async ticketImage(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
    oseId?: number | string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    if (await this.esReseller(empresaId)) {
      return this.lat.ticketImage(orderNumber, orderCode);
    }
    const buffer = await this.legacy.ticketImage(
      orderNumber,
      orderCode,
      empresaId,
      oseId,
    );
    return { buffer, contentType: 'application/pdf' };
  }

  async label(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
    oseId?: number | string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    if (await this.esReseller(empresaId)) {
      return this.lat.label(orderNumber, orderCode);
    }
    const buffer = await this.legacy.label(
      orderNumber,
      orderCode,
      empresaId,
      oseId,
    );
    return { buffer, contentType: 'application/pdf' };
  }
}
