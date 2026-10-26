import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { LeadsPedidoService } from './leads-pedido.service';
import { LeadsEmbudoService } from './leads-embudo.service';
import {
  DEBOUNCE_RESPUESTA_MS,
  JOB_RESPONDER,
  LEADS_MESSAGES_QUEUE,
} from './leads.constants';

/** external_reference de los cobros del chat: `lead-<conversación>-<ms>`. */
export const PREFIJO_LINK_LEAD = 'lead-';

/** Mercado Pago rechaza cobros menores (error 2072), igual que en la tienda. */
export const MONTO_MINIMO_MP = 5;

/**
 * Cobrar por link de Mercado Pago desde el chat (21-10).
 *
 * Hasta ahora el cliente yapeaba, mandaba la captura y una persona la
 * validaba: el paso más lento de la venta y donde se coló el Yape de S/ 500 a
 * otra cuenta. Con el link, el que confirma el pago es Mercado Pago, y el
 * dinero entra a la cuenta del negocio.
 *
 * Es opcional por empresa (`cobroConLink` en iaVentasConfigJson) porque
 * Mercado Pago cobra comisión: hay dueños que prefieren el Yape aunque haya
 * que revisarlo. Y exige que la empresa tenga su Mercado Pago conectado.
 *
 * El pago confirmado entra por el mismo camino que un voucher —un
 * LeadComprobantePago, ya validado—, así que todo lo que viene después
 * (adelanto en la nota, cobro del despacho, bajo reserva) funciona igual.
 */
