import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadoPagoService } from '../../mercadopago/mercadopago.service';
import { CobroEmpresaService } from '../../suscripcion/cobro-empresa.service';
import { ComprobanteService } from '../../comprobante/comprobante.service';
import { FacturacionApiService } from './facturacion.service';
import { MedidorApiService } from './medidor.service';
import { estaVencido, finDelDiaLima } from './cobro-vencido';

/** Cómo viaja un cobro de la API en el `external_reference` de Mercado Pago. */
export const PREFIJO_COBRO_API = 'cobro-api-';

/** A nombre de quién se factura el consumo (`Empresa.datosFacturacion`). */
export interface DatosFacturacion {
  tipo: 'ruc' | 'dni';
  numero: string;
  nombre: string;
  direccion?: string;
  email?: string;
}

const URL_CONSOLA = () => (process.env.DEVELOPERS_URL || 'https://developers.krezka.com').replace(/\/$/, '');
const DIA_MS = 24 * 60 * 60 * 1000;
const fechaLima = (d: Date) => d.toLocaleDateString('es-PE', { timeZone: 'America/Lima' });

/**
 * El cobro mensual de la API de facturación, del lado del integrador.
 *
 * El cierre del mes y el cobro pendiente ya existían (`MedidorApiService`):
 * el día 2 se congela el consumo y queda un `CobroEmpresa` por pagar. Esto le
 * permite al integrador verlo y pagarlo solo, le emite la factura del pago y
 * le avisa antes de que venza y cuando se pausa la emisión.
 *
 * El pago entra por el mismo `CobroEmpresaService.registrarPago` que usa el
 * panel cuando alguien paga por Yape: automático y manual dejan el mismo
 * rastro (cobro aplicado + ingreso en finanzas + factura).
 */
@Injectable()
export class CobrosApiService implements OnModuleInit {
  private readonly logger = new Logger(CobrosApiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mp: MercadoPagoService,
    private readonly cobros: CobroEmpresaService,
    private readonly facturacion: FacturacionApiService,
    private readonly comprobantes: ComprobanteService,
  ) {}

  onModuleInit() {
    this.mp.registrarReceptor(PREFIJO_COBRO_API, (pago) => this.pagoRecibido(pago));
    this.cobros.registrarAlPagar(async (c) => {
      if (c.concepto === MedidorApiService.CONCEPTO) await this.despuesDelPago(c.id);
    });
  }

  // ── Lo que ve el integrador ──────────────────────────────────────────

