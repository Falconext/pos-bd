import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Endpoints Mercado Pago (Perú / global)
const MP_AUTH_URL = 'https://auth.mercadopago.com.pe/authorization';
const MP_TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
const MP_PREFERENCES_URL = 'https://api.mercadopago.com/checkout/preferences';
const MP_PAYMENTS_URL = 'https://api.mercadopago.com/v1/payments';

interface MpTokenResponse {
  access_token: string;
  refresh_token: string;
  user_id: number | string;
  public_key: string;
  expires_in: number;
}

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ── Config helpers ─────────────────────────────────────────────────────────
  private get clientId() {
    return (process.env.MP_CLIENT_ID || '').trim();
  }
  private get clientSecret() {
    return (process.env.MP_CLIENT_SECRET || '').trim();
  }
  private get redirectUri() {
    // Callback del backend que recibe el ?code de Mercado Pago.
    const explicit = (process.env.MP_REDIRECT_URI || '').trim();
    if (explicit) return explicit;
    const base = (process.env.BACKEND_URL || 'http://localhost:4001').replace(
      /\/$/,
      '',
    );
    return `${base}/api/mercadopago/oauth/callback`;
  }
  private get frontendUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5174').replace(
      /\/$/,
      '',
    );
  }
  /** Clave secreta del webhook (panel MP → Webhooks → Clave secreta). */
  private get webhookSecret() {
    return (process.env.MP_WEBHOOK_SECRET || '').trim();
  }
  /** Comisión de la plataforma por transacción (%). 0 = sin comisión. */
  private get marketplaceFeePercent() {
    const raw = Number(process.env.MP_MARKETPLACE_FEE_PERCENT || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }
  /**
   * Comisión fija de la plataforma por pago, en soles (MP_MARKETPLACE_FEE_FIJO).
   * Por defecto S/ 1 por cada pago cobrado vía Mercado Pago.
   */
  private get marketplaceFeeFijo() {
    const env = process.env.MP_MARKETPLACE_FEE_FIJO;
    if (env === undefined || env.trim() === '') return 1;
    const raw = Number(env);
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 0;
  }
  /**
   * `marketplace_fee` que se envía a MP (monto en soles): fijo + porcentaje.
   * Nunca puede igualar o superar el total del pago (MP lo rechazaría), en ese
   * caso se cobra sin comisión antes que perder la venta.
   */
  calcularMarketplaceFee(total: number): number {
    const porcentaje =
      this.marketplaceFeePercent > 0
        ? Math.round(total * this.marketplaceFeePercent) / 100
        : 0;
    const fee = Math.round((this.marketplaceFeeFijo + porcentaje) * 100) / 100;
    if (!(fee > 0)) return 0;
    if (fee >= total) {
      this.logger.warn(
        `Comisión S/ ${fee} >= total S/ ${total}: se omite marketplace_fee`,
      );
      return 0;
    }
    return fee;
  }
  get configurado() {
    return Boolean(this.clientId && this.clientSecret);
  }
  /**
   * Lista blanca de empresas que pueden usar Mercado Pago
   * (MP_EMPRESAS_HABILITADAS="22,45"). Vacía = disponible para todas.
   * Sirve para lanzar con una sola cuenta piloto y abrirlo después sin deploy.
   */
  private get empresasHabilitadas(): Set<number> {
    return new Set(
      String(process.env.MP_EMPRESAS_HABILITADAS || '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
  }
  habilitadaParaEmpresa(empresaId: number): boolean {
    const lista = this.empresasHabilitadas;
    return lista.size === 0 || lista.has(Number(empresaId));
  }

  // ── OAuth: conectar / callback / desconectar ───────────────────────────────

  /** URL de autorización a la que se envía al empresario para conectar su cuenta MP. */
  getConnectUrl(empresaId: number): string {
    if (!this.configurado) {
      throw new BadRequestException(
        'Mercado Pago no está configurado en la plataforma (faltan credenciales)',
      );
    }
    if (!this.habilitadaParaEmpresa(empresaId)) {
      throw new BadRequestException(
        'Mercado Pago aún no está habilitado para esta empresa',
      );
    }
    // state firmado (JWT corto) para saber qué empresa conecta y evitar manipulación.
    const state = this.jwt.sign(
      { empresaId, purpose: 'mp_oauth' },
      { expiresIn: '15m' },
    );
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      platform_id: 'mp',
      state,
      redirect_uri: this.redirectUri,
    });
    return `${MP_AUTH_URL}?${params.toString()}`;
  }

  /** Procesa el callback de MP: intercambia el code por tokens y los guarda en la empresa. */
  async handleCallback(code: string, state: string): Promise<number> {
    let empresaId: number;
    try {
      const payload = this.jwt.verify(state);
      if (payload?.purpose !== 'mp_oauth' || !payload?.empresaId) {
        throw new Error('state inválido');
      }
      empresaId = Number(payload.empresaId);
    } catch {
      throw new BadRequestException(
        'El enlace de conexión expiró o es inválido',
      );
    }

    const token = await this.exchangeCode(code);
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        mpUserId: String(token.user_id),
        mpAccessToken: token.access_token,
        mpRefreshToken: token.refresh_token,
        mpPublicKey: token.public_key,
        mpTokenExpira: new Date(Date.now() + token.expires_in * 1000),
        mpConectado: true,
      },
    });
    return empresaId;
  }

  async disconnect(empresaId: number) {
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        mpUserId: null,
        mpAccessToken: null,
        mpRefreshToken: null,
        mpPublicKey: null,
        mpTokenExpira: null,
        mpConectado: false,
      },
    });
    return { conectado: false };
  }

  /** Estado de conexión para el panel admin. */
  async estado(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { mpConectado: true, mpUserId: true, mpPublicKey: true },
    });
    return {
      configuradoPlataforma: this.configurado,
      // false = la tarjeta de conexión ni se muestra (lista blanca de lanzamiento).
      disponible: this.habilitadaParaEmpresa(empresaId),
      conectado: Boolean(e?.mpConectado),
      mpUserId: e?.mpUserId ?? null,
    };
  }

  // URL a la que redirige el navegador tras el callback (éxito o error).
  frontendReturnUrl(ok: boolean): string {
    return `${this.frontendUrl}/administrador/perfil?mp=${ok ? 'conectado' : 'error'}`;
  }

  private async exchangeCode(code: string): Promise<MpTokenResponse> {
    try {
      const { data } = await axios.post(MP_TOKEN_URL, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      });
      return data as MpTokenResponse;
    } catch (err: any) {
      this.logger.error(
        `Error intercambiando code MP: ${err?.response?.data?.message || err?.message}`,
      );
      throw new BadRequestException(
        'No se pudo conectar la cuenta de Mercado Pago',
      );
    }
  }

  /** Devuelve un access_token válido de la empresa, refrescándolo si está por vencer. */
  private async getValidAccessToken(empresa: {
    id: number;
    mpAccessToken: string | null;
    mpRefreshToken: string | null;
    mpTokenExpira: Date | null;
  }): Promise<string> {
    if (!empresa.mpAccessToken || !empresa.mpRefreshToken) {
      throw new BadRequestException(
        'La tienda no tiene Mercado Pago conectado',
      );
    }
    const porVencer =
      !empresa.mpTokenExpira ||
      empresa.mpTokenExpira.getTime() - Date.now() < 5 * 60 * 1000;
    if (!porVencer) return empresa.mpAccessToken;

    try {
      const { data } = await axios.post(MP_TOKEN_URL, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: empresa.mpRefreshToken,
      });
      const token = data as MpTokenResponse;
      await this.prisma.empresa.update({
        where: { id: empresa.id },
        data: {
          mpAccessToken: token.access_token,
          mpRefreshToken: token.refresh_token,
          mpTokenExpira: new Date(Date.now() + token.expires_in * 1000),
        },
      });
      return token.access_token;
    } catch (err: any) {
      this.logger.error(
        `Error refrescando token MP empresa ${empresa.id}: ${err?.response?.data?.message || err?.message}`,
      );
      // Si el refresh falla, usar el token actual como último intento.
      return empresa.mpAccessToken;
    }
  }

  // ── Checkout Pro: crear preferencia ────────────────────────────────────────

  /**
   * Crea una preferencia de Checkout Pro con la cuenta MP de la empresa.
   * Devuelve el init_point (URL a la que redirigir al comprador).
   */
  async crearPreferencia(params: {
    empresaId: number;
    pedidoId: number;
    codigoSeguimiento: string;
    titulo: string;
    total: number;
    slug: string;
    clienteEmail?: string | null;
  }): Promise<{ preferenceId: string; initPoint: string }> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: params.empresaId },
      select: {
        id: true,
        mpAccessToken: true,
        mpRefreshToken: true,
        mpTokenExpira: true,
        mpConectado: true,
      },
    });
    if (
      !empresa ||
      !empresa.mpConectado ||
      !this.habilitadaParaEmpresa(empresa.id)
    ) {
      throw new BadRequestException(
        'Esta tienda no tiene Mercado Pago habilitado',
      );
    }
    const accessToken = await this.getValidAccessToken(empresa);

    const total = Math.round(Number(params.total) * 100) / 100;
    if (!(total > 0)) {
      throw new BadRequestException('Monto inválido para Mercado Pago');
    }
    const marketplaceFee = this.calcularMarketplaceFee(total);

    const successUrl = `${this.frontendUrl}/tienda/${params.slug}/seguimiento?codigo=${params.codigoSeguimiento}`;
    const notificationUrl = `${(process.env.BACKEND_URL || 'http://localhost:4001').replace(/\/$/, '')}/api/mercadopago/webhook`;

    const body: Record<string, any> = {
      items: [
        {
          id: params.codigoSeguimiento,
          title: params.titulo,
          quantity: 1,
          currency_id: 'PEN',
          unit_price: total,
        },
      ],
      external_reference: params.codigoSeguimiento,
      back_urls: {
        success: successUrl,
        pending: successUrl,
        failure: `${this.frontendUrl}/tienda/${params.slug}/checkout`,
      },
      notification_url: notificationUrl,
      metadata: {
        pedidoId: params.pedidoId,
        empresaId: params.empresaId,
      },
    };
    // MP rechaza auto_return si la back_url no es pública HTTPS (p. ej. localhost en dev).
    if (/^https:\/\//i.test(successUrl)) {
      body.auto_return = 'approved';
    }
    if (params.clienteEmail) {
      body.payer = { email: params.clienteEmail };
    }
    if (marketplaceFee > 0) {
      body.marketplace_fee = marketplaceFee;
    }

    try {
      const { data } = await axios.post(MP_PREFERENCES_URL, body, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const initPoint = data.init_point || data.sandbox_init_point;
      if (!initPoint) {
        throw new Error('MP no devolvió init_point');
      }
      await this.prisma.pedidoTienda.update({
        where: { id: params.pedidoId },
        data: { mpPreferenceId: String(data.id) },
      });
      return { preferenceId: String(data.id), initPoint };
    } catch (err: any) {
      this.logger.error(
        `Error creando preferencia MP: ${JSON.stringify(err?.response?.data) || err?.message}`,
      );
      throw new BadRequestException(
        'No se pudo iniciar el pago con Mercado Pago',
      );
    }
  }

  // ── Webhook: confirmar pago ────────────────────────────────────────────────

  /**
   * Procesa la notificación de MP. Busca el pago, ubica el pedido por
   * external_reference y lo marca como pagado si fue aprobado.
   * Tolerante a fallos: siempre responde 200 para que MP no reintente en bucle.
   */
  async handleWebhook(
    query: any,
    body: any,
    headers?: { xSignature?: string; xRequestId?: string },
  ): Promise<void> {
    try {
      const tipo = query?.type || query?.topic || body?.type;
      const paymentId =
        query?.['data.id'] || body?.data?.id || query?.id || body?.id;
      if (tipo !== 'payment' || !paymentId) return;

      // Validación de firma: si hay secreto configurado, la notificación DEBE venir
      // firmada correctamente por Mercado Pago; si no, se ignora (posible fraude).
      if (
        !this.firmaWebhookValida(
          String(query?.['data.id'] || paymentId),
          headers?.xSignature,
          headers?.xRequestId,
        )
      ) {
        this.logger.warn(
          `Webhook MP rechazado: firma inválida (payment ${paymentId})`,
        );
        return;
      }

      // MP incluye `user_id` = cuenta del vendedor (collector). Con eso ubicamos
      // la empresa directamente; si no viene, probamos con las empresas conectadas.
      const userIdHint = body?.user_id ?? query?.user_id;
      const pago = await this.buscarPago(
        String(paymentId),
        userIdHint != null ? String(userIdHint) : undefined,
      );
      if (!pago) {
        this.logger.warn(`Webhook MP: pago ${paymentId} no encontrado`);
        return;
      }
      await this.aplicarPago(pago, 'webhook');
    } catch (err: any) {
      this.logger.error(`Error procesando webhook MP: ${err?.message}`);
    }
  }

  /**
   * Sincroniza el pago de un pedido cuando el comprador vuelve de Checkout Pro
   * (back_url trae payment_id/collection_id). Sirve de respaldo si el webhook
   * todavía no llegó o no está configurado. Es público: solo confirma lo que
   * Mercado Pago responda con el token de la propia empresa.
   */
  async sincronizarPagoRetorno(
    codigoSeguimiento: string,
    paymentId?: string,
  ): Promise<{ estado: string; pagado: boolean; mpStatus: string | null }> {
    const pedido = await this.prisma.pedidoTienda.findUnique({
      where: { codigoSeguimiento },
      select: { id: true, estado: true, empresaId: true, mpPaymentId: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const yaPagado = Boolean(pedido.mpPaymentId);
    if (yaPagado) {
      return { estado: pedido.estado, pagado: true, mpStatus: 'approved' };
    }

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: pedido.empresaId },
      select: {
        id: true,
        mpAccessToken: true,
        mpRefreshToken: true,
        mpTokenExpira: true,
        mpConectado: true,
      },
    });
    if (!empresa?.mpConectado) {
      return { estado: pedido.estado, pagado: false, mpStatus: null };
    }

    let pago: any = null;
    try {
      const accessToken = await this.getValidAccessToken(empresa);
      if (paymentId && /^\d+$/.test(paymentId)) {
        const { data } = await axios.get(`${MP_PAYMENTS_URL}/${paymentId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        pago = data;
      } else {
        // Sin payment_id: buscar por external_reference el más reciente aprobado.
        const { data } = await axios.get(`${MP_PAYMENTS_URL}/search`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            external_reference: codigoSeguimiento,
            sort: 'date_created',
            criteria: 'desc',
          },
        });
        const lista: any[] = data?.results || [];
        pago = lista.find((x) => x.status === 'approved') || lista[0] || null;
      }
    } catch (err: any) {
      this.logger.warn(
        `No se pudo sincronizar pago MP del pedido ${codigoSeguimiento}: ${err?.response?.data?.message || err?.message}`,
      );
    }

    if (!pago) return { estado: pedido.estado, pagado: false, mpStatus: null };
    // Seguridad: el pago debe corresponder a este pedido.
    if (pago.external_reference !== codigoSeguimiento) {
      return { estado: pedido.estado, pagado: false, mpStatus: null };
    }
    const aplicado = await this.aplicarPago(pago, 'retorno');
    return {
      estado: aplicado?.estado ?? pedido.estado,
      pagado: pago.status === 'approved',
      mpStatus: pago.status ?? null,
    };
  }

  /**
   * Marca el pedido como pagado/confirmado a partir de un pago de MP aprobado.
   * Idempotente: si el pedido ya registró ese pago, no hace nada.
   */
  private async aplicarPago(
    pago: any,
    origen: 'webhook' | 'retorno',
  ): Promise<{ estado: string } | null> {
    const codigo = pago?.external_reference;
    if (!codigo) return null;
    const pedido = await this.prisma.pedidoTienda.findUnique({
      where: { codigoSeguimiento: codigo },
      select: { id: true, estado: true, total: true, mpPaymentId: true },
    });
    if (!pedido) return null;

    if (pago.status !== 'approved') {
      this.logger.log(
        `Pago MP ${pago.id} del pedido ${codigo} en estado ${pago.status} (${origen})`,
      );
      return { estado: pedido.estado };
    }
    if (pedido.mpPaymentId === String(pago.id)) {
      return { estado: pedido.estado }; // ya procesado (reintento de MP)
    }

    // Monto: el pago debe cubrir el total del pedido (tolerancia de céntimos).
    const total = Number(pedido.total);
    const pagado = Number(pago.transaction_amount ?? total);
    if (pagado + 0.01 < total) {
      this.logger.warn(
        `Pago MP ${pago.id} por ${pagado} no cubre el total ${total} del pedido ${codigo}`,
      );
    }

    const nuevoEstado =
      pedido.estado === 'PENDIENTE' ? 'CONFIRMADO' : pedido.estado;
    await this.prisma.$transaction([
      this.prisma.pedidoTienda.update({
        where: { id: pedido.id },
        data: {
          mpPaymentId: String(pago.id),
          montoPagado: total,
          saldoPendiente: 0,
          estado: nuevoEstado as any,
          fechaConfirmacion: new Date(),
          referenciaTransf: `mp_payment:${pago.id}`,
        },
      }),
      this.prisma.historialEstadoPedido.create({
        data: {
          pedidoId: pedido.id,
          estadoAnterior: pedido.estado,
          estadoNuevo: nuevoEstado as any,
          notas: `Pago confirmado por Mercado Pago (${pago.id}) vía ${origen}`,
        },
      }),
    ]);
    this.logger.log(
      `Pedido ${codigo} confirmado por Mercado Pago (pago ${pago.id}, ${origen})`,
    );
    return { estado: nuevoEstado };
  }

  /**
   * Verifica la firma del webhook (header x-signature) según el esquema de MP:
   * manifest = `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` y se compara el
   * HMAC-SHA256 (con MP_WEBHOOK_SECRET) contra el valor v1 del header.
   * Si no hay secreto configurado, se acepta (para no bloquear antes del setup).
   */
  private firmaWebhookValida(
    dataId: string,
    xSignature?: string,
    xRequestId?: string,
  ): boolean {
    const secret = this.webhookSecret;
    if (!secret) {
      this.logger.warn(
        'MP_WEBHOOK_SECRET no configurado: webhook sin validar firma',
      );
      return true;
    }
    if (!xSignature) return false;

    // x-signature: "ts=1699999999,v1=abcdef..."
    const parts = xSignature
      .split(',')
      .reduce<Record<string, string>>((acc, kv) => {
        const [k, v] = kv.split('=');
        if (k && v) acc[k.trim()] = v.trim();
        return acc;
      }, {});
    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1) return false;

    // El id alfanumérico va en minúsculas en el manifest.
    const idNorm = /[a-zA-Z]/.test(dataId) ? dataId.toLowerCase() : dataId;
    const manifest = `id:${idNorm};request-id:${xRequestId ?? ''};ts:${ts};`;
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(hmac, 'hex'),
        Buffer.from(v1, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Consulta el pago con el token de la empresa dueña (por mpUserId si MP lo
   * indica); si no, prueba con las empresas conectadas hasta ubicarlo.
   */
  private async buscarPago(
    paymentId: string,
    mpUserId?: string,
  ): Promise<any | null> {
    const select = {
      id: true,
      mpUserId: true,
      mpAccessToken: true,
      mpRefreshToken: true,
      mpTokenExpira: true,
    } as const;
    const candidatas = await this.prisma.empresa.findMany({
      where: { mpConectado: true },
      select,
      orderBy: { id: 'asc' },
    });
    // La empresa indicada por MP va primero; el resto queda como respaldo.
    const ordenadas = mpUserId
      ? [
          ...candidatas.filter((e) => e.mpUserId === mpUserId),
          ...candidatas.filter((e) => e.mpUserId !== mpUserId),
        ]
      : candidatas;
    for (const empresa of ordenadas) {
      try {
        const accessToken = await this.getValidAccessToken(empresa);
        const { data } = await axios.get(`${MP_PAYMENTS_URL}/${paymentId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (data?.id) return data;
      } catch {
        // token de otra empresa: seguir probando
        continue;
      }
    }
    return null;
  }
}