@Injectable()
export class LeadsPagoLinkService implements OnModuleInit {
  private readonly logger = new Logger(LeadsPagoLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mp: MercadoPagoService,
    private readonly pedido: LeadsPedidoService,
    private readonly embudo: LeadsEmbudoService,
    private readonly notificaciones: NotificacionesService,
    @InjectQueue(LEADS_MESSAGES_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    this.mp.registrarReceptor(PREFIJO_LINK_LEAD, (pago) => this.pagoRecibido(pago));
  }

  /** ¿Esta empresa cobra por link? Lo eligió y tiene Mercado Pago conectado. */
  async activo(empresaId: number): Promise<boolean> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true },
    });
    const cfg = (empresa?.iaVentasConfigJson ?? {}) as { cobroConLink?: boolean };
    if (cfg.cobroConLink !== true) return false;
    return this.mp.estaConectada(empresaId);
  }

  /**
   * El link para lo que el cliente tiene cotizado. Sin `monto` cobra todo lo
   * que falta; con `monto` (reserva o adelanto que fija el negocio) cobra
   * eso, sin pasar de lo que falta.
   */
  async generarLink(
    empresaId: number,
    conversacionId: number,
    monto?: number,
  ): Promise<Record<string, unknown>> {
    if (!(await this.activo(empresaId))) {
      return {
        noDisponible:
          'Este negocio no cobra con link de pago. Pídele el pago con los medios de pago del contexto (Yape, transferencia) y que mande la captura por aquí.',
      };
    }
    const cuenta = await this.pedido.porPagarDelPedido(empresaId, conversacionId);
    if ('error' in cuenta) return { error: cuenta.error };
    if (!(cuenta.porPagar > 0)) {
      return { error: 'El cliente ya pagó todo lo cotizado: no hay nada que cobrar.' };
    }
    const pedido = monto != null && Number(monto) > 0
      ? Math.round(Number(monto) * 100) / 100
      : cuenta.porPagar;
    if (pedido > cuenta.porPagar + 0.01) {
      return {
        error: `El monto (S/ ${pedido.toFixed(2)}) es mayor a lo que falta pagar (S/ ${cuenta.porPagar.toFixed(2)}). Genera el link sin monto para cobrar el total, o con el adelanto que corresponda.`,
      };
    }
    if (pedido < MONTO_MINIMO_MP) {
      return {
        error: `Mercado Pago no acepta cobros menores a S/ ${MONTO_MINIMO_MP}. Pídele ese pago por Yape o transferencia con los medios de pago del contexto.`,
      };
    }

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nombreComercial: true, razonSocial: true },
    });
    const negocio = (empresa?.nombreComercial || empresa?.razonSocial || '').trim();
    try {
      const { initPoint } = await this.mp.crearCobro({
        empresaId,
        referencia: `${PREFIJO_LINK_LEAD}${conversacionId}-${Date.now()}`,
        titulo: negocio ? `Pedido ${negocio}` : 'Pedido',
        total: pedido,
        metadata: { empresaId, conversacionId, origen: 'ia-ventas' },
      });
      return {
        link: initPoint,
        monto: pedido,
        esTotal: Math.abs(pedido - cuenta.porPagar) < 0.01,
        instruccion:
          'Mándale este link tal cual para que pague con tarjeta o con su cuenta de Mercado Pago. ' +
          'NO le digas que su pago está confirmado: cuando Mercado Pago lo confirme, el sistema te avisa en esta conversación. ' +
          'Si prefiere Yape o transferencia, también vale: dale los medios de pago del contexto.',
      };
    } catch (e) {
      this.logger.warn(
        `Lead: no se pudo crear el link de pago (conv ${conversacionId}): ${(e as Error).message}`,
      );
      return {
        error:
          'No se pudo generar el link de pago. Pídele el pago por Yape o transferencia con los medios de pago del contexto.',
      };
    }
  }

  /**
   * Mercado Pago avisó un pago de un link del chat. Idempotente: MP reintenta
   * la misma notificación, y el id del pago se usa como id del mensaje.
   */
  async pagoRecibido(pago: any): Promise<void> {
    const ref = String(pago?.external_reference ?? '');
    const conversacionId = Number(/^lead-(\d+)-/.exec(ref)?.[1]);
    if (!conversacionId) return;
    if (pago.status !== 'approved') {
      this.logger.log(
        `Link de pago MP ${pago.id} (conv ${conversacionId}) en estado ${pago.status}`,
      );
      return;
    }
    const conv = await this.prisma.leadConversacion.findUnique({
      where: { id: conversacionId },
      select: { id: true, empresaId: true, telefonoProspecto: true },
    });
    if (!conv) return;
    // El pago tiene que haber entrado a la cuenta de ESTA empresa: el
    // external_reference lo arma cualquiera que cree una preferencia.
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: conv.empresaId },
      select: { mpUserId: true },
    });
    if (
      pago.collector_id != null &&
      empresa?.mpUserId &&
      String(pago.collector_id) !== String(empresa.mpUserId)
    ) {
      this.logger.warn(
        `Link de pago MP ${pago.id}: cobrado por ${pago.collector_id}, no por la empresa ${conv.empresaId}. Se ignora.`,
      );
      return;
    }
    const operacion = String(pago.id);
    const ya = await this.prisma.leadComprobantePago.count({
      where: { conversacionId, operacionLeida: operacion },
    });
    if (ya > 0) return;

    const monto = Math.round(Number(pago.transaction_amount ?? 0) * 100) / 100;
    const pagador =
      [pago.payer?.first_name, pago.payer?.last_name].filter(Boolean).join(' ').trim() ||
      null;
    const registro = await this.embudo.registrarComprobantePago(
      conv.empresaId,
      conversacionId,
      {
        nota: 'Pagado con el link de Mercado Pago',
        leido: {
          monto,
          numeroOperacion: operacion,
          fecha: pago.date_approved ?? null,
          medio: 'Mercado Pago',
          pagador,
        },
      },
    );
    // Lo confirmó Mercado Pago: no hay captura que revisar.
    if (registro.registrado && registro.pago) {
      const borrador = await this.prisma.leadPedidoBorrador.findUnique({
        where: { conversacionId },
        select: { comprobanteId: true },
      });
      await this.embudo
        .validarPago(
          registro.pago.id,
          conv.empresaId,
          { nombre: 'Mercado Pago' },
          Boolean(borrador?.comprobanteId),
        )
        .catch((e: unknown) =>
          this.logger.warn(
            `Link de pago MP ${operacion}: no se pudo validar: ${(e as Error).message}`,
          ),
        );
    }

    await this.notificaciones
      .notificarAdminsEmpresa({
        empresaId: conv.empresaId,
        tipo: 'INFO',
        titulo: `💳 Pago con Mercado Pago: S/ ${monto.toFixed(2)}`,
        mensaje: [
          `Un cliente pagó S/ ${monto.toFixed(2)} con el link de Mercado Pago del chat (operación ${operacion}).`,
          'Ya quedó validado: no hace falta revisar captura.',
          '',
          `WhatsApp: ${conv.telefonoProspecto}`,
        ].join('\n'),
        metaData: {
          origen: 'ia-ventas-pago',
          conversacionId,
          telefono: conv.telefonoProspecto,
        },
      })
      .catch(() => undefined);

    // Se le cuenta al modelo como un mensaje del cliente, igual que el
    // voucher leído, y se programa la respuesta: así el agente le confirma
    // el pago y sigue con el pedido (pedir lo que falte, registrarlo).
    try {
      await this.prisma.leadMensaje.create({
        data: {
          conversacionId,
          rol: 'USUARIO',
          contenido:
            `[Mercado Pago confirmó que el cliente pagó S/ ${monto.toFixed(2)} con el link (operación ${operacion}). ` +
            'Agradécele y confírmale el pago. Si su pedido todavía no está registrado, sigue con lo que falte para registrarlo; si ya lo está, dile que lo preparamos.]',
          whatsappMsgId: `mp-${operacion}`,
          esAudio: false,
        },
      });
    } catch {
      // El mismo pago ya se avisó (reintento de MP).
      return;
    }
    await this.queue.add(
      JOB_RESPONDER,
      { empresaId: conv.empresaId, conversacionId },
      {
        jobId: `resp-${conv.empresaId}-${conversacionId}-mp-${operacion}`,
        delay: DEBOUNCE_RESPUESTA_MS,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log(
      `Link de pago MP ${operacion}: S/ ${monto.toFixed(2)} en la conv ${conversacionId}.`,
    );
  }
}
