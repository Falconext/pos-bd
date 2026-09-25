import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { descifrarSecreto } from '../common/utils/secreto.util';

/**
 * Niubiz (ex VisaNet) para las tiendas virtuales.
 *
 * Cada empresa cobra con SU propia afiliación: merchant id, usuario y clave son
 * del comerciante y la plata entra a su cuenta. La plataforma no actúa de
 * recaudador.
 *
 * El flujo del botón de pago son cuatro pasos encadenados:
 *   1. token de seguridad  — GET api.security con Basic auth
 *   2. sesión              — POST api.ecommerce, devuelve sessionKey
 *   3. checkout.js         — lo abre el navegador y devuelve un transactionToken
 *   4. autorización        — POST api.authorization con ese token
 * Los pasos 1, 2 y 4 son host a host: nunca salen credenciales al navegador.
 */

/** Hosts de Niubiz. `usaDemo` manda al entorno de integración. */
const HOST = {
  demo: 'https://apisandbox.vnforappstest.com',
  prod: 'https://apiprod.vnforapps.com',
};

/** El script del formulario que carga la tienda. */
export const CHECKOUT_JS = {
  demo: 'https://static-content-qas.vnforapps.com/vTokenSandbox/js/checkout.js',
  prod: 'https://static-content.vnforapps.com/vToken/js/checkout.js',
};

export interface NiubizCredenciales {
  merchantId: string;
  usuario: string;
  password: string;
  usaDemo: boolean;
}

export interface NiubizAutorizacion {
  transactionId: string | null;
  purchaseNumber: string;
  /** Últimos dígitos y marca, para mostrarlos en el pedido. */
  descripcion: string;
}

@Injectable()
export class NiubizService {
  private readonly logger = new Logger(NiubizService.name);

  constructor(private readonly prisma: PrismaService) {}

  private base(usaDemo: boolean) {
    return usaDemo ? HOST.demo : HOST.prod;
  }

