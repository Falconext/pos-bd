import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadoPagoService } from '../../mercadopago/mercadopago.service';
import { CobroEmpresaService } from '../../suscripcion/cobro-empresa.service';
import { MedidorApiService } from './medidor.service';
import { estaVencido } from './cobro-vencido';

/** Cómo viaja un cobro de la API en el `external_reference` de Mercado Pago. */
export const PREFIJO_COBRO_API = 'cobro-api-';

const URL_CONSOLA = () => (process.env.DEVELOPERS_URL || 'https://developers.krezka.com').replace(/\/$/, '');

/**
 * El cobro mensual de la API de facturación, del lado del integrador.
 *
 * El cierre del mes y el cobro pendiente ya existían (`MedidorApiService`):
 * el día 2 se congela el consumo y queda un `CobroEmpresa` por pagar. Lo que
 * faltaba es que el integrador lo vea y lo pueda pagar solo, sin escribirnos.
 *
 * El pago entra por el mismo `CobroEmpresaService.registrarPago` que usa el
 * panel cuando alguien paga por Yape: automático y manual dejan el mismo
 * rastro (cobro aplicado + ingreso en finanzas).
 */
@Injectable()
export class CobrosApiService implements OnModuleInit {
  private readonly logger = new Logger(CobrosApiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mp: MercadoPagoService,
    private readonly cobros: CobroEmpresaService,
  ) {}

  onModuleInit() {
    this.mp.registrarReceptor(PREFIJO_COBRO_API, (pago) => this.pagoRecibido(pago));
  }

  async listar(integradorId: number) {
    const filas = await this.prisma.cobroEmpresa.findMany({
      where: { empresaId: integradorId, concepto: MedidorApiService.CONCEPTO, estado: { not: 'ANULADO' } },
      orderBy: { periodo: 'desc' },
      take: 24,
    });
    return {
      object: 'list',
      online_payment: this.mp.plataformaConfigurada(),
      data: filas.map((c) => ({
        id: c.id,
        object: 'charge',
        period: c.periodo,
        description: c.descripcion,
        amount: Number(c.monto),
        currency: 'PEN',
        status: c.estado === 'APLICADO' ? 'paid' : 'pending',
        due_date: c.fechaVencimiento.toISOString().slice(0, 10),
        // Mismo criterio que el bloqueo de emisión: vencido desde el día siguiente (Lima).
        overdue: c.estado === 'PENDIENTE' && estaVencido(c.fechaVencimiento),
        paid_at: c.fechaCobro ?? undefined,
        payment_method: c.medioPago ?? undefined,
      })),
    };
  }

  private async cobroDe(integradorId: number, cobroId: number) {
    const c = await this.prisma.cobroEmpresa.findFirst({
      where: { id: cobroId, empresaId: integradorId, concepto: MedidorApiService.CONCEPTO },
    });
    if (!c) throw new NotFoundException('Ese cobro no existe.');
    return c;
  }

