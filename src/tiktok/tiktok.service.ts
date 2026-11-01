import { BadRequestException, ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { GeminiService } from '../gemini/gemini.service';
import { promptDelAsesor } from '../leads/prompt-asesor';
import { perfilValido } from '../leads/perfil-vendedor';
import { PROHIBIDO_AVISOS_MEDICOS, sinMencionesMedicas } from '../leads/alto-riesgo';
import { comentarioTiktokCalza, limpiarClaves, numeroParaMostrar, respuestaParaTiktok, soloDigitos } from './tiktok-texto';

/** Permisos que pide el login. Son los que la app tiene aprobados. */
const SCOPES = 'user.info.basic,user.info.username,video.list,comment.list,comment.list.manage';

/** Error de la API de TikTok con su código (`code` != 0 en la respuesta). */
export class TiktokApiError extends Error {
  constructor(
    message: string,
    readonly codigo?: number,
  ) {
    super(message);
  }
}

/**
 * Códigos de TikTok que significan "el token ya no sirve": hay que reconectar.
 * 40100-40199 son los de autorización (token vencido, anulado, sin permiso).
 */
export const esErrorDeToken = (codigo?: number) => typeof codigo === 'number' && codigo >= 40100 && codigo < 40200;

type Comentario = {
  comment_id: string;
  video_id?: string;
  text?: string;
  create_time?: number;
  owner?: boolean;
  parent_comment_id?: string | null;
  username?: string;
  display_name?: string;
  status?: string;
};

/**
 * TikTok para la IA de Ventas. La API de cuentas de TikTok for Business no
 * tiene mensajes directos (eso es otro permiso que TikTok aprueba aparte), así
 * que lo que hace es responder EN PÚBLICO los comentarios de los videos: una
 * respuesta corta de la IA que invita a escribir por WhatsApp.
 *
 * TikTok tampoco avisa por webhook los comentarios de una cuenta orgánica: se
 * revisan cada 5 minutos los últimos videos.
 */
@Injectable()
export class TiktokService {
  private readonly logger = new Logger(TiktokService.name);
  private corriendo = false;

  /** Base de la API. Configurable para pruebas. */
  private get api() {
    return (process.env.TIKTOK_API_URL || 'https://business-api.tiktok.com/open_api/v1.3').replace(/\/$/, '');
  }

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly gemini?: GeminiService,
    @Optional() private readonly notificaciones?: NotificacionesService,
  ) {}

  configurado(): boolean {
    return Boolean(process.env.TIKTOK_APP_ID && process.env.TIKTOK_APP_SECRET);
  }

  // ── Llamadas a la API ─────────────────────────────────────────────────

  private async llamar<T = any>(
    metodo: 'GET' | 'POST',
    ruta: string,
    opts: { token?: string; params?: Record<string, unknown>; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    let data: any;
    try {
      const r = await axios.request({
        method: metodo,
        url: `${this.api}/${ruta}`,
        params: opts.params,
        data: opts.body,
        headers: opts.token ? { 'Access-Token': opts.token } : undefined,
        timeout: 20000,
      });
      data = r.data;
    } catch (err: any) {
      data = err?.response?.data;
      if (!data) throw new TiktokApiError(err?.message || 'TikTok no respondió');
    }
    if (data?.code !== 0) {
      throw new TiktokApiError(data?.message || `TikTok respondió con el código ${data?.code}`, data?.code);
    }
    return data.data as T;
  }

  // ── Conexión ───────────────────────────────────────────────────────────

  urlDeAutorizacion(redirectUri: string, state: string): string {
    if (!this.configurado()) throw new BadRequestException('TikTok todavía no está habilitado en la plataforma.');
    const q = new URLSearchParams({
      client_key: process.env.TIKTOK_APP_ID!,
      scope: SCOPES,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize?${q}`;
  }

  /** Cambia el código del login por el token y deja la cuenta guardada. */
  async conectar(empresaId: number, code: string, redirectUri: string) {
    if (!this.configurado()) throw new BadRequestException('TikTok todavía no está habilitado en la plataforma.');
    let t: any;
    try {
      t = await this.llamar('POST', 'tt_user/oauth2/token/', {
        body: {
          client_id: process.env.TIKTOK_APP_ID,
          client_secret: process.env.TIKTOK_APP_SECRET,
          grant_type: 'authorization_code',
          auth_code: code,
          redirect_uri: redirectUri,
        },
      });
    } catch (err: any) {
      throw new BadRequestException(`No se pudo conectar TikTok: ${err?.message}`);
    }
    const openId = String(t?.open_id || '');
    if (!t?.access_token || !openId) throw new BadRequestException('TikTok no devolvió la cuenta.');

    const otra = await this.prisma.empresa.findFirst({
      where: { tiktokOpenId: openId, id: { not: empresaId } },
      select: { id: true },
    });
    if (otra) throw new ConflictException('Esa cuenta de TikTok ya está conectada a otra empresa.');

    let usuario: string | null = null;
    try {
      const cuenta = await this.llamar('GET', 'business/get/', {
        token: t.access_token,
        params: { business_id: openId, fields: JSON.stringify(['username', 'display_name']) },
      });
      usuario = cuenta?.username || cuenta?.display_name || null;
    } catch {
      // El nombre es solo para mostrar: sin él la conexión sirve igual.
    }

    const ahora = Date.now();
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        tiktokOpenId: openId,
        tiktokUsername: usuario,
        tiktokToken: t.access_token,
        tiktokTokenExpira: new Date(ahora + Number(t.expires_in || 86400) * 1000),
        tiktokRefreshToken: t.refresh_token || null,
        tiktokRefreshExpira: t.refresh_token_expires_in
          ? new Date(ahora + Number(t.refresh_token_expires_in) * 1000)
          : null,
        tiktokActivo: true,
        tiktokErrorToken: null,
      },
    });
    return { conectado: true, usuario };
  }

  async desconectar(empresaId: number) {
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        tiktokActivo: false,
        tiktokOpenId: null,
        tiktokToken: null,
        tiktokTokenExpira: null,
        tiktokRefreshToken: null,
        tiktokRefreshExpira: null,
        tiktokErrorToken: null,
        tiktokComentarios: false,
      },
    });
    return { conectado: false };
  }

  async estado(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        tiktokActivo: true,
        tiktokUsername: true,
        tiktokErrorToken: true,
        tiktokComentarios: true,
        tiktokComentariosClave: true,
      },
    });
    const whatsapp = await this.whatsappParaInvitar(empresaId);
    const ultimas = await this.prisma.tiktokComentario.findMany({
      where: { empresaId },
      orderBy: { id: 'desc' },
      take: 10,
      select: { autor: true, texto: true, respuesta: true, estado: true, error: true, creadoEn: true },
    });
    return {
      disponible: this.configurado(),
      conectado: Boolean(e?.tiktokActivo),
      usuario: e?.tiktokUsername ?? null,
      requiereReconectar: Boolean(e?.tiktokActivo && e?.tiktokErrorToken),
      motivoReconectar: e?.tiktokErrorToken ?? null,
      comentarios: Boolean(e?.tiktokComentarios),
      comentariosClave: e?.tiktokComentariosClave ?? '',
      whatsapp,
      ultimas,
    };
  }

  /**
   * Prender o apagar las respuestas. Al prender se fija desde cuándo: solo se
   * responden los comentarios nuevos, nunca los que ya estaban.
   */
  async configurarComentarios(empresaId: number, activo: boolean, clave?: string | null, whatsapp?: string | null) {
    const antes = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { tiktokComentarios: true },
    });
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        tiktokComentarios: Boolean(activo),
        tiktokComentariosClave: limpiarClaves(clave),
        ...(whatsapp !== undefined ? { tiktokWhatsapp: soloDigitos(whatsapp) } : {}),
        ...(activo && !antes?.tiktokComentarios ? { tiktokComentariosDesde: new Date() } : {}),
      },
    });
    return this.estado(empresaId);
  }

  // ── Token ─────────────────────────────────────────────────────────────

  private async marcarTokenAnulado(empresaId: number, motivo: string) {
    const r = await this.prisma.empresa.updateMany({
      where: { id: empresaId, tiktokErrorToken: null },
      data: { tiktokErrorToken: motivo.slice(0, 300) },
    });
    this.logger.warn(`TikTok de la empresa ${empresaId}: token anulado (${motivo}).`);
    if (!r.count || !this.notificaciones) return;
    await this.notificaciones
      .notificarAdminsEmpresa({
        empresaId,
        tipo: 'CRITICAL',
        titulo: 'TikTok se desconectó',
        mensaje:
          'TikTok cerró el acceso de Krezka a tu cuenta. La IA de Ventas no puede responder comentarios hasta que lo vuelvas a conectar en Perfil → TikTok.',
        metaData: { tipo: 'TIKTOK_DESCONECTADO' },
      })
      .catch(() => undefined);
  }

  /**
   * El token dura 24 h: se renueva cuando le quedan menos de 3. El refresh
   * dura un año y se renueva con él.
   */
  @Cron('0 15 * * * *', { name: 'tiktok-renovar-tokens' })
  async renovarTokens(ahora: Date = new Date()) {
    if (!this.configurado()) return { renovados: 0 };
    const empresas = await this.prisma.empresa.findMany({
      where: {
        tiktokActivo: true,
        tiktokRefreshToken: { not: null },
        tiktokErrorToken: null,
        tiktokTokenExpira: { lt: new Date(ahora.getTime() + 3 * 3600 * 1000) },
      },
      select: { id: true, tiktokRefreshToken: true },
    });
    let renovados = 0;
    for (const e of empresas) {
      try {
        const t = await this.llamar('POST', 'tt_user/oauth2/refresh_token/', {
          body: {
            client_id: process.env.TIKTOK_APP_ID,
            client_secret: process.env.TIKTOK_APP_SECRET,
            grant_type: 'refresh_token',
            refresh_token: e.tiktokRefreshToken,
          },
        });
        if (!t?.access_token) continue;
        await this.prisma.empresa.update({
          where: { id: e.id },
          data: {
            tiktokToken: t.access_token,
            tiktokTokenExpira: new Date(ahora.getTime() + Number(t.expires_in || 86400) * 1000),
            ...(t.refresh_token ? { tiktokRefreshToken: t.refresh_token } : {}),
            ...(t.refresh_token_expires_in
              ? { tiktokRefreshExpira: new Date(ahora.getTime() + Number(t.refresh_token_expires_in) * 1000) }
              : {}),
          },
        });
        renovados++;
      } catch (err: any) {
        if (err instanceof TiktokApiError && esErrorDeToken(err.codigo)) {
          await this.marcarTokenAnulado(e.id, err.message);
        } else {
          this.logger.warn(`No se pudo renovar el token de TikTok de la empresa ${e.id}: ${err?.message}`);
        }
      }
    }
    return { renovados };
  }

  // ── Comentarios ───────────────────────────────────────────────────────

  /** Cada 5 minutos: comentarios nuevos de los últimos videos de cada cuenta. */
  @Cron('0 */5 * * * *', { name: 'tiktok-comentarios' })
  async revisarComentarios(): Promise<{ respondidos: number }> {
    if (process.env.TIKTOK_JOBS_ENABLED === 'false' || this.corriendo) return { respondidos: 0 };
    if (!this.configurado() || !this.gemini?.isEnabled()) return { respondidos: 0 };
    this.corriendo = true;
    let respondidos = 0;
    try {
      const empresas = await this.prisma.empresa.findMany({
        where: {
          tiktokActivo: true,
          tiktokComentarios: true,
          tiktokErrorToken: null,
          tiktokToken: { not: null },
          tiktokOpenId: { not: null },
        },
        select: { id: true },
      });
      for (const e of empresas) {
        respondidos += await this.revisarEmpresa(e.id).catch((err: any) => {
          this.logger.warn(`TikTok comentarios, empresa ${e.id}: ${err?.message}`);
          return 0;
        });
      }
    } finally {
      this.corriendo = false;
    }
    if (respondidos) this.logger.log(`TikTok: ${respondidos} comentario(s) respondidos.`);
    return { respondidos };
  }

  /** Tope por vuelta y por cuenta: un video viral no debe gastar la IA de golpe. */
  private static readonly MAX_POR_VUELTA = 15;

  async revisarEmpresa(empresaId: number): Promise<number> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        tiktokOpenId: true,
        tiktokToken: true,
        tiktokComentariosClave: true,
        tiktokComentariosDesde: true,
      },
    });
    if (!e?.tiktokOpenId || !e.tiktokToken) return 0;
    const desde = Math.floor((e.tiktokComentariosDesde?.getTime() ?? Date.now()) / 1000);
    const token = e.tiktokToken;
    const businessId = e.tiktokOpenId;

    let videos: { item_id: string; comments?: number }[] = [];
    try {
      const r = await this.llamar('GET', 'business/video/list/', {
        token,
        params: { business_id: businessId, fields: JSON.stringify(['item_id', 'comments']), max_count: 10 },
      });
      videos = r?.videos ?? [];
    } catch (err: any) {
      if (err instanceof TiktokApiError && esErrorDeToken(err.codigo)) await this.marcarTokenAnulado(empresaId, err.message);
      throw err;
    }

    let respondidos = 0;
    for (const v of videos) {
      if (!v?.item_id || !Number(v.comments ?? 1)) continue;
      const r = await this.llamar('GET', 'business/comment/list/', {
        token,
        params: {
          business_id: businessId,
          video_id: v.item_id,
          status: 'PUBLIC',
          sort_field: 'create_time',
          sort_order: 'desc',
          max_count: 30,
        },
      });
      const nuevos = ((r?.comments ?? []) as Comentario[]).filter(
        (c) =>
          c?.comment_id &&
          !c.owner &&
          !c.parent_comment_id &&
          Number(c.create_time ?? 0) >= desde &&
          comentarioTiktokCalza(c.text ?? '', e.tiktokComentariosClave),
      );
      for (const c of nuevos.reverse()) {
        if (respondidos >= TiktokService.MAX_POR_VUELTA) return respondidos;
        if (await this.responder(empresaId, businessId, token, v.item_id, c)) respondidos++;
      }
    }
    return respondidos;
  }

  /**
   * Toma el comentario (fila única por empresa + comentario) y recién entonces
   * genera y publica. Si otro proceso ya lo tomó, no hace nada.
   */
  private async responder(empresaId: number, businessId: string, token: string, videoId: string, c: Comentario) {
    const autor = c.username ? `@${c.username}` : c.display_name || null;
    let filaId: number;
    try {
      const fila = await this.prisma.tiktokComentario.create({
        data: { empresaId, comentarioId: c.comment_id, videoId, autor, texto: String(c.text ?? '').slice(0, 1000) },
        select: { id: true },
      });
      filaId = fila.id;
    } catch (err: any) {
      if (err?.code === 'P2002') return false; // ya respondido o en curso
      throw err;
    }
    try {
      const respuesta = await this.generarRespuesta(empresaId, String(c.text ?? ''));
      if (!respuesta) throw new Error('La IA no devolvió texto.');
      await this.llamar('POST', 'business/comment/reply/create/', {
        token,
        body: { business_id: businessId, video_id: videoId, comment_id: c.comment_id, text: respuesta },
      });
      await this.prisma.tiktokComentario.update({
        where: { id: filaId },
        data: { estado: 'RESPONDIDO', respuesta },
      });
      return true;
    } catch (err: any) {
      await this.prisma.tiktokComentario.update({
        where: { id: filaId },
        data: { estado: 'ERROR', error: String(err?.message ?? err).slice(0, 300) },
      });
      if (err instanceof TiktokApiError && esErrorDeToken(err.codigo)) await this.marcarTokenAnulado(empresaId, err.message);
      return false;
    }
  }

  /**
   * El WhatsApp que la IA comparte: el que se puso en la tarjeta de TikTok, si
   * no el de la tienda, si no el del número conectado. Krezka no tenía ninguno
   * (01-11) y la IA terminó invitando a "escribir por mensaje directo", que en
   * TikTok nadie atiende.
   */
  async whatsappParaInvitar(empresaId: number): Promise<string | null> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        tiktokWhatsapp: true,
        whatsappTienda: true,
        numerosWhatsapp: { where: { principal: true }, select: { numeroVisible: true }, take: 1 },
      },
    });
    return (
      soloDigitos(e?.tiktokWhatsapp) ??
      soloDigitos(e?.whatsappTienda) ??
      soloDigitos(e?.numerosWhatsapp?.[0]?.numeroVisible) ??
      null
    );
  }

  /**
   * La respuesta pública: corta, sin precios (es público y el precio cambia) y
   * con la invitación a WhatsApp, que es donde la IA puede atender de verdad.
   */
  async generarRespuesta(empresaId: number, comentario: string): Promise<string> {
    const emp = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        razonSocial: true,
        nombreComercial: true,
        iaVentasContexto: true,
        iaVentasConfigJson: true,
        rubro: { select: { nombre: true } },
      },
    });
    if (!emp || !this.gemini) return '';
    const cfg = (emp.iaVentasConfigJson ?? {}) as { asesor?: string; vendedor?: unknown; sinAvisosMedicos?: boolean };
    const nombre = emp.nombreComercial || emp.razonSocial;
    const contexto = [emp.iaVentasContexto, cfg.sinAvisosMedicos ? PROHIBIDO_AVISOS_MEDICOS : null].filter(Boolean).join('\n');
    const whatsapp = await this.whatsappParaInvitar(empresaId);
    // Nunca "mensaje directo" ni "privado": en TikTok esos no los atiende nadie.
    const invitacion = whatsapp
      ? `Invita a escribir al WhatsApp ${numeroParaMostrar(whatsapp)} para precios y pedidos. No invites a escribir por mensaje directo ni privado.`
      : 'Invita a escribir al WhatsApp que está en el enlace del perfil para precios y pedidos. No invites a escribir por mensaje directo ni privado.';
    const system =
      promptDelAsesor({
        nombre,
        rubro: emp.rubro?.nombre ?? null,
        asesor: cfg.asesor ?? null,
        perfil: cfg.vendedor ? perfilValido(cfg.vendedor) : null,
        contexto: contexto || 'Sin información cargada del negocio.',
      }) +
      `\n\nAhora respondes un COMENTARIO PÚBLICO en un video de TikTok del negocio. Reglas: una sola respuesta de máximo 130 caracteres, en una línea, amable y natural. No des precios ni montos (es público). No inventes datos. ${invitacion} Devuelve SOLO la respuesta, sin comillas.`;
    const texto = await this.gemini.chatConHistorial(system, [{ role: 'user', content: comentario || '(comentario sin texto)' }], 120);
    return respuestaParaTiktok(cfg.sinAvisosMedicos ? sinMencionesMedicas(texto) : texto);
  }
}