  /**
   * Credenciales de la empresa, con la clave descifrada. Devuelve null si la
   * tienda todavía no configuró Niubiz o lo tiene apagado.
   */
  async credenciales(empresaId: number): Promise<NiubizCredenciales | null> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        niubizMerchantId: true,
        niubizUsuario: true,
        niubizPassword: true,
        niubizActivo: true,
        pasarelasUsaDemo: true,
      },
    });
    if (!e?.niubizActivo) return null;
    const merchantId = String(e.niubizMerchantId || '').trim();
    const usuario = String(e.niubizUsuario || '').trim();
    const password = (descifrarSecreto(e.niubizPassword) || '').trim();
    if (!merchantId || !usuario || !password) return null;
    return { merchantId, usuario, password, usaDemo: e.pasarelasUsaDemo };
  }

  /** ¿La tienda puede ofrecer Niubiz? */
  async habilitada(empresaId: number): Promise<boolean> {
    return (await this.credenciales(empresaId)) !== null;
  }

  /** Paso 1: token de seguridad. Niubiz lo devuelve como texto plano. */
  private async accessToken(cred: NiubizCredenciales): Promise<string> {
    const basic = Buffer.from(`${cred.usuario}:${cred.password}`).toString(
      'base64',
    );
    try {
      const { data } = await axios.get(
        `${this.base(cred.usaDemo)}/api.security/v1/security`,
        {
          headers: { Authorization: `Basic ${basic}` },
          timeout: 20000,
          responseType: 'text',
          transformResponse: [(d) => d],
        },
      );
      const token = String(data || '').trim();
      if (!token) throw new Error('respuesta vacía');
      return token;
    } catch (error: any) {
      this.logger.error(
        `[Niubiz] token de seguridad falló: ${error?.response?.status ?? ''} ${error?.message}`,
      );
      throw new BadRequestException(
        'No se pudo autenticar con Niubiz. Revisa el usuario y la clave de la tienda.',
      );
    }
  }

  /**
   * Paso 2: sesión de pago. Devuelve lo que el navegador necesita para abrir
   * el formulario; nunca la clave del comercio.
   */
  async crearSesion(params: {
    empresaId: number;
    montoSoles: number;
    clientIp?: string;
  }): Promise<{
    sessionKey: string;
    merchantId: string;
    scriptUrl: string;
    expiracion: number | null;
  }> {
    const cred = await this.credenciales(params.empresaId);
    if (!cred) {
      throw new BadRequestException(
        'Esta tienda todavía no configuró su cuenta de Niubiz',
      );
    }
    const monto = Number(params.montoSoles);
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new BadRequestException('Monto inválido para el pago con tarjeta');
    }

    const token = await this.accessToken(cred);
    try {
      const { data } = await axios.post(
        `${this.base(cred.usaDemo)}/api.ecommerce/v2/ecommerce/token/session/${cred.merchantId}`,
        {
          channel: 'web',
          amount: Number(monto.toFixed(2)),
          ...(params.clientIp
            ? { antifraud: { clientIp: params.clientIp } }
            : {}),
        },
        {
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          timeout: 20000,
        },
      );
      const sessionKey = String(data?.sessionKey || '').trim();
      if (!sessionKey) {
        throw new Error('Niubiz no devolvió sessionKey');
      }
      return {
        sessionKey,
        merchantId: cred.merchantId,
        scriptUrl: cred.usaDemo ? CHECKOUT_JS.demo : CHECKOUT_JS.prod,
        expiracion: data?.expirationTime ?? null,
      };
    } catch (error: any) {
      this.logger.error(
        `[Niubiz] sesión falló: ${error?.response?.status ?? ''} ${JSON.stringify(error?.response?.data ?? error?.message).slice(0, 300)}`,
      );
      throw new BadRequestException(
        'No se pudo iniciar el pago con Niubiz. Intenta de nuevo en un momento.',
      );
    }
  }

  /**
   * Paso 4: autoriza el cobro con el transactionToken que devolvió el
   * formulario. Si Niubiz no aprueba, se lanza con el mensaje que le sirve al
   * comprador.
   */
  async autorizar(params: {
    empresaId: number;
    transactionToken: string;
    purchaseNumber: string;
    montoSoles: number;
  }): Promise<NiubizAutorizacion> {
    const cred = await this.credenciales(params.empresaId);
    if (!cred) {
      throw new BadRequestException(
        'Esta tienda todavía no configuró su cuenta de Niubiz',
      );
    }
    const token = await this.accessToken(cred);

    let data: any;
    try {
      const resp = await axios.post(
        `${this.base(cred.usaDemo)}/api.authorization/v3/authorization/ecommerce/${cred.merchantId}`,
        {
          channel: 'web',
          captureType: 'manual',
          countable: true,
          order: {
            tokenId: params.transactionToken,
            purchaseNumber: params.purchaseNumber,
            amount: Number(Number(params.montoSoles).toFixed(2)),
            currency: 'PEN',
          },
        },
        {
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          timeout: 30000,
        },
      );
      data = resp.data;
    } catch (error: any) {
      // Niubiz manda el rechazo como error HTTP con el motivo en el cuerpo.
      const cuerpo = error?.response?.data;
      const motivo =
        cuerpo?.data?.ACTION_DESCRIPTION ||
        cuerpo?.errorMessage ||
        cuerpo?.message;
      this.logger.warn(
        `[Niubiz] autorización rechazada: ${JSON.stringify(cuerpo ?? error?.message).slice(0, 300)}`,
      );
      throw new BadRequestException(
        motivo
          ? `Niubiz rechazó el pago: ${motivo}`
          : 'Niubiz no aprobó el pago con tarjeta',
      );
    }

    // errorCode 0 (o ausente con ACTION_CODE 000) significa aprobado.
    const actionCode = String(data?.dataMap?.ACTION_CODE ?? '');
    const aprobado =
      String(data?.errorCode ?? '0') === '0' &&
      (actionCode === '' || actionCode === '000');
    if (!aprobado) {
      throw new BadRequestException(
        data?.dataMap?.ACTION_DESCRIPTION ||
          'Niubiz no aprobó el pago con tarjeta',
      );
    }

    const marca = String(data?.dataMap?.BRAND ?? '').toUpperCase();
    const tarjeta = String(data?.dataMap?.CARD ?? '');
    return {
      transactionId: String(data?.order?.transactionId ?? '') || null,
      purchaseNumber: params.purchaseNumber,
      descripcion: [marca, tarjeta].filter(Boolean).join(' ') || 'Niubiz',
    };
  }
}
