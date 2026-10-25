import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { enTextoPlano, idInstagram, partirMensaje } from './instagram-texto';

/**
 * Instagram (DM) para la IA de Ventas, con la API de Instagram con login de
 * Instagram (cuentas profesionales). Hace lo mismo que `WhatsAppService` para
 * WhatsApp: conectar la cuenta, mandar mensajes y bajar lo que manda el cliente.
 *
 * Tres diferencias con WhatsApp que viven acá:
 *  - No hay plantillas: fuera de las 24 h del último mensaje del cliente no se
 *    le puede escribir. Lo que dependa de plantillas queda solo en WhatsApp.
 *  - Cada mensaje admite hasta 1000 bytes: los largos se parten.
 *  - Los adjuntos que manda el cliente llegan como URL, no como id de media.
 */
@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  /** Base de la Graph API de Instagram. Configurable para pruebas. */
  private get api() {
    return (process.env.INSTAGRAM_GRAPH_URL || 'https://graph.instagram.com/v21.0').replace(/\/$/, '');
  }
  /** La misma API sin versión: los endpoints de token no la llevan. */
  private get apiRaiz() {
    return this.api.replace(/\/v\d+\.\d+$/, '');
  }
  private get oauthUrl() {
    return process.env.INSTAGRAM_OAUTH_URL || 'https://api.instagram.com/oauth/access_token';
  }

  constructor(private readonly prisma: PrismaService) {}

  configurado(): boolean {
    return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
  }

  private async credenciales(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { instagramAccountId: true, instagramToken: true, instagramActivo: true },
    });
    if (!e?.instagramAccountId || !e.instagramToken || !e.instagramActivo) {
      throw new Error('Instagram no está conectado para esta empresa.');
    }
    return { cuenta: e.instagramAccountId, token: e.instagramToken };
  }

  private motivo(err: any): string {
    const d = err?.response?.data?.error;
    return d?.error_user_msg || d?.message || err?.message || 'Error de Instagram';
  }

  private async enviar(empresaId: number, igsid: string, message: Record<string, unknown>) {
    const { cuenta, token } = await this.credenciales(empresaId);
    await axios.post(
      `${this.api}/${cuenta}/messages`,
      { recipient: { id: igsid }, message },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 },
    );
  }

  /**
   * Texto. Se quita el formato de WhatsApp (que Instagram muestra literal) y,
   * si pasa de 1000 bytes, sale en varios mensajes seguidos.
   */
  async enviarTexto(destino: string, texto: string, empresaId: number): Promise<{ success: boolean; error?: string }> {
    try {
      for (const parte of partirMensaje(enTextoPlano(texto))) {
        await this.enviar(empresaId, idInstagram(destino), { text: parte });
      }
      return { success: true };
    } catch (err: any) {
      const error = this.motivo(err);
      this.logger.warn(`No se pudo enviar por Instagram a ${destino}: ${error}`);
      return { success: false, error };
    }
  }

  /** Un adjunto por URL pública: image, video o audio. */
  async enviarAdjunto(
    destino: string,
    tipo: 'image' | 'video' | 'audio',
    url: string,
    caption: string | undefined,
    empresaId: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.enviar(empresaId, idInstagram(destino), { attachment: { type: tipo, payload: { url } } });
    } catch (err: any) {
      const error = this.motivo(err);
      this.logger.warn(`No se pudo enviar ${tipo} por Instagram a ${destino}: ${error}`);
      return { success: false, error };
    }
    // Instagram no lleva leyenda en el adjunto: va como texto aparte.
    if (caption?.trim()) return this.enviarTexto(destino, caption, empresaId);
    return { success: true };
  }

  /** Nombre y @usuario del cliente, para mostrarlo en la bandeja. */
  async perfil(destino: string, empresaId: number): Promise<{ nombre?: string; usuario?: string }> {
    try {
      const { token } = await this.credenciales(empresaId);
      const { data } = await axios.get(`${this.api}/${idInstagram(destino)}`, {
        params: { fields: 'name,username' },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });
      return { nombre: data?.name || undefined, usuario: data?.username || undefined };
    } catch {
      return {};
    }
  }

  /** Lo que manda el cliente (foto, audio, archivo) llega como URL de Instagram. */
  async descargarAdjunto(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    return {
      buffer: Buffer.from(r.data),
      mimeType: String(r.headers['content-type'] || 'application/octet-stream').split(';')[0],
    };
  }

  // ── Conexión ───────────────────────────────────────────────────────────

  /** La URL a la que se manda al empresario para autorizar su cuenta. */
  urlDeAutorizacion(redirectUri: string, state: string): string {
    if (!this.configurado()) throw new BadRequestException('Instagram todavía no está habilitado en la plataforma.');
    const q = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_messages',
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  }

  /**
   * Cambia el `code` del login por un token de larga duración, ubica la cuenta
   * profesional, la suscribe a los mensajes y la deja guardada en la empresa.
   */
  async conectar(empresaId: number, code: string, redirectUri: string) {
    if (!this.configurado()) throw new BadRequestException('Instagram todavía no está habilitado en la plataforma.');
    let corto: string;
    try {
      const form = new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID!,
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code: String(code).replace(/#_$/, ''),
      });
      const { data } = await axios.post(this.oauthUrl, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 20000,
      });
      corto = data?.access_token;
      if (!corto) throw new Error('Instagram no devolvió el token.');
    } catch (err: any) {
      throw new BadRequestException(`No se pudo conectar Instagram: ${this.motivo(err)}`);
    }

    try {
      const { data: largo } = await axios.get(`${this.apiRaiz}/access_token`, {
        params: { grant_type: 'ig_exchange_token', client_secret: process.env.INSTAGRAM_APP_SECRET, access_token: corto },
        timeout: 20000,
      });
      const token: string = largo?.access_token;
      const expira = new Date(Date.now() + Number(largo?.expires_in || 60 * 24 * 3600) * 1000);

      // `user_id` es el id de la cuenta profesional: el mismo que llega en el
      // webhook (`entry.id`). El `id` de /me es otro (por app) y no sirve.
      const { data: me } = await axios.get(`${this.api}/me`, {
        params: { fields: 'user_id,username' },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      });
      const cuenta = String(me?.user_id || '');
      if (!cuenta) throw new Error('Instagram no devolvió la cuenta profesional.');

      const otra = await this.prisma.empresa.findFirst({
        where: { instagramAccountId: cuenta, id: { not: empresaId } },
        select: { id: true },
      });
      if (otra) throw new ConflictException('Esa cuenta de Instagram ya está conectada a otra empresa.');

      await axios.post(`${this.api}/me/subscribed_apps`, null, {
        params: { subscribed_fields: 'messages' },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      });

      await this.prisma.empresa.update({
        where: { id: empresaId },
        data: {
          instagramAccountId: cuenta,
          instagramUsername: me?.username || null,
          instagramToken: token,
          instagramTokenExpira: expira,
          instagramActivo: true,
        },
      });
      return { conectado: true, usuario: me?.username || null };
    } catch (err: any) {
      if (err instanceof ConflictException) throw err;
      throw new BadRequestException(`No se pudo conectar Instagram: ${this.motivo(err)}`);
    }
  }

  async desconectar(empresaId: number) {
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { instagramActivo: false, instagramToken: null, instagramTokenExpira: null, instagramAccountId: null },
    });
    return { conectado: false };
  }

  async estado(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { instagramActivo: true, instagramUsername: true, instagramTokenExpira: true },
    });
    return {
      disponible: this.configurado(),
      conectado: Boolean(e?.instagramActivo),
      usuario: e?.instagramUsername ?? null,
      venceToken: e?.instagramTokenExpira ?? null,
    };
  }

  /**
   * El token dura ~60 días. Se renueva cuando le quedan menos de 15: si se
   * dejara vencer, el bot dejaría de contestar en silencio y nadie lo notaría
   * hasta que un cliente se queje.
   */
  @Cron('0 30 4 * * *')
  async renovarTokens(ahora: Date = new Date()) {
    const limite = new Date(ahora.getTime() + 15 * 24 * 3600 * 1000);
    const empresas = await this.prisma.empresa.findMany({
      where: { instagramActivo: true, instagramToken: { not: null }, instagramTokenExpira: { lt: limite } },
      select: { id: true, instagramToken: true },
    });
    let renovados = 0;
    for (const e of empresas) {
      try {
        const { data } = await axios.get(`${this.apiRaiz}/refresh_access_token`, {
          params: { grant_type: 'ig_refresh_token', access_token: e.instagramToken },
          timeout: 20000,
        });
        if (!data?.access_token) continue;
        await this.prisma.empresa.update({
          where: { id: e.id },
          data: {
            instagramToken: data.access_token,
            instagramTokenExpira: new Date(ahora.getTime() + Number(data.expires_in || 60 * 24 * 3600) * 1000),
          },
        });
        renovados++;
      } catch (err: any) {
        this.logger.warn(`No se pudo renovar el token de Instagram de la empresa ${e.id}: ${this.motivo(err)}`);
      }
    }
    return { renovados };
  }
}