  /** El link de Mercado Pago para pagar un cobro pendiente. */
  async linkDePago(integradorId: number, cobroId: number) {
    const c = await this.cobroDe(integradorId, cobroId);
    if (c.estado === 'APLICADO') throw new ConflictException('Ese cobro ya está pagado.');
    if (c.estado !== 'PENDIENTE') throw new ConflictException('Ese cobro no se puede pagar.');
    const admin = await this.prisma.usuario.findFirst({
      where: { empresaId: integradorId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
      select: { email: true },
      orderBy: { id: 'asc' },
    });
    const volver = `${URL_CONSOLA()}/console/consumo?cobro=${c.id}`;
    const { initPoint } = await this.mp.crearCobroPlataforma({
      referencia: `${PREFIJO_COBRO_API}${c.id}`,
      titulo: `Krezka · API de facturación ${c.periodo}`,
      total: Number(c.monto),
      clienteEmail: admin?.email,
      backUrls: { success: volver, pending: volver, failure: volver },
    });
    return { url: initPoint };
  }

  /**
   * Confirma el pago al volver de Mercado Pago, sin esperar el webhook. Solo
   * aplica lo que Mercado Pago responda para la referencia de ESTE cobro.
   */
  async verificar(integradorId: number, cobroId: number, paymentId?: string) {
    const c = await this.cobroDe(integradorId, cobroId);
    if (c.estado === 'PENDIENTE') {
      const pagos = await this.mp.pagosPlataforma(`${PREFIJO_COBRO_API}${c.id}`, paymentId);
      const aprobado = pagos.find((p) => p?.status === 'approved');
      if (aprobado) await this.pagoRecibido(aprobado);
    }
    const ahora = await this.cobroDe(integradorId, cobroId);
    return { id: ahora.id, status: ahora.estado === 'APLICADO' ? 'paid' : 'pending' };
  }

  /** Un pago de Mercado Pago aprobado para un cobro de la API. Idempotente. */
  async pagoRecibido(pago: any) {
    if (pago?.status !== 'approved') return;
    const id = Number(String(pago.external_reference ?? '').slice(PREFIJO_COBRO_API.length));
    if (!Number.isInteger(id) || id <= 0) return;
    const c = await this.prisma.cobroEmpresa.findUnique({ where: { id } });
    if (!c || c.concepto !== MedidorApiService.CONCEPTO || c.estado !== 'PENDIENTE') return;

    // Un pago por menos de lo que se debe no salda el cobro: se deja anotado
    // para revisarlo a mano en vez de darlo por pagado.
    const pagado = Number(pago.transaction_amount ?? 0);
    if (pagado + 0.009 < Number(c.monto)) {
      this.logger.warn(`Pago MP ${pago.id} por S/ ${pagado} no cubre el cobro ${c.id} de S/ ${Number(c.monto)}`);
      return;
    }
    try {
      await this.cobros.registrarPago(c.id, {
        medioPago: 'MERCADO_PAGO',
        referencia: String(pago.id),
        monto: pagado,
        fechaCobro: pago.date_approved ? new Date(pago.date_approved) : new Date(),
      });
    } catch (e: any) {
      // Webhook y retorno pueden llegar a la vez: el segundo encuentra el cobro
      // ya aplicado, y eso está bien.
      if (!/ya figura como pagado/i.test(e?.message ?? '')) throw e;
    }
  }

  /** Avisa por correo al integrador que tiene un cobro nuevo. No falla el cierre. */
  async avisarCobroNuevo(integradorId: number, cobroId: number) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;
    try {
      const [c, admins] = await Promise.all([
        this.prisma.cobroEmpresa.findUnique({ where: { id: cobroId } }),
        this.prisma.usuario.findMany({
          where: { empresaId: integradorId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
          select: { email: true, nombre: true },
        }),
      ]);
      const correos = admins.map((a) => a.email).filter((e): e is string => !!e && /@/.test(e));
      if (!c || !correos.length) return;

      const monto = `S/ ${Number(c.monto).toFixed(2)}`;
      const vence = c.fechaVencimiento.toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
      const enlace = `${URL_CONSOLA()}/console/consumo`;
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:auto;color:#18181b">
          <h2 style="margin:0 0 12px">Tu consumo de ${c.periodo}</h2>
          <p>${c.descripcion ?? 'API de facturación'}.</p>
          <p style="font-size:28px;font-weight:600;margin:16px 0">${monto} <span style="font-size:14px;font-weight:400;color:#71717a">con IGV</span></p>
          <p>Vence el <strong>${vence}</strong>. Si no se paga ese día, desde el día siguiente se pausa la emisión de comprobantes hasta que se pague.</p>
          <p>Puedes ver el detalle y pagar con Mercado Pago desde tu consola:</p>
          <p><a href="${enlace}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver y pagar</a></p>
          <p style="color:#71717a;font-size:13px">Si prefieres pagar por transferencia o Yape, responde este correo.</p>
        </div>`;
      const { Resend } = await import('resend');
      const { error } = await new Resend(resendKey).emails.send({
        from: `Krezka <${process.env.RESEND_FROM_EMAIL || 'notificaciones@falconext.pe'}>`,
        to: correos,
        subject: `Krezka · Tu consumo de la API de ${c.periodo}: ${monto}`,
        html,
      });
      if (error) throw new Error(String((error as any)?.message ?? error));
    } catch (e: any) {
      this.logger.warn(`No se pudo avisar el cobro ${cobroId} al integrador ${integradorId}: ${e?.message}`);
    }
  }
}