  async listar(integradorId: number) {
    const filas = await this.prisma.cobroEmpresa.findMany({
      where: { empresaId: integradorId, concepto: MedidorApiService.CONCEPTO, estado: { not: 'ANULADO' } },
      orderBy: { periodo: 'desc' },
      take: 24,
    });
    const ids = filas.map((c) => c.comprobanteId).filter((x): x is number => !!x);
    const facturas = ids.length
      ? await this.prisma.comprobante.findMany({ where: { id: { in: ids } }, select: { id: true, serie: true, correlativo: true } })
      : [];
    const numero = (id: number | null) => {
      const f = facturas.find((x) => x.id === id);
      return f ? `${f.serie}-${String(f.correlativo).padStart(8, '0')}` : undefined;
    };
    const empresa = await this.prisma.empresa.findUnique({ where: { id: integradorId }, select: { datosFacturacion: true } });
    return {
      object: 'list',
      online_payment: this.mp.plataformaConfigurada(),
      billing_details_complete: !!CobrosApiService.datosValidos(empresa?.datosFacturacion),
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
        invoice_number: numero(c.comprobanteId),
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
    const empresa = await this.prisma.empresa.findUnique({ where: { id: integradorId }, select: { datosFacturacion: true } });
    const datos = CobrosApiService.datosValidos(empresa?.datosFacturacion);
    // Sin estos datos el pago entra pero la factura no se puede emitir: se
    // piden antes, no después, cuando ya habría que perseguir al cliente.
    if (!datos) {
      throw new BadRequestException('Antes de pagar, completa tus datos de facturación (RUC o DNI) para emitirte la factura.');
    }
    const volver = `${URL_CONSOLA()}/console/consumo?cobro=${c.id}`;
    const { initPoint } = await this.mp.crearCobroPlataforma({
      referencia: `${PREFIJO_COBRO_API}${c.id}`,
      titulo: `Krezka · API de facturación ${c.periodo}`,
      total: Number(c.monto),
      clienteEmail: datos.email || (await this.correos(integradorId))[0],
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

  /** El PDF de la factura que Krezka emitió por un cobro pagado. */
  async pdfFactura(integradorId: number, cobroId: number) {
    const c = await this.cobroDe(integradorId, cobroId);
    if (!c.comprobanteId) throw new NotFoundException('Este cobro todavía no tiene factura.');
    const f = await this.prisma.comprobante.findUnique({ where: { id: c.comprobanteId }, select: { serie: true, correlativo: true } });
    const { buffer } = await this.comprobantes.generarBufferPdf(c.comprobanteId, 'a4' as any);
    return {
      buffer,
      filename: `Krezka-${f?.serie}-${String(f?.correlativo ?? 0).padStart(8, '0')}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── El pago ──────────────────────────────────────────────────────────

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

  /**
   * Lo que pasa después de cualquier pago de un cobro de la API, venga de
   * Mercado Pago o de un Yape registrado a mano: la factura y el correo.
   */
  async despuesDelPago(cobroId: number) {
    const numero = await this.facturarPago(cobroId);
    const c = await this.prisma.cobroEmpresa.findUnique({ where: { id: cobroId } });
    if (!c) return;
    await this.enviarCorreo(
      c.empresaId,
      `Krezka · Recibimos tu pago de ${c.periodo}`,
      `<h2 style="margin:0 0 12px">¡Gracias! Recibimos tu pago</h2>
       <p>Pagaste <strong>S/ ${Number(c.monto).toFixed(2)}</strong> por el consumo de la API de facturación de ${c.periodo}.</p>
       ${numero ? `<p>Te emitimos el comprobante <strong>${numero}</strong>; lo puedes descargar desde tu consola.</p>` : ''}
       ${this.boton('Ver en la consola', `${URL_CONSOLA()}/console/consumo`)}`,
    );
  }

  /**
   * Emite la factura (o boleta, si factura a un DNI) que Krezka le hace al
   * integrador por el pago. Una sola vez por cobro.
   *
   * La empresa que emite se configura con `PLATAFORMA_FACTURA_EMPRESA_ID`:
   * sin eso no se emite nada y queda en el log, porque emitir a nombre de la
   * empresa equivocada sería peor que no emitir.
   */
  async facturarPago(cobroId: number): Promise<string | null> {
    const c = await this.prisma.cobroEmpresa.findUnique({ where: { id: cobroId } });
    if (!c || c.estado !== 'APLICADO' || c.concepto !== MedidorApiService.CONCEPTO) return null;
    if (c.comprobanteId) return null;

    const emisorId = Number(process.env.PLATAFORMA_FACTURA_EMPRESA_ID);
    if (!Number.isInteger(emisorId) || emisorId <= 0) {
      this.logger.warn(`Cobro ${c.id} pagado sin factura: falta PLATAFORMA_FACTURA_EMPRESA_ID.`);
      return null;
    }
    const empresa = await this.prisma.empresa.findUnique({ where: { id: c.empresaId }, select: { datosFacturacion: true } });
    const datos = CobrosApiService.datosValidos(empresa?.datosFacturacion);
    if (!datos) {
      this.logger.warn(`Cobro ${c.id} pagado sin factura: el integrador ${c.empresaId} no tiene datos de facturación.`);
      return null;
    }

    // El subtotal sale del consumo congelado: es el mismo con que se calculó el
    // total, así la factura suma exactamente lo que se cobró.
    const consumo = await this.prisma.consumoApiMes.findUnique({
      where: { integradorId_periodo: { integradorId: c.empresaId, periodo: c.periodo } },
      select: { subtotal: true, cantidad: true },
    });
    const subtotal = consumo?.subtotal ?? Math.round((Number(c.monto) / 1.18) * 100) / 100;
    const detalle = consumo ? ` (${consumo.cantidad.toLocaleString('es-PE')} comprobantes)` : '';

    const emitido = await this.facturacion.emitirComoPlataforma(emisorId, {
      document_type: datos.tipo === 'ruc' ? 'invoice' : 'receipt',
      currency: 'PEN',
      customer: {
        document_type: datos.tipo,
        document_number: datos.numero,
        name: datos.nombre,
        ...(datos.direccion ? { address: datos.direccion } : {}),
        ...(datos.email ? { email: datos.email } : {}),
      } as any,
      items: [
        {
          description: `Servicio de API de facturación electrónica — ${c.periodo}${detalle}`,
          quantity: 1,
          unit: 'ZZ',
          unit_value: subtotal,
        } as any,
      ],
      external_id: `${PREFIJO_COBRO_API}${c.id}`,
    });
    await this.prisma.cobroEmpresa.update({ where: { id: c.id }, data: { comprobanteId: emitido.id } });
    return emitido.numero;
  }

  // ── Recordatorios ────────────────────────────────────────────────────

  /**
   * Todos los días a las 9 a. m. de Lima: el recordatorio 3 días antes de
   * vencer y el aviso de que se pausó la emisión. Cada correo sale una sola
   * vez: la marca se pone ANTES de mandarlo, con la condición de que siga en
   * null, así dos backends corriendo el cron no lo mandan dos veces.
   *
   * Se apaga con COBROS_API_AVISOS_ENABLED=false (para backends locales).
   */
  @Cron('0 14 * * *')
  async recordatorios(ahora: Date = new Date()) {
    if (process.env.COBROS_API_AVISOS_ENABLED === 'false') return { previos: 0, bloqueos: 0 };
    const pendientes = await this.prisma.cobroEmpresa.findMany({
      where: {
        concepto: MedidorApiService.CONCEPTO,
        estado: 'PENDIENTE',
        OR: [{ avisoPrevioEn: null }, { avisoBloqueoEn: null }],
      },
    });
    let previos = 0;
    let bloqueos = 0;
    for (const c of pendientes) {
      try {
        const vencido = estaVencido(c.fechaVencimiento, ahora);
        const faltan = finDelDiaLima(c.fechaVencimiento).getTime() - ahora.getTime();
        if (vencido && !c.avisoBloqueoEn && (await this.marcar(c.id, 'avisoBloqueoEn', ahora))) {
          await this.enviarCorreo(
            c.empresaId,
            `Krezka · Emisión pausada: tienes un pago vencido`,
            `<h2 style="margin:0 0 12px">Tu emisión de comprobantes está pausada</h2>
             <p>El consumo de ${c.periodo} (<strong>S/ ${Number(c.monto).toFixed(2)}</strong>) venció el ${fechaLima(c.fechaVencimiento)} sin pagarse.
             Mientras tanto la API no emite facturas, boletas ni notas de crédito. Las pruebas, las consultas y las anulaciones siguen funcionando.</p>
             <p>Apenas pagues se reactiva al instante.</p>
             ${this.boton('Pagar ahora', `${URL_CONSOLA()}/console/consumo`)}`,
          );
          bloqueos++;
        } else if (!vencido && faltan <= 3 * DIA_MS && !c.avisoPrevioEn && (await this.marcar(c.id, 'avisoPrevioEn', ahora))) {
          await this.enviarCorreo(
            c.empresaId,
            `Krezka · Tu pago de ${c.periodo} vence el ${fechaLima(c.fechaVencimiento)}`,
            `<h2 style="margin:0 0 12px">Tu pago vence pronto</h2>
             <p>El consumo de la API de ${c.periodo} (<strong>S/ ${Number(c.monto).toFixed(2)}</strong>) vence el <strong>${fechaLima(c.fechaVencimiento)}</strong>.
             Si no se paga ese día, desde el día siguiente se pausa la emisión de comprobantes hasta que se pague.</p>
             ${this.boton('Pagar ahora', `${URL_CONSOLA()}/console/consumo`)}`,
          );
          previos++;
        }
      } catch (e: any) {
        // Que falle uno no deja sin aviso a los demás.
        this.logger.warn(`Recordatorio del cobro ${c.id}: ${e?.message}`);
      }
    }
    return { previos, bloqueos };
  }

  /** Toma la marca del aviso solo si nadie la tomó antes. */
  private async marcar(id: number, campo: 'avisoPrevioEn' | 'avisoBloqueoEn', ahora: Date): Promise<boolean> {
    const r = await this.prisma.cobroEmpresa.updateMany({ where: { id, [campo]: null }, data: { [campo]: ahora } });
    return r.count === 1;
  }

  /** Avisa por correo al integrador que tiene un cobro nuevo. No falla el cierre. */
  async avisarCobroNuevo(integradorId: number, cobroId: number) {
    const c = await this.prisma.cobroEmpresa.findUnique({ where: { id: cobroId } });
    if (!c) return;
    const monto = `S/ ${Number(c.monto).toFixed(2)}`;
    await this.enviarCorreo(
      integradorId,
      `Krezka · Tu consumo de la API de ${c.periodo}: ${monto}`,
      `<h2 style="margin:0 0 12px">Tu consumo de ${c.periodo}</h2>
       <p>${c.descripcion ?? 'API de facturación'}.</p>
       <p style="font-size:28px;font-weight:600;margin:16px 0">${monto} <span style="font-size:14px;font-weight:400;color:#71717a">con IGV</span></p>
       <p>Vence el <strong>${fechaLima(c.fechaVencimiento)}</strong>. Si no se paga ese día, desde el día siguiente se pausa la emisión de comprobantes hasta que se pague.</p>
       <p>Puedes ver el detalle y pagar con Mercado Pago desde tu consola:</p>
       ${this.boton('Ver y pagar', `${URL_CONSOLA()}/console/consumo`)}`,
    );
  }

  // ── Utilidades ───────────────────────────────────────────────────────

  /** Los datos de facturación, si están completos. */
  static datosValidos(v: unknown): DatosFacturacion | null {
    const d = (v ?? {}) as Partial<DatosFacturacion>;
    const numero = String(d.numero ?? '').trim();
    const nombre = String(d.nombre ?? '').trim();
    if (d.tipo === 'ruc' && /^\d{11}$/.test(numero) && nombre) return d as DatosFacturacion;
    if (d.tipo === 'dni' && /^\d{8}$/.test(numero) && nombre) return d as DatosFacturacion;
    return null;
  }

  private async correos(integradorId: number): Promise<string[]> {
    const [empresa, admins] = await Promise.all([
      this.prisma.empresa.findUnique({ where: { id: integradorId }, select: { datosFacturacion: true } }),
      this.prisma.usuario.findMany({
        where: { empresaId: integradorId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
        select: { email: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    const deFacturacion = CobrosApiService.datosValidos(empresa?.datosFacturacion)?.email;
    const todos = [deFacturacion, ...admins.map((a) => a.email)].filter((e): e is string => !!e && /@/.test(e));
    return [...new Set(todos.map((e) => e.trim().toLowerCase()))];
  }

  private boton(texto: string, enlace: string) {
    return `<p><a href="${enlace}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${texto}</a></p>`;
  }

  /** Un correo a la cuenta. Sin RESEND_API_KEY no hace nada; nunca lanza. */
  private async enviarCorreo(integradorId: number, asunto: string, cuerpo: string) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;
    try {
      const para = await this.correos(integradorId);
      if (!para.length) return;
      const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:auto;color:#18181b">${cuerpo}
        <p style="color:#71717a;font-size:13px;margin-top:24px">Si prefieres pagar por transferencia o Yape, responde este correo.</p></div>`;
      const { Resend } = await import('resend');
      const { error } = await new Resend(resendKey).emails.send({
        from: `Krezka <${process.env.RESEND_FROM_EMAIL || 'notificaciones@falconext.pe'}>`,
        to: para,
        subject: asunto,
        html,
      });
      if (error) throw new Error(String((error as any)?.message ?? error));
    } catch (e: any) {
      this.logger.warn(`No se pudo mandar "${asunto}" al integrador ${integradorId}: ${e?.message}`);
    }
  }
}
