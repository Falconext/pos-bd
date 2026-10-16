import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhooksService } from '../../logistica/integraciones/webhooks/webhooks.service';
import { EstadoPublico, esFinal, estadoPublico } from './estado-publico';
import { serializarComprobante } from './serializador';

/**
 * Le avisa al integrador cuando cambia el estado de un comprobante suyo.
 *
 * **Por qué compara en vez de engancharse a la emisión.** El estado de un
 * comprobante se fija en tres lugares distintos del motor de envío, y además
 * lo mueven el scheduler cuando reintenta y la conciliación manual desde el
 * panel. Enganchar un aviso en cada uno significa tocar el código que factura
 * para 61 empresas, y significa que el día que aparezca un cuarto camino
 * —seguro aparece— los webhooks dejen de avisar en silencio justo en el caso
 * que más importa: el comprobante que SUNAT aceptó tarde.
 *
 * Así que no se engancha a nada. Guarda el último estado avisado y manda la
 * diferencia. Es idempotente, sobrevive a un reinicio y cubre todos los
 * caminos, incluidos los que todavía no existen.
 */
@Injectable()
export class AvisosFacturacionService {
  /** Lo que ya no va a cambiar solo: una vez avisado, el comprobante se deja. */
  private static readonly FINALES = ['accepted', 'observed', 'rejected', 'voided'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async barrer() {
    try {
      await this.avisarPendientes();
    } catch (e: any) {
      // Un cron que lanza se cae en silencio y deja de correr.
      console.error('[api-facturacion] el barrido de avisos falló:', e?.message);
    }
  }

  /**
   * Los candidatos son pocos a propósito y el conjunto se vacía solo: en
   * cuanto un comprobante llega a un estado final avisado, deja de mirarse.
   * Si no, la consulta crecería con todo el histórico y, ordenada por id, se
   * quedaría para siempre releyendo los 200 comprobantes más viejos sin
   * llegar nunca a los nuevos.
   *
   * La anulación es la excepción y tiene su propia condición. Para anular hay
   * que haber sido aceptado antes, así que un comprobante anulado SIEMPRE ya
   * salió del conjunto con `accepted` avisado. Sin esta línea, `invoice.voided`
   * no se enviaría nunca y el integrador jamás se enteraría de una baja — lo
   * encontró la QA funcional. Los anulados son pocos (271 en toda la base de
   * producción) y también drenan, así que no reabre el problema de tamaño.
   */
  async avisarPendientes(limite = 200): Promise<number> {
    const candidatos = await this.prisma.comprobante.findMany({
      where: {
        apiPublicId: { not: null },
        OR: [
          { apiEstadoNotificado: null },
          { apiEstadoNotificado: { notIn: AvisosFacturacionService.FINALES } },
          // La baja ocurre DESPUÉS de la aceptación, ya fuera del conjunto.
          {
            estadoEnvioSunat: 'ANULADO' as any,
            apiEstadoNotificado: { not: 'voided' },
          },
        ],
      },
      include: {
        cliente: { include: { tipoDocumento: { select: { codigo: true } } } },
        detalles: true,
        empresa: { select: { apiPublicId: true, integradorId: true } },
      },
      orderBy: { id: 'asc' },
      take: limite,
    });

    let avisados = 0;
    for (const c of candidatos as any[]) {
      const estado = estadoPublico(c);
      if (estado === null) continue;
      if (estado === c.apiEstadoNotificado) continue;

      // `pending` es el estado con el que nace: avisarlo sería contarle al
      // integrador lo que acaba de pedir. Se marca como avisado igual, para
      // no volver a mirarlo hasta que cambie de verdad.
      if (estado !== 'pending') {
        await this.entregar(c, estado);
        avisados++;
      }
      await this.prisma.comprobante.update({
        where: { id: c.id },
        data: { apiEstadoNotificado: estado },
      });
    }
    return avisados;
  }

  /**
   * El evento viaja al INTEGRADOR, no al emisor: es quien registró el
   * endpoint y quien tiene que reaccionar. El emisor es el dueño del RUC y no
   * necesariamente tiene integración.
   */
  private async entregar(c: any, estado: EstadoPublico) {
    if (!c.empresa?.integradorId) return;
    const cuerpo = serializarComprobante(c, c.empresa.apiPublicId);
    if (!cuerpo) return;
    await this.webhooks.dispatchEvent(
      c.empresa.integradorId,
      `invoice.${estado}`,
      cuerpo,
      'facturacion',
    );
  }

  /** Para las pruebas y para el panel: qué eventos puede recibir un endpoint. */
  static eventosPosibles(): string[] {
    return (['sent', 'accepted', 'observed', 'rejected', 'reconciling', 'voided'] as EstadoPublico[])
      .map((e) => `invoice.${e}`);
  }

  /** Expuesto para la QA: que `esFinal` y la lista no se separen con el tiempo. */
  static get finales(): string[] {
    return AvisosFacturacionService.FINALES.filter((e) => esFinal(e as EstadoPublico));
  }
}
