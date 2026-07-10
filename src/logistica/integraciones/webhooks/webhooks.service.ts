import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Entrega REAL de un evento a todos los endpoints suscritos de la empresa.
   *
   * Busca los `WebhookEndpointLogistica` activos cuyos `eventos` incluyan el
   * evento (o que tengan la lista vacía = suscritos a todo) y hace un POST HTTP
   * firmado con HMAC-SHA256. Es **best-effort**: cada endpoint va en su propio
   * try/catch y NUNCA lanza al caller.
   *
   * Eventos válidos (7): order.created, order.assigned, order.picked_up,
   * order.in_transit, order.delivered, order.failed, order.returned.
   */
  async dispatchEvent(empresaId: number, event: string, order: any) {
    let endpoints: Array<{
      id: number;
      url: string;
      secret: string;
      eventos: string[];
    }> = [];
    try {
      endpoints = await this.prisma.webhookEndpointLogistica.findMany({
        where: { empresaId, activo: true },
        select: { id: true, url: true, secret: true, eventos: true },
      });
    } catch {
      return { entregados: 0, total: 0 };
    }

    // Filtra por suscripción: lista vacía = suscrito a todos los eventos.
    const suscritos = endpoints.filter(
      (e) =>
        !Array.isArray(e.eventos) ||
        e.eventos.length === 0 ||
        e.eventos.includes(event),
    );

    const t = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({
      id: `evt_${randomBytes(12).toString('hex')}`,
      type: event,
      created: t,
      data: order,
    });
    const orderId = String(order?.id ?? order?.tracking_code ?? '');

    // Reintentos con backoff: 3 intentos por endpoint (inmediato, +1s, +3s).
    // La firma se calcula una vez y se reusa (es el MISMO evento reintentado);
    // solo cambia el header Falconext-Attempt. El receptor deduplica por event id.
    const BACKOFF_MS = [0, 1000, 3000];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let entregados = 0;
    await Promise.all(
      suscritos.map(async (endpoint) => {
        const signature = createHmac('sha256', endpoint.secret)
          .update(`${t}.${rawBody}`)
          .digest('hex');

        for (let attempt = 1; attempt <= BACKOFF_MS.length; attempt++) {
          if (BACKOFF_MS[attempt - 1] > 0) await sleep(BACKOFF_MS[attempt - 1]);
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
              const res = await fetch(endpoint.url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Falconext-Event': event,
                  'Falconext-Order-Id': orderId,
                  'Falconext-Attempt': String(attempt),
                  'Falconext-Signature': `t=${t},v1=${signature}`,
                },
                body: rawBody,
                signal: controller.signal,
              });
              if (res.ok) {
                entregados += 1;
                await this.prisma.webhookEndpointLogistica
                  .update({
                    where: { id: endpoint.id },
                    data: { ultimoEnvioEn: new Date() },
                  })
                  .catch(() => undefined);
                return; // entregado: no más reintentos para este endpoint
              }
              // status no-2xx → reintenta si quedan intentos
            } finally {
              clearTimeout(timeout);
            }
          } catch {
            // red/timeout → reintenta si quedan intentos
          }
        }
      }),
    );

    return { entregados, total: suscritos.length };
  }

  /**
   * Registra y **persiste** un endpoint de webhook (fachada `WebhookEndpoint`).
   *
   * Genera un `secret` HMAC `whsec_…` que se devuelve UNA sola vez y se guarda
   * en `WebhookEndpointLogistica`. El `id` público (`we_…`) identifica el
   * endpoint en llamadas posteriores.
   */
  async createEndpoint(
    empresaId: number,
    payload: { url: string; events: string[] },
  ) {
    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new UnprocessableEntityException({
        code: 'parameter_invalid',
        message: 'El campo url es obligatorio y debe ser una URL http(s) válida.',
        param: 'url',
      });
    }
    const eventos = Array.isArray(payload?.events) ? payload.events : [];
    const endpointId = `we_${randomBytes(8).toString('hex')}`;
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const registro = await this.prisma.webhookEndpointLogistica.create({
      data: { empresaId, endpointId, url, eventos, secret },
    });
    return {
      id: registro.endpointId,
      url: registro.url,
      secret: registro.secret,
      events: registro.eventos,
    };
  }

  /** Lista los endpoints de webhook de la empresa (sin exponer el `secret`). */
  async listEndpoints(empresaId: number) {
    const registros = await this.prisma.webhookEndpointLogistica.findMany({
      where: { empresaId },
      select: {
        endpointId: true,
        url: true,
        eventos: true,
        activo: true,
        ultimoEnvioEn: true,
        creadoEn: true,
      },
      orderBy: { creadoEn: 'desc' },
    });
    return registros.map((r) => ({
      id: r.endpointId,
      url: r.url,
      events: r.eventos,
      activo: r.activo,
      ultimoEnvioEn: r.ultimoEnvioEn,
      creadoEn: r.creadoEn,
    }));
  }

  /**
   * Elimina un endpoint de webhook de la empresa (scoping por `empresaId`).
   * Acepta el id público `we_…`. Devuelve null si no le pertenece.
   */
  async deleteEndpoint(empresaId: number, id: string) {
    const { count } = await this.prisma.webhookEndpointLogistica.deleteMany({
      where: { empresaId, endpointId: id },
    });
    if (count === 0) return null;
    return { id, deleted: true };
  }
}
