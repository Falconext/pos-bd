import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhooksService } from '../../logistica/integraciones/webhooks/webhooks.service';
import { ErpApiService } from './erp.service';
import { ErpVentasService } from './erp-ventas.service';

/** Los estados que se avisan: los que cambian lo que la web tiene que hacer. */
export const EVENTOS_VENTA = ['sale.accepted', 'sale.observed', 'sale.rejected', 'sale.voided'] as const;
const AVISABLES = new Set(['accepted', 'observed', 'rejected', 'voided']);
/** A los 20 intentos fallidos (~10 minutos) se deja de insistir con esa venta. */
const MAX_INTENTOS = 20;
/** Solo se vigila lo reciente: una venta de hace un mes ya no cambia sola. */
const VENTANA_DIAS = 30;

/**
 * Avisos de la API de Krezka por webhook: que la web del negocio se entere
 * sola cuando SUNAT acepta, observa o rechaza una venta, o cuando se anula,
 * sin tener que preguntar con GET /sales/{id}.
 *
 * Mismo mecanismo que Facturación: firma HMAC-SHA256 en `Falconext-Signature`,
 * 3 intentos por barrido y, lo que no llega, se reintenta en el siguiente
 * barrido. Se guarda en la venta el último estado avisado, así que un mismo
 * estado no se avisa dos veces.
 */
@Injectable()
export class ErpAvisosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly erp: ErpApiService,
    private readonly ventas: ErpVentasService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async barrer() {
    try {
      await this.avisarPendientes();
    } catch (e: any) {
      // Un cron que lanza se cae en silencio y deja de correr.
      console.error('[api-erp] el barrido de avisos falló:', e?.message);
    }
  }

  /** Avisa los cambios de estado pendientes. Devuelve cuántos se entregaron. */
  async avisarPendientes(limite = 200): Promise<number> {
    const conEndpoints = await this.prisma.webhookEndpoint.findMany({
      where: { producto: 'erp', activo: true },
      select: { empresaId: true },
      distinct: ['empresaId'],
    });
    if (!conEndpoints.length) return 0;
    const desde = new Date(Date.now() - VENTANA_DIAS * 24 * 60 * 60 * 1000);
    const candidatas = await this.prisma.ventaApi.findMany({
      where: {
        empresaId: { in: conEndpoints.map((e) => e.empresaId) },
        creadoEn: { gte: desde },
        intentosAviso: { lt: MAX_INTENTOS },
        // Una aceptada todavía puede anularse; rechazada y anulada ya no cambian.
        OR: [{ estadoAvisado: null }, { estadoAvisado: { in: ['accepted', 'observed'] } }],
      },
      orderBy: { creadoEn: 'asc' },
      take: limite,
    });

    let entregados = 0;
    for (const v of candidatas) {
      const c = await this.ventas.comprobanteDe(v.comprobanteId);
      if (!c) continue;
      const venta = this.ventas.serializar(v, c);
      const estado = String(venta.status ?? '');
      if (!AVISABLES.has(estado) || estado === v.estadoAvisado) continue;
      const r = await this.webhooks.dispatchEvent(v.empresaId, `sale.${estado}`, venta, 'erp');
      // Sin nadie suscrito a ese evento no hay nada que reintentar.
      if (r.total === 0 || r.entregados > 0) {
        entregados += r.entregados;
        await this.prisma.ventaApi.update({ where: { id: v.id }, data: { estadoAvisado: estado, intentosAviso: 0 } });
      } else {
        await this.prisma.ventaApi.update({ where: { id: v.id }, data: { intentosAviso: { increment: 1 } } });
      }
    }
    return entregados;
  }

  // ── Endpoints de webhook (/v1/erp/webhook_endpoints) ────────────────

  async crearEndpoint(empresaId: number, body: any) {
    await this.erp.asegurarPlan(empresaId);
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException({ code: 'parameter_invalid', message: 'Manda { "url": "https://…", "events": ["sale.accepted"] }.', param: 'body' });
    }
    const desconocido = Object.keys(body).find((k) => !['url', 'events'].includes(k));
    if (desconocido) {
      throw new BadRequestException({ code: 'unknown_parameter', message: `\`${desconocido}\` no se puede enviar acá; solo \`url\` y \`events\`.`, param: desconocido });
    }
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!/^https:\/\/\S+$/i.test(url) || url.length > 500) {
      throw new BadRequestException({ code: 'parameter_invalid', message: '`url` tiene que ser una dirección https de tu servidor.', param: 'url' });
    }
    const eventos = body.events ?? [];
    if (!Array.isArray(eventos) || eventos.some((e: unknown) => !(EVENTOS_VENTA as readonly string[]).includes(String(e)))) {
      throw new BadRequestException({
        code: 'parameter_invalid',
        message: `\`events\` es una lista con: ${EVENTOS_VENTA.join(', ')}. Vacía = todos.`,
        param: 'events',
      });
    }
    const existentes = await this.prisma.webhookEndpoint.count({ where: { empresaId, producto: 'erp' } });
    if (existentes >= 5) {
      throw new BadRequestException({ code: 'limit_reached', message: 'Hasta 5 endpoints por negocio. Borra uno que no uses.', param: 'url' });
    }
    const creado = await this.webhooks.createEndpoint(empresaId, { url, events: eventos }, 'erp');
    return { object: 'webhook_endpoint', ...creado };
  }

  async listarEndpoints(empresaId: number) {
    await this.erp.asegurarPlan(empresaId);
    const lista = await this.webhooks.listEndpoints(empresaId, 'erp');
    return {
      object: 'list',
      data: lista.map((e) => ({ object: 'webhook_endpoint', id: e.id, url: e.url, events: e.events, active: e.activo, last_delivery_at: e.ultimoEnvioEn, created_at: e.creadoEn })),
      has_more: false,
    };
  }

  async borrarEndpoint(empresaId: number, id: string) {
    await this.erp.asegurarPlan(empresaId);
    const r = await this.prisma.webhookEndpoint.deleteMany({ where: { empresaId, producto: 'erp', endpointId: String(id) } });
    if (!r.count) throw new NotFoundException({ code: 'resource_missing', message: `No existe el endpoint ${id}.`, param: 'id' });
    return { object: 'webhook_endpoint', id, deleted: true };
  }

  /**
   * Manda un aviso de ejemplo, firmado igual que los reales, para que el
   * programador pruebe su receptor (y su verificación de firma) sin vender.
   */
  async probarEndpoint(empresaId: number, id: string) {
    await this.erp.asegurarPlan(empresaId);
    const e = await this.prisma.webhookEndpoint.findFirst({ where: { empresaId, producto: 'erp', endpointId: String(id) }, select: { url: true } });
    if (!e) throw new NotFoundException({ code: 'resource_missing', message: `No existe el endpoint ${id}.`, param: 'id' });
    const ejemplo = {
      object: 'sale',
      livemode: false,
      id: 'sale_ejemplo000000',
      external_id: 'WEB-PRUEBA',
      document_type: 'receipt',
      number: 'B001-1',
      status: 'accepted',
      total: 59,
      currency: 'PEN',
    };
    const r = await this.webhooks.dispatchEvent(empresaId, 'sale.accepted', ejemplo, 'erp', String(id));
    return {
      object: 'webhook_test',
      endpoint_id: id,
      url: e.url,
      delivered: r.entregados > 0,
      message: r.entregados > 0 ? 'Tu servidor respondió 2xx.' : 'Tu servidor no respondió 2xx en 3 intentos (5 s cada uno). Revisa que la URL sea pública y responda rápido.',
    };
  }
}
