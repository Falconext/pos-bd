import { BadRequestException, ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { enTextoPlano, partirMensaje } from '../instagram/instagram-texto';
import { esTokenAnulado, motivoTokenAnulado } from '../instagram/token-meta';
import { idMessenger, LIMITE_BYTES_MESSENGER } from './messenger-texto';

type Resultado = { success: boolean; error?: string };
type Pagina = { id: string; nombre: string; token: string };

const SIN_CONEXION = 'Messenger está desconectado: hay que volver a conectar la página desde el panel.';
/** Cuánto vive la lista de páginas mientras el empresario elige una. */
const VIDA_SELECCION_MS = 10 * 60 * 1000;

/**
 * Messenger (página de Facebook) para la IA de Ventas. Hace lo mismo que
 * `InstagramService` pero con la página: se conecta con el login de Facebook,
 * se elige la página y su token (de página, no vence solo) es el que envía.
 *
 * Igual que Instagram: sin plantillas (fuera de las 24 h no se le puede
 * escribir), el texto sin formato de WhatsApp y los adjuntos del cliente
 * llegan como URL.
 */
@Injectable()
export class MessengerService {
  private readonly logger = new Logger(MessengerService.name);
  /** Páginas por elegir cuando la cuenta administra más de una. */
  private readonly selecciones = new Map<string, { empresaId: number; paginas: Pagina[]; vence: number }>();

  private get api() {
    return (process.env.MESSENGER_GRAPH_URL || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
  }
  private get appId() {
    return process.env.FB_APP_ID || '';
  }
  private get appSecret() {
    return process.env.META_APP_SECRET || '';
  }

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificaciones?: NotificacionesService,
  ) {}

  configurado(): boolean {
    return Boolean(this.appId && this.appSecret);
  }

  private motivo(err: any): string {
    const d = err?.response?.data?.error;
    return d?.error_user_msg || d?.message || err?.message || 'Error de Facebook';
  }

  private async credenciales(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { facebookPageId: true, facebookPageToken: true, facebookActivo: true, facebookErrorToken: true },
    });
    if (!e?.facebookPageId || !e.facebookPageToken || !e.facebookActivo) {
      throw new Error('Messenger no está conectado para esta empresa.');
    }
    if (e.facebookErrorToken) throw new Error(SIN_CONEXION);
    return { pagina: e.facebookPageId, token: e.facebookPageToken };
  }

  private async enviar(empresaId: number, psid: string, message: Record<string, unknown>) {
    const { pagina, token } = await this.credenciales(empresaId);
    try {
      await axios.post(
        `${this.api}/${pagina}/messages`,
        { recipient: { id: psid }, messaging_type: 'RESPONSE', message },
        { params: { access_token: token }, timeout: 20000 },
      );
    } catch (err: any) {
      if (esTokenAnulado(err)) await this.marcarTokenAnulado(empresaId, err);
      throw err;
    }
  }

  /** Igual que en Instagram: se marca una vez y se avisa a los administradores. */
  private async marcarTokenAnulado(empresaId: number, err: any) {
    const motivo = motivoTokenAnulado(err);
    const r = await this.prisma.empresa.updateMany({
      where: { id: empresaId, facebookErrorToken: null },
      data: { facebookErrorToken: motivo },
    });
    this.logger.warn(`Messenger de la empresa ${empresaId}: Meta anuló el token (${motivo}).`);
    if (!r.count || !this.notificaciones) return;
    await this.notificaciones
      .notificarAdminsEmpresa({
        empresaId,
        tipo: 'CRITICAL',
        titulo: 'Messenger se desconectó',
        mensaje:
          'Facebook cerró el acceso de Krezka a tu página (suele pasar al cambiar la clave de Facebook o quitar permisos). La IA de Ventas no puede responder por Messenger hasta que la vuelvas a conectar en IA de Ventas → Messenger.',
        metaData: { tipo: 'MESSENGER_DESCONECTADO' },
      })
      .catch(() => undefined);
  }

  async enviarTexto(destino: string, texto: string, empresaId: number): Promise<Resultado> {
    try {
      for (const parte of partirMensaje(enTextoPlano(texto), LIMITE_BYTES_MESSENGER)) {
        await this.enviar(empresaId, idMessenger(destino), { text: parte });
      }
      return { success: true };
    } catch (err: any) {
      const error = this.motivo(err);
      this.logger.warn(`No se pudo enviar por Messenger a ${destino}: ${error}`);
      return { success: false, error };
    }
  }

  /** Un adjunto por URL pública. Messenger sí admite PDF (`file`). */
  async enviarAdjunto(
    destino: string,
    tipo: 'image' | 'video' | 'audio' | 'file',
    url: string,
    caption: string | undefined,
    empresaId: number,
  ): Promise<Resultado> {
    try {
      await this.enviar(empresaId, idMessenger(destino), {
        attachment: { type: tipo, payload: { url, is_reusable: false } },
      });
    } catch (err: any) {
      const error = this.motivo(err);
      this.logger.warn(`No se pudo enviar ${tipo} por Messenger a ${destino}: ${error}`);
      return { success: false, error };
    }
    if (caption?.trim()) return this.enviarTexto(destino, caption, empresaId);
    return { success: true };
  }

  /** Nombre del cliente, para la bandeja. Requiere el permiso de perfil: si no, vacío. */
  async perfil(destino: string, empresaId: number): Promise<{ nombre?: string }> {
    try {
      const { token } = await this.credenciales(empresaId);
      const { data } = await axios.get(`${this.api}/${idMessenger(destino)}`, {
        params: { fields: 'first_name,last_name,name', access_token: token },
        timeout: 10000,
      });
      const nombre = data?.name || [data?.first_name, data?.last_name].filter(Boolean).join(' ');
      return { nombre: nombre || undefined };
    } catch {
      return {};
    }
  }

  async descargarAdjunto(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    return {
      buffer: Buffer.from(r.data),
      mimeType: String(r.headers['content-type'] || 'application/octet-stream').split(';')[0],
    };
  }

  // ── Conexión ───────────────────────────────────────────────────────────

  urlDeAutorizacion(redirectUri: string, state: string): string {
    if (!this.configurado()) throw new BadRequestException('Messenger todavía no está habilitado en la plataforma.');
    const version = this.api.match(/\/(v\d+\.\d+)$/)?.[1] || 'v21.0';
    // La app de Meta es de tipo negocio: el login de Facebook para empresas
    // pide los permisos con una "configuración" (MESSENGER_CONFIG_ID) en vez
    // de `scope`. Sin configurar, se piden con `scope` (apps clásicas).
    const configId = process.env.MESSENGER_CONFIG_ID;
    const q = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      ...(configId
        ? { config_id: configId }
        : { scope: 'pages_show_list,pages_messaging,pages_manage_metadata,business_management' }),
      state,
    });
    return `https://www.facebook.com/${version}/dialog/oauth?${q}`;
  }

  /**
   * Cambia el `code` por un token de usuario de larga duración y trae sus
   * páginas. Con una sola, la conecta de una vez; con varias, devuelve la
   * lista para que el empresario elija (`elegirPagina`).
   */
  async conectar(empresaId: number, code: string, redirectUri: string) {
    if (!this.configurado()) throw new BadRequestException('Messenger todavía no está habilitado en la plataforma.');
    let paginas: Pagina[];
    try {
      const { data: corto } = await axios.get(`${this.api}/oauth/access_token`, {
        params: { client_id: this.appId, client_secret: this.appSecret, redirect_uri: redirectUri, code },
        timeout: 20000,
      });
      if (!corto?.access_token) throw new Error('Facebook no devolvió el token.');
      const { data: largo } = await axios.get(`${this.api}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.appId,
          client_secret: this.appSecret,
          fb_exchange_token: corto.access_token,
        },
        timeout: 20000,
      });
      const usuario = largo?.access_token || corto.access_token;
      // Con un token de usuario de larga duración, el de página no vence.
      const { data } = await axios.get(`${this.api}/me/accounts`, {
        params: { fields: 'id,name,access_token', limit: 100, access_token: usuario },
        timeout: 20000,
      });
      paginas = (data?.data ?? [])
        .filter((p: any) => p?.id && p?.access_token)
        .map((p: any) => ({ id: String(p.id), nombre: String(p.name || p.id), token: String(p.access_token) }));
    } catch (err: any) {
      throw new BadRequestException(`No se pudo conectar Facebook: ${this.motivo(err)}`);
    }
    if (!paginas.length) {
      throw new BadRequestException('Tu cuenta de Facebook no administra ninguna página, o no le diste permiso a Krezka sobre ella.');
    }
    if (paginas.length === 1) return this.guardarPagina(empresaId, paginas[0]);

    this.limpiarSelecciones();
    const seleccion = randomBytes(16).toString('hex');
    this.selecciones.set(seleccion, { empresaId, paginas, vence: Date.now() + VIDA_SELECCION_MS });
    return { conectado: false, seleccion, paginas: paginas.map(({ id, nombre }) => ({ id, nombre })) };
  }

  async elegirPagina(empresaId: number, seleccion: string, pageId: string) {
    this.limpiarSelecciones();
    const s = this.selecciones.get(seleccion);
    if (!s || s.empresaId !== empresaId) {
      throw new BadRequestException('La selección venció. Vuelve a conectar con Facebook.');
    }
    const pagina = s.paginas.find((p) => p.id === String(pageId));
    if (!pagina) throw new BadRequestException('Esa página no está en la lista.');
    const r = await this.guardarPagina(empresaId, pagina);
    this.selecciones.delete(seleccion);
    return r;
  }

  private limpiarSelecciones() {
    const ahora = Date.now();
    for (const [k, v] of this.selecciones) if (v.vence < ahora) this.selecciones.delete(k);
  }

  /** Suscribe la página a los mensajes y la deja guardada en la empresa. */
  private async guardarPagina(empresaId: number, p: Pagina) {
    const otra = await this.prisma.empresa.findFirst({
      where: { facebookPageId: p.id, id: { not: empresaId } },
      select: { id: true },
    });
    if (otra) throw new ConflictException('Esa página de Facebook ya está conectada a otra empresa.');
    try {
      await axios.post(`${this.api}/${p.id}/subscribed_apps`, null, {
        params: { subscribed_fields: 'messages', access_token: p.token },
        timeout: 20000,
      });
    } catch (err: any) {
      throw new BadRequestException(`No se pudo suscribir la página: ${this.motivo(err)}`);
    }
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        facebookPageId: p.id,
        facebookPageNombre: p.nombre,
        facebookPageToken: p.token,
        facebookActivo: true,
        facebookErrorToken: null,
      },
    });
    return { conectado: true, pagina: p.nombre };
  }

  async desconectar(empresaId: number) {
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        facebookActivo: false,
        facebookPageToken: null,
        facebookPageId: null,
        facebookPageNombre: null,
        facebookErrorToken: null,
      },
    });
    return { conectado: false };
  }

  async estado(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { facebookActivo: true, facebookPageNombre: true, facebookErrorToken: true },
    });
    return {
      disponible: this.configurado(),
      conectado: Boolean(e?.facebookActivo),
      pagina: e?.facebookPageNombre ?? null,
      requiereReconectar: Boolean(e?.facebookActivo && e?.facebookErrorToken),
      motivoReconectar: e?.facebookErrorToken ?? null,
    };
  }
}
