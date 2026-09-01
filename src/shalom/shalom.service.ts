import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShalomLegacyService } from './shalom-legacy.service';
import { ShalomLatService } from './shalom-lat.service';
import { derivarEstadoShalom, ShalomDerivado } from './shalom.util';

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
  // El snapshot de tracking persistido se considera fresco durante 10 min: en
  // ese lapso el modal responde al instante sin volver a golpear a Shalom.
  private readonly TRACK_CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly legacy: ShalomLegacyService,
    private readonly lat: ShalomLatService,
  ) {}

  /** Invalida la caché empresa→reseller (llamar al cambiar el reseller de una empresa). */
  invalidarResellerCache(empresaId?: number): void {
    if (empresaId) this.esResellerCache.delete(empresaId);
    else this.esResellerCache.clear();
  }

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

  // ─── Persistencia / caché de tracking ────────────────────────────────────

  /** Busca el EnvioDespacho asociado a una orden Shalom (por nº + clave). */
  private async buscarEnvio(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<{
    id: number;
    shalomEstado: string | null;
    shalomSyncAt: Date | null;
    shalomTrackingJson: any;
  } | null> {
    if (!orderNumber || !orderCode) return null;
    return this.prisma.envioDespacho
      .findFirst({
        where: {
          nroOrden: String(orderNumber),
          claveOrden: String(orderCode),
          ...(empresaId ? { comprobante: { empresaId } } : {}),
        },
        select: {
          id: true,
          shalomEstado: true,
          shalomSyncAt: true,
          shalomTrackingJson: true,
        },
        orderBy: { creadoEn: 'desc' },
      })
      .catch(() => null) as any;
  }

  /** Deriva el estado del snapshot y lo persiste en el EnvioDespacho. */
  private async persistir(envioId: number, trackData: any): Promise<ShalomDerivado> {
    const d = derivarEstadoShalom(trackData);
    await this.prisma.envioDespacho
      .update({
        where: { id: envioId },
        data: {
          shalomEstado: d.estado ?? undefined,
          shalomEntregado: d.entregado,
          shalomOseId: d.oseId ?? undefined,
          shalomTrackingJson: trackData ?? undefined,
          shalomSyncAt: new Date(),
        },
      })
      .catch((e) =>
        this.logger.warn(
          `No se pudo persistir tracking del envío ${envioId}: ${e?.message}`,
        ),
      );
    return d;
  }

  /**
   * Tracking con read-through cache: si hay snapshot persistido fresco (<10 min)
   * lo devuelve al instante; si no, consulta Shalom en vivo y lo persiste. Si el
   * upstream falla pero hay un snapshot previo (aunque viejo), lo devuelve con
   * `stale: true` en vez de fallar (resiliencia ante el scraper intermitente).
   */
  async trackConCache(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
    refresh = false,
  ): Promise<any> {
    const envio = await this.buscarEnvio(orderNumber, orderCode, empresaId);

    if (!refresh && envio?.shalomTrackingJson && envio.shalomSyncAt) {
      const edadMs = Date.now() - new Date(envio.shalomSyncAt).getTime();
      if (edadMs < this.TRACK_CACHE_TTL_MS) {
        return {
          ...(envio.shalomTrackingJson as any),
          cached: true,
          syncAt: envio.shalomSyncAt,
        };
      }
    }

    try {
      const fresco = await this.track(orderNumber, orderCode, empresaId);
      if (envio) await this.persistir(envio.id, fresco);
      return { ...fresco, cached: false, syncAt: new Date() };
    } catch (err) {
      // Fallback: devolver el último snapshot conocido si Shalom está caído.
      if (envio?.shalomTrackingJson) {
        this.logger.warn(
          `Shalom no respondió; devolviendo snapshot en caché del envío ${envio.id}`,
        );
        return {
          ...(envio.shalomTrackingJson as any),
          cached: true,
          stale: true,
          syncAt: envio.shalomSyncAt,
        };
      }
      throw err;
    }
  }

  /**
   * Refresca un envío contra Shalom y persiste el resultado. Devuelve el estado
   * previo y el derivado nuevo para que el scheduler decida si notificar.
   */
  async sincronizarEnvio(
    envioId: number,
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<{ estadoPrevio: string | null; derivado: ShalomDerivado }> {
    const previo = await this.prisma.envioDespacho
      .findUnique({ where: { id: envioId }, select: { shalomEstado: true } })
      .catch(() => null);
    const trackData = await this.track(orderNumber, orderCode, empresaId);
    const derivado = await this.persistir(envioId, trackData);
    return { estadoPrevio: previo?.shalomEstado ?? null, derivado };
  }
}
