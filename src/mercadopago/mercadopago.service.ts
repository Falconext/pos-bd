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
  get configurado() {
    return Boolean(this.clientId && this.clientSecret);
  }

  // ── OAuth: conectar / callback / desconectar ───────────────────────────────

  /** URL de autorización a la que se envía al empresario para conectar su cuenta MP. */
  getConnectUrl(empresaId: number): string {
    if (!this.configurado) {
      throw new BadRequestException(
        'Mercado Pago no está configurado en la plataforma (faltan credenciales)',
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
      throw new BadRequestException('El enlace de conexión expiró o es inválido');
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
    if (!empresa || !empresa.mpConectado) {
      throw new BadRequestException(
        'Esta tienda no tiene Mercado Pago habilitado',
      );
    }
    const accessToken = await this.getValidAccessToken(empresa);

    const total = Math.round(Number(params.total) * 100) / 100;
    if (!(total > 0)) {
      throw new BadRequestException('Monto inválido para Mercado Pago');
    }
    const feePercent = this.marketplaceFeePercent;
    const marketplaceFee =
      feePercent > 0 ? Math.round(total * feePercent) / 100 : 0;

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
      auto_return: 'approved',
      notification_url: notificationUrl,
      metadata: {
        pedidoId: params.pedidoId,
        empresaId: params.empresaId,
      },
    };
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

      // Necesitamos un access_token de vendedor para consultar el pago. Como el
      // webhook no dice a qué empresa pertenece, consultamos el pago probando con
      // el external_reference. MP permite consultar el pago con el token del vendedor
      // dueño del pago; recorremos empresas conectadas por metadata cuando sea posible.
      // Estrategia: obtener el pago con el token de la empresa a partir del external_reference.
      // Primero, intentar leerlo con cualquier empresa conectada hasta ubicar el pedido.
      const pago = await this.buscarPago(String(paymentId));
      if (!pago) return;

      const codigo = pago.external_reference;
      if (!codigo) return;
      const pedido = await this.prisma.pedidoTienda.findUnique({
        where: { codigoSeguimiento: codigo },
      });
      if (!pedido) return;

      if (pago.status === 'approved') {
        const total = Number(pedido.total);
        await this.prisma.pedidoTienda.update({
          where: { id: pedido.id },
          data: {
            mpPaymentId: String(pago.id),
            montoPagado: total,
            saldoPendiente: 0,
            estado: 'CONFIRMADO',
            fechaConfirmacion: new Date(),
            referenciaTransf: `mp_payment:${pago.id}`,
          },
        });
        await this.prisma.historialEstadoPedido.create({
          data: {
            pedidoId: pedido.id,
            estadoAnterior: 'PENDIENTE',
            estadoNuevo: 'CONFIRMADO',
            notas: `Pago confirmado por Mercado Pago (${pago.id})`,
          },
        });
      }
    } catch (err: any) {
      this.logger.error(`Error procesando webhook MP: ${err?.message}`);
    }
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
    const parts = xSignature.split(',').reduce<Record<string, string>>(
      (acc, kv) => {
        const [k, v] = kv.split('=');
        if (k && v) acc[k.trim()] = v.trim();
        return acc;
      },
      {},
    );
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

  /** Consulta el pago probando con los tokens de empresas conectadas. */
  private async buscarPago(paymentId: string): Promise<any | null> {
    const empresas = await this.prisma.empresa.findMany({
      where: { mpConectado: true },
      select: {
        id: true,
        mpAccessToken: true,
        mpRefreshToken: true,
        mpTokenExpira: true,
      },
    });
    for (const empresa of empresas) {
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
