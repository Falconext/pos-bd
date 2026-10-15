import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CobroEmpresaService } from './cobro-empresa.service';

/**
 * Débito automático de la mensualidad con Mercado Pago.
 *
 * El flujo es el de "suscripción sin plan asociado": se crea un `preapproval`
 * con la cuenta de Falconext, MP devuelve un `init_point`, el empresario entra
 * UNA vez y autoriza, y de ahí en adelante MP cobra solo cada mes y avisa por
 * webhook. Los reintentos de una tarjeta rechazada los hace MP.
 *
 * Dos decisiones que conviene no deshacer:
 *
 *  - Se usa `init_point` y no `card_token_id`. Con el token habría que capturar
 *    la tarjeta en nuestro formulario, y eso mete a Falconext en el alcance de
 *    PCI. Así la tarjeta nunca toca nuestro servidor.
 *  - El webhook no inventa su propia contabilidad: termina llamando a
 *    `CobroEmpresaService.registrarPago`, la misma función que usa el botón del
 *    panel. Un cobro automático y uno a mano dejan exactamente el mismo rastro.
 */

const MP_PREAPPROVAL_URL = 'https://api.mercadopago.com/preapproval';
const MP_AUTHORIZED_PAYMENT_URL =
  'https://api.mercadopago.com/authorized_payments';

interface PreapprovalMp {
  id: string;
  status: string;
  init_point?: string;
  external_reference?: string;
  next_payment_date?: string;
  auto_recurring?: { transaction_amount?: number; currency_id?: string };
}

@Injectable()
export class MpSuscripcionService {
  private readonly logger = new Logger(MpSuscripcionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cobros: CobroEmpresaService,
  ) {}

  /**
   * Token de la cuenta de Falconext, no de las tiendas.
   *
   * Es distinto de `MP_CLIENT_ID`/`MP_CLIENT_SECRET`: esos son la app del
   * marketplace, con la que cada tienda conecta SU cuenta para cobrarle a sus
   * clientes. Acá Falconext cobra con la suya.
   */
  private get accessToken() {
    return (process.env.MP_ACCESS_TOKEN_PLATAFORMA || '').trim();
  }

