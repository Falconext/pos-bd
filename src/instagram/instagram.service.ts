import { BadRequestException, ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { enTextoPlano, idInstagram, partirMensaje } from './instagram-texto';
import { esTokenAnulado, motivoTokenAnulado } from './token-meta';

type Resultado = { success: boolean; error?: string };

/** Lo que se responde mientras la cuenta espera que el empresario reconecte. */
const SIN_CONEXION = 'Instagram está desconectado: hay que volver a conectarlo desde el panel.';

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

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificaciones?: NotificacionesService,
  ) {}

  configurado(): boolean {
    return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
  }

  private async credenciales(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { instagramAccountId: true, instagramToken: true, instagramActivo: true, instagramErrorToken: true },
    });
    if (!e?.instagramAccountId || !e.instagramToken || !e.instagramActivo) {
      throw new Error('Instagram no está conectado para esta empresa.');
    }
    // Con el token anulado cada envío fallaría igual: se corta acá.
    if (e.instagramErrorToken) throw new Error(SIN_CONEXION);
    return { cuenta: e.instagramAccountId, token: e.instagramToken };
  }

  private motivo(err: any): string {
    const d = err?.response?.data?.error;
    return d?.error_user_msg || d?.message || err?.message || 'Error de Instagram';
  }

  private async enviar(
    empresaId: number,
    destinatario: { id: string } | { comment_id: string },
    message: Record<string, unknown>,
  ) {
    const { cuenta, token } = await this.credenciales(empresaId);
    try {
      await axios.post(
        `${this.api}/${cuenta}/messages`,
        { recipient: destinatario, message },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 },
      );
    } catch (err: any) {
      if (esTokenAnulado(err)) await this.marcarTokenAnulado(empresaId, err);
      throw err;
    }
  }

  /**
   * Meta anuló el token. Antes esto fallaba en silencio: el bot "respondía"
   * en la bandeja pero al cliente no le llegaba nada. Ahora la cuenta queda
   * marcada (el panel muestra "Reconectar") y se avisa a los administradores
   * una sola vez, no en cada mensaje que falle.
   */
  private async marcarTokenAnulado(empresaId: number, err: any) {
    const motivo = motivoTokenAnulado(err);
    const r = await this.prisma.empresa.updateMany({
      where: { id: empresaId, instagramErrorToken: null },
      data: { instagramErrorToken: motivo },
    });
    this.logger.warn(`Instagram de la empresa ${empresaId}: Meta anuló el token (${motivo}).`);
    if (!r.count || !this.notificaciones) return;
    await this.notificaciones
      .notificarAdminsEmpresa({
        empresaId,
        tipo: 'CRITICAL',
        titulo: 'Instagram se desconectó',
        mensaje:
          'Meta cerró el acceso de Krezka a tu Instagram (suele pasar al cambiar la clave de Instagram o Facebook). La IA de Ventas no puede responder por Instagram hasta que lo vuelvas a conectar en IA de Ventas → Instagram.',
        metaData: { tipo: 'INSTAGRAM_DESCONECTADO' },
      })
      .catch(() => undefined);
  }

  /**
   * Conversación que nació de un comentario y el cliente todavía no escribió.
   * `null` = es un DM normal.
   */
  private async comentarioPendiente(empresaId: number, destino: string) {
    const conv = await this.prisma.leadConversacion
      .findUnique({
        where: { empresaId_telefonoProspecto: { empresaId, telefonoProspecto: destino } },
        select: { id: true, igComentarioId: true, igComentarioRespondido: true },
      })
      .catch(() => null);
    return conv?.igComentarioId ? conv : null;
  }

  /**
   * Texto. Se quita el formato de WhatsApp (que Instagram muestra literal) y,
   * si pasa de 1000 bytes, sale en varios mensajes seguidos.
   */
  async enviarTexto(destino: string, texto: string, empresaId: number): Promise<Resultado> {
    try {
      const partes = partirMensaje(enTextoPlano(texto));
      const comentario = await this.comentarioPendiente(empresaId, destino);
      if (comentario) return await this.responderComentario(empresaId, comentario, partes);
      for (const parte of partes) {
        await this.enviar(empresaId, { id: idInstagram(destino) }, { text: parte });
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
  ): Promise<Resultado> {
    try {
      if (await this.comentarioPendiente(empresaId, destino)) {
        return { success: false, error: 'Instagram: al que comentó solo se le puede mandar un texto hasta que escriba.' };
      }
      await this.enviar(empresaId, { id: idInstagram(destino) }, { attachment: { type: tipo, payload: { url } } });
    } catch (err: any) {
      const error = this.motivo(err);
      this.logger.warn(`No se pudo enviar ${tipo} por Instagram a ${destino}: ${error}`);
      return { success: false, error };
    }
    // Instagram no lleva leyenda en el adjunto: va como texto aparte.
    if (caption?.trim()) return this.enviarTexto(destino, caption, empresaId);
    return { success: true };
  }

  /**
   * Respuesta privada a un comentario: Meta deja mandar UN mensaje por
   * comentario y nada más hasta que el cliente conteste. Por eso solo sale la
   * primera parte del texto y, ya enviada, lo demás se rechaza sin llamar a
   * Meta (fotos, video de bienvenida, seguimientos).
   */
  private async responderComentario(
    empresaId: number,
    conv: { id: number; igComentarioId: string | null; igComentarioRespondido: boolean },
    partes: string[],
  ): Promise<Resultado> {
    if (conv.igComentarioRespondido) {
      return { success: false, error: 'Instagram: ya se le respondió el comentario; hay que esperar que el cliente escriba.' };
    }
    if (!partes.length) return { success: true };
    await this.enviar(empresaId, { comment_id: conv.igComentarioId! }, { text: partes[0] });
    await this.prisma.leadConversacion.update({
      where: { id: conv.id },
      data: { igComentarioRespondido: true },
    });
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
      scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
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
        params: { subscribed_fields: 'messages,comments' },
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
          instagramErrorToken: null,
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
      data: {
        instagramActivo: false,
        instagramToken: null,
        instagramTokenExpira: null,
        instagramAccountId: null,
        instagramErrorToken: null,
      },
    });
    return { conectado: false };
  }

  async estado(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        instagramActivo: true,
        instagramUsername: true,
        instagramTokenExpira: true,
        instagramErrorToken: true,
        instagramComentarios: true,
        instagramComentariosClave: true,
      },
    });
    return {
      disponible: this.configurado(),
      conectado: Boolean(e?.instagramActivo),
      usuario: e?.instagramUsername ?? null,
      venceToken: e?.instagramTokenExpira ?? null,
      // Conectado pero Meta anuló el token: el panel pide reconectar.
      requiereReconectar: Boolean(e?.instagramActivo && e?.instagramErrorToken),
      motivoReconectar: e?.instagramErrorToken ?? null,
      comentarios: Boolean(e?.instagramComentarios),
      comentariosClave: e?.instagramComentariosClave ?? '',
    };
  }

  /** Responder o no los comentarios de las publicaciones, y con qué palabras. */
  async configurarComentarios(empresaId: number, activo: boolean, clave?: string | null) {
    const limpia = String(clave ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .join(', ');
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { instagramComentarios: Boolean(activo), instagramComentariosClave: limpia || null },
    });
    return this.estado(empresaId);
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
      where: {
        instagramActivo: true,
        instagramToken: { not: null },
        instagramErrorToken: null,
        instagramTokenExpira: { lt: limite },
      },
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
        if (esTokenAnulado(err)) await this.marcarTokenAnulado(e.id, err);
        this.logger.warn(`No se pudo renovar el token de Instagram de la empresa ${e.id}: ${this.motivo(err)}`);
      }
    }
    return { renovados };
  }
}
