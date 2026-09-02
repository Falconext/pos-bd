import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShalomLatService } from './shalom-lat.service';
import { derivarEstadoShalom, ShalomDerivado } from './shalom.util';

export type { ShalomAgencia, ShalomOrderInput } from './shalom-lat.service';

/**
 * Servicio Shalom de falconext-mype. Todas las empresas usan el proveedor
 * api.shalom-api.lat (`ShalomLatService`), autenticado con una API key global:
 * tracking, agencias, comprobante, etiqueta y cotización NO requieren cuenta
 * Shalom Pro. El proveedor legacy (api.shalom-api-peru.com) quedó retirado.
 *
 * Los documentos (comprobante/etiqueta) se devuelven como `{ buffer, contentType }`
 * (la API nueva puede devolver PNG o PDF).
 */
@Injectable()
export class ShalomService {
  private readonly logger = new Logger(ShalomService.name);
  // El snapshot de tracking persistido se considera fresco durante 10 min: en
  // ese lapso el modal responde al instante sin volver a golpear a Shalom.
  private readonly TRACK_CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lat: ShalomLatService,
  ) {}

  // Toda falconext-mype usa el proveedor NUEVO (api.shalom-api.lat): tracking,
  // agencias, comprobante, etiqueta y cotización solo requieren la API key global
  // (sin cuenta Shalom Pro). El proveedor legacy (api.shalom-api-peru.com) quedó
  // retirado; `oseId` ya no se usa (la nueva API indexa por orderNumber+orderCode).
  async getAgencias(_empresaId?: number) {
    return this.lat.getAgencias();
  }

  async track(orderNumber: string, orderCode: string, empresaId?: number) {
    return this.lat.track(orderNumber, orderCode, empresaId);
  }

  async quote(origin: number, destination: number, _empresaId?: number) {
    return this.lat.quote(origin, destination);
  }

  async createOrder(body: any, _empresaId?: number) {
    return this.lat.createOrder(body);
  }

  async ticketImage(
    orderNumber: string,
    orderCode: string,
    _empresaId?: number,
    _oseId?: number | string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.lat.ticketImage(orderNumber, orderCode);
  }

  async label(
    orderNumber: string,
    orderCode: string,
    _empresaId?: number,
    _oseId?: number | string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.lat.label(orderNumber, orderCode);
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