  private get frontendUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5174').replace(/\/$/, '');
  }

  habilitado(): boolean {
    return this.accessToken.length > 0;
  }

  private cabeceras() {
    if (!this.habilitado()) {
      throw new BadRequestException(
        'El cobro automático no está configurado todavía (falta MP_ACCESS_TOKEN_PLATAFORMA).',
      );
    }
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  // ── Alta ─────────────────────────────────────────────────────────────────

  /**
   * Crea la suscripción y devuelve el enlace donde el empresario autoriza.
   *
   * No activa nada: mientras no vuelva autorizada desde MP, la empresa sigue
   * igual que antes. El `external_reference` lleva el id de la empresa, que es
   * lo que permite conciliar aunque se pierda el preapprovalId.
   */
  async crearSuscripcion(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        razonSocial: true,
        resellerId: true,
        mpPreapprovalId: true,
        plan: { select: { nombre: true, costo: true } },
        usuarios: {
          where: { rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
          select: { email: true },
          orderBy: { id: 'asc' },
          take: 1,
        },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (empresa.resellerId) {
      throw new BadRequestException(
        'Esta cuenta la factura su distribuidor; el cobro automático no aplica.',
      );
    }
    const monto = Number(empresa.plan?.costo ?? 0);
    if (!(monto > 0)) {
      throw new BadRequestException('El plan no tiene un costo que cobrar.');
    }
    const email = empresa.usuarios[0]?.email;
    if (!email) {
      throw new BadRequestException(
        'La empresa no tiene un administrador con correo para asociar la suscripción.',
      );
    }

    const cuerpo = {
      reason: `${empresa.plan?.nombre ?? 'Plan'} — mensualidad`,
      external_reference: String(empresa.id),
      payer_email: email,
      back_url: `${this.frontendUrl}/administrador/mi-plan?cobro=listo`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: monto,
        currency_id: 'PEN',
      },
    };

    const { data } = await axios.post<PreapprovalMp>(MP_PREAPPROVAL_URL, cuerpo, {
      headers: this.cabeceras(),
      timeout: 20000,
    });

    await this.prisma.empresa.update({
      where: { id: empresa.id },
      data: {
        mpPreapprovalId: data.id,
        mpPreapprovalEstado: data.status,
        pasarelaCobro: 'MERCADO_PAGO',
        // Todavía NO está activo: lo estará cuando MP lo reporte autorizado.
        cobroAutomatico: false,
      },
    });

    this.logger.log(
      `Suscripción MP ${data.id} creada para empresa ${empresa.id} (${data.status})`,
    );
    return { preapprovalId: data.id, estado: data.status, urlAutorizacion: data.init_point };
  }

  /** Vuelve a preguntarle a MP en qué estado está y lo guarda. */
  async sincronizarEstado(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { mpPreapprovalId: true },
    });
    if (!empresa?.mpPreapprovalId) return null;
    const { data } = await axios.get<PreapprovalMp>(
      `${MP_PREAPPROVAL_URL}/${empresa.mpPreapprovalId}`,
      { headers: this.cabeceras(), timeout: 20000 },
    );
    return this.guardarEstado(empresaId, data.status);
  }

  async cancelar(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { mpPreapprovalId: true },
    });
    if (!empresa?.mpPreapprovalId) {
      throw new BadRequestException('Esta cuenta no tiene cobro automático activo.');
    }
    await axios.put(
      `${MP_PREAPPROVAL_URL}/${empresa.mpPreapprovalId}`,
      { status: 'cancelled' },
      { headers: this.cabeceras(), timeout: 20000 },
    );
    return this.guardarEstado(empresaId, 'cancelled');
  }

  /** `cobroAutomatico` solo es true mientras MP lo tenga autorizado. */
  private async guardarEstado(empresaId: number, estado: string) {
    const autorizada = estado === 'authorized';
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        mpPreapprovalEstado: estado,
        cobroAutomatico: autorizada,
        ...(estado === 'cancelled' ? { mpPreapprovalId: null } : {}),
      },
    });
    return { estado, cobroAutomatico: autorizada };
  }

  // ── Webhook ──────────────────────────────────────────────────────────────

  /**
   * Cambió el estado de una suscripción (la autorizaron, la pausaron, la
   * cancelaron desde la app de MP).
   */
  async procesarCambioDeSuscripcion(preapprovalId: string) {
    const { data } = await axios.get<PreapprovalMp>(
      `${MP_PREAPPROVAL_URL}/${preapprovalId}`,
      { headers: this.cabeceras(), timeout: 20000 },
    );
    const empresa = await this.ubicarEmpresa(preapprovalId, data.external_reference);
    if (!empresa) {
      this.logger.warn(`Webhook MP: preapproval ${preapprovalId} sin empresa`);
      return;
    }
    // Si la ubicamos por external_reference, dejamos el vínculo guardado.
    if (!empresa.mpPreapprovalId) {
      await this.prisma.empresa.update({
        where: { id: empresa.id },
        data: { mpPreapprovalId: preapprovalId, pasarelaCobro: 'MERCADO_PAGO' },
      });
    }
    await this.guardarEstado(empresa.id, data.status);
    this.logger.log(`Suscripción MP ${preapprovalId}: empresa ${empresa.id} → ${data.status}`);
  }

  /**
   * MP cobró (o intentó cobrar) una cuota.
   *
   * Solo las aprobadas mueven plata. Si no hay un cobro pendiente emitido —
   * porque MP cobró antes de que corriera el cron— se emite el del ciclo para
   * que el pago siempre tenga dónde anotarse: un pago sin cobro quedaría fuera
   * del panel y de los ingresos.
   */
  async procesarCuota(authorizedPaymentId: string) {
    const { data } = await axios.get<any>(
      `${MP_AUTHORIZED_PAYMENT_URL}/${authorizedPaymentId}`,
      { headers: this.cabeceras(), timeout: 20000 },
    );
    const estadoPago = String(data?.status ?? '').toLowerCase();
    const preapprovalId = String(data?.preapproval_id ?? '');
    const empresa = await this.ubicarEmpresa(preapprovalId, data?.external_reference);
    if (!empresa) {
      this.logger.warn(`Webhook MP: cuota ${authorizedPaymentId} sin empresa`);
      return;
    }

    if (estadoPago !== 'processed' && estadoPago !== 'approved') {
      // Rechazada o en proceso: MP reintenta por su cuenta. No se toca la
      // suscripción — el ciclo de gracia ya cubre el tiempo que eso tome.
      this.logger.warn(
        `Cuota ${authorizedPaymentId} de la empresa ${empresa.id} en estado "${estadoPago}": no se aplica.`,
      );
      return;
    }

    const monto = Number(data?.transaction_amount ?? 0) || undefined;
    const referencia = String(data?.payment?.id ?? authorizedPaymentId);

    let cobro = await this.prisma.cobroEmpresa.findFirst({
      where: { empresaId: empresa.id, estado: 'PENDIENTE' },
      orderBy: { fechaVencimiento: 'asc' },
      select: { id: true },
    });

    if (!cobro) {
      await this.cobros.generarCobrosDelCiclo();
      cobro = await this.prisma.cobroEmpresa.findFirst({
        where: { empresaId: empresa.id, estado: 'PENDIENTE' },
        orderBy: { fechaVencimiento: 'asc' },
        select: { id: true },
      });
    }
    if (!cobro) {
      this.logger.warn(
        `Cuota ${authorizedPaymentId}: la empresa ${empresa.id} no tiene mensualidad pendiente que aplicar.`,
      );
      return;
    }

    await this.cobros.registrarPago(cobro.id, {
      medioPago: 'MERCADO_PAGO',
      referencia,
      monto,
    });
    this.logger.log(
      `Cuota ${authorizedPaymentId} aplicada: empresa ${empresa.id}, cobro ${cobro.id}.`,
    );
  }

  /**
   * Ubica la empresa por el id de la suscripción y, si no aparece, por el
   * `external_reference` que viajó desde el alta. El segundo camino salva el
   * caso de una suscripción creada desde el panel de MP o de un vínculo que se
   * perdió.
   */
  private async ubicarEmpresa(preapprovalId?: string, externalReference?: unknown) {
    if (preapprovalId) {
      const porId = await this.prisma.empresa.findFirst({
        where: { mpPreapprovalId: preapprovalId },
        select: { id: true, mpPreapprovalId: true },
      });
      if (porId) return porId;
    }
    const ref = Number(externalReference);
    if (Number.isFinite(ref) && ref > 0) {
      return this.prisma.empresa.findUnique({
        where: { id: ref },
        select: { id: true, mpPreapprovalId: true },
      });
    }
    return null;
  }

  /** Lo que ve el empresario de su débito automático. */
  async estadoDeMiCobroAutomatico(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        cobroAutomatico: true,
        pasarelaCobro: true,
        mpPreapprovalEstado: true,
        resellerId: true,
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    return {
      disponible: this.habilitado() && !empresa.resellerId,
      activo: empresa.cobroAutomatico,
      pasarela: empresa.pasarelaCobro,
      estadoPasarela: empresa.mpPreapprovalEstado,
    };
  }
}
