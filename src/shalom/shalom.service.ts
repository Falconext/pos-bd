import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Credenciales Shalom Pro resueltas (empresa o env).
interface ProCreds {
  email?: string;
  password?: string;
  session?: string;
}

export interface ShalomAgencia {
  terId: string;
  nombre: string;
  departamento: string;
  provincia: string;
  distrito: string;
  estado: string;
  aereo: boolean;
  label: string;
}

// Payload para crear una orden/envío en Shalom (POST /v1/orders).
export interface ShalomOrderInput {
  origin_terminal_id: number;
  destiny_terminal_id: number;
  product_id: number;
  quantity: number;
  payer?: string;
  pickup_code?: string;
  receiver: {
    document_type: 'DNI' | 'RUC' | 'CE';
    document: string;
    name: string;
    last_name?: string;
    sur_name?: string;
    phone?: string;
  };
  dimensions?: { largo?: number; ancho?: number; alto?: number; peso?: number };
  aereo?: boolean;
  warranty?: number;
  collection_service?: boolean;
  documentation?: string;
  declaracion_jurada?: boolean;
  contacto_doc?: string;
}

/**
 * Cliente del proveedor Shalom API Perú (https://api.shalom-api-peru.com).
 *
 * Auth: header `X-API-Key`. Las operaciones de tracking y órdenes requieren
 * además credenciales de Shalom Pro, que se envían como `X-Shalom-Email` /
 * `X-Shalom-Password` (desde SHALOM_EMAIL / SHALOM_PASSWORD) o, si existe,
 * un token de sesión en `X-Shalom-Session` (SHALOM_SESSION).
 */
@Injectable()
export class ShalomService {
  private readonly logger = new Logger(ShalomService.name);
  private agenciasCache: ShalomAgencia[] | null = null;
  private lastCacheTime = 0;
  private readonly CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  // Caché de tokens de sesión Shalom Pro (ssk_...) por empresa/env. TTL ~2h.
  private sessionCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();
  // Logins en curso por empresa/env: deduplican peticiones concurrentes para
  // que solo se cree UNA sesión (Shalom Pro admite una sola sesión por cuenta;
  // logins simultáneos se invalidan entre sí → 401/502 en el arranque en frío).
  private sessionInFlight = new Map<string, Promise<string>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resuelve las credenciales Shalom Pro: primero las de la empresa (guardadas
   * en Configuración), y si no tiene, cae a las globales del env.
   */
  private async resolverCreds(empresaId?: number): Promise<ProCreds> {
    if (empresaId) {
      const emp = await this.prisma.empresa
        .findUnique({
          where: { id: empresaId },
          select: { shalomEmail: true, shalomPassword: true },
        })
        .catch(() => null);
      if (emp?.shalomEmail && emp?.shalomPassword) {
        return { email: emp.shalomEmail, password: emp.shalomPassword };
      }
    }
    return {
      email: process.env.SHALOM_EMAIL,
      password: process.env.SHALOM_PASSWORD,
      session: process.env.SHALOM_SESSION,
    };
  }

  private get baseUrl(): string {
    return (
      process.env.SHALOM_BASE_URL ?? 'https://api.shalom-api-peru.com'
    ).replace(/\/$/, '');
  }
  private get apiKey(): string {
    return process.env.SHALOM_API_KEY ?? '';
  }

  /** Headers base (solo API key). */
  private baseHeaders(): Record<string, string> {
    return { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' };
  }

  /** Mensaje accionable cuando faltan las credenciales Shalom Pro. */
  private readonly MSG_SIN_PRO =
    'Para consultar el tracking y generar guías necesitas conectar tu cuenta de Shalom Pro (pro.shalom.pe) en Configuración.';

  /**
   * Obtiene un token de sesión Shalom Pro (X-Shalom-Session).
   * Flujo oficial: POST /v1/shalom/sessions con {email, password} en el BODY
   * (el password NO va en headers). El token se cachea ~2h para respetar el
   * rate limit. Si ya hay un SHALOM_SESSION en el env, se usa directamente.
   */
  private async obtenerSessionToken(empresaId?: number): Promise<string> {
    const creds = await this.resolverCreds(empresaId);
    if (creds.session) return creds.session;
    if (!creds.email || !creds.password)
      throw new BadRequestException(this.MSG_SIN_PRO);

    const cacheKey = String(empresaId ?? 'env');
    const cached = this.sessionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    // Si ya hay un login en curso para esta cuenta, reusar su promesa en vez de
    // disparar otro (evita que dos sesiones simultáneas se invaliden entre sí).
    const enCurso = this.sessionInFlight.get(cacheKey);
    if (enCurso) return enCurso;

    const promesa = this.loginSession(cacheKey, creds.email, creds.password);
    this.sessionInFlight.set(cacheKey, promesa);
    try {
      return await promesa;
    } finally {
      this.sessionInFlight.delete(cacheKey);
    }
  }

  /** Realiza el login real contra Shalom Pro y cachea el token resultante. */
  private async loginSession(
    cacheKey: string,
    email: string,
    password: string,
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/shalom/sessions`, {
      method: 'POST',
      headers: this.baseHeaders(),
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(
        `Shalom sessions → ${res.status} ${text.slice(0, 200)}`,
      );
      throw new BadRequestException(
        'No se pudo iniciar sesión en Shalom Pro. Verifica tu correo y contraseña de pro.shalom.pe.',
      );
    }
    const data = await res.json();
    const token = data?.session_token;
    if (!token)
      throw new BadRequestException(
        'Shalom no devolvió un token de sesión válido.',
      );
    const expiresAt = data?.expires_at
      ? new Date(data.expires_at).getTime()
      : Date.now() + 2 * 60 * 60 * 1000;
    this.sessionCache.set(cacheKey, { token, expiresAt });
    return token;
  }

  private async request(
    method: string,
    path: string,
    opts: {
      body?: object;
      sessionToken?: string;
      proCreds?: { email?: string; password?: string };
    } = {},
  ): Promise<Response> {
    // Auth: Opción A (token de sesión) u Opción B (email + password directos).
    // Algunos endpoints (comprobante/voucher) tocan el OSE de SUNAT y solo
    // aceptan las credenciales Pro directas, no el token de sesión.
    let headers = this.baseHeaders();
    if (opts.sessionToken) {
      headers = { ...headers, 'X-Shalom-Session': opts.sessionToken };
    }
    if (opts.proCreds?.email && opts.proCreds?.password) {
      headers = {
        ...headers,
        'X-Shalom-Email': opts.proCreds.email,
        'X-Shalom-Password': opts.proCreds.password,
      };
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Extraer el mensaje legible del proveedor ({ error: { message } }) para
      // mostrarlo directo al usuario, sin el prefijo técnico.
      let mensaje = '';
      try {
        mensaje = JSON.parse(text)?.error?.message || '';
      } catch {
        /* body no-JSON */
      }
      this.logger.error(
        `Shalom ${method} ${path} → ${res.status} ${text.slice(0, 300)}`,
      );
      const err: any = new Error(mensaje || `Shalom respondió ${res.status}`);
      err.shalomStatus = res.status;
      throw err;
    }
    return res;
  }

  /** Invalida el token de sesión cacheado (fuerza re-login en la próxima petición). */
  private invalidarSession(empresaId?: number): void {
    this.sessionCache.delete(String(empresaId ?? 'env'));
  }

  /**
   * Petición autenticada con reintento automático ante 401.
   * El token de sesión se cachea ~2h, pero Shalom puede invalidarlo antes de que
   * expire localmente → la primera petición da 401 y falla. Aquí, si eso ocurre,
   * refrescamos el token y reintentamos UNA vez, de forma transparente.
   * (Soluciona el clásico "la primera vez no consulta y la segunda sí".)
   */
  // Estados transitorios en los que vale la pena refrescar la sesión y reintentar:
  // 401 (token invalidado antes de tiempo) y 502/503/504 (el gateway de Shalom
  // rechaza intermitentemente las credenciales / upstream caído).
  private readonly RETRYABLE_STATUS = new Set([401, 502, 503, 504]);

  private async requestConSesion(
    method: string,
    path: string,
    empresaId?: number,
    opts: { body?: object } = {},
  ): Promise<Response> {
    const cacheKey = String(empresaId ?? 'env');
    let lastErr: any;
    for (let intento = 0; intento < 3; intento++) {
      const sessionToken = await this.obtenerSessionToken(empresaId);
      try {
        return await this.request(method, path, { ...opts, sessionToken });
      } catch (err: any) {
        lastErr = err;
        if (!this.RETRYABLE_STATUS.has(err?.shalomStatus)) throw err;
        this.logger.warn(
          `Shalom ${err?.shalomStatus} en ${path}: refrescando sesión y reintentando (intento ${intento + 1}/3)…`,
        );
        // Solo invalidar si el token que falló sigue siendo el cacheado: otra
        // petición concurrente pudo haberlo refrescado ya (no lo pisamos).
        const cached = this.sessionCache.get(cacheKey);
        if (cached?.token === sessionToken) this.invalidarSession(empresaId);
        // Backoff incremental para dar tiempo al gateway a recuperarse.
        await new Promise((r) => setTimeout(r, 500 * (intento + 1)));
      }
    }
    throw lastErr;
  }

  // ─── Agencias ────────────────────────────────────────────────────────────
  // GET /v1/agencies?page=&per_page=100 (paginado, items[]).
  async getAgencias(): Promise<{
    success: boolean;
    data: ShalomAgencia[];
    total?: number;
  }> {
    const now = Date.now();
    if (this.agenciasCache && now - this.lastCacheTime < this.CACHE_TTL_MS) {
      return {
        success: true,
        data: this.agenciasCache,
        total: this.agenciasCache.length,
      };
    }
    if (!this.apiKey) {
      this.logger.warn('SHALOM_API_KEY no configurada en .env');
      return { success: false, data: [] };
    }
    try {
      const perPage = 100;
      const acumulado: any[] = [];
      for (let page = 1; page <= 50; page++) {
        const res = await this.request(
          'GET',
          `/v1/agencies?page=${page}&per_page=${perPage}`,
        );
        const raw = await res.json();
        const items: any[] = Array.isArray(raw)
          ? raw
          : (raw?.items ?? raw?.data ?? []);
        if (!items.length) break;
        acumulado.push(...items);
        if (items.length < perPage) break;
      }
      this.agenciasCache = acumulado.map((a): ShalomAgencia => {
        // `lugar_over` es el nombre corto/legible; `nombre` trae la ruta completa.
        const nombre = String(a.lugar_over ?? a.nombre ?? a.lugar ?? '');
        const dep = String(a.departamento ?? '');
        const prov = String(a.provincia ?? '');
        const dist = String(a.distrito ?? a.zona ?? '');
        return {
          terId: String(a.id ?? a.terminal_id ?? a.ter_id ?? ''),
          nombre,
          departamento: dep,
          provincia: prov,
          distrito: dist,
          estado: String(a.estado ?? a.estadoAgencia ?? ''),
          aereo: Boolean(a.aereo),
          label: [nombre, prov, dep].filter(Boolean).join(' - '),
        };
      });
      this.lastCacheTime = now;
      this.logger.log(`Shalom cache: ${this.agenciasCache.length} agencias`);
      return {
        success: true,
        data: this.agenciasCache,
        total: this.agenciasCache.length,
      };
    } catch (error: any) {
      this.logger.error('Error Shalom /v1/agencies', error?.message);
      if (this.agenciasCache)
        return { success: true, data: this.agenciasCache };
      return { success: false, data: [] };
    }
  }

  // ─── Tracking ──────────────────────────────────────────────────────────────
  // GET /v1/tracking?numero=&codigo= → { order, status }
  // GET /v1/tracking/{ose_id}/events → eventos por etapa.
  // Se devuelve una forma compatible ({ search, statuses }) para el front actual,
  // más los objetos crudos (order, events, ose_id) del nuevo proveedor.
  async track(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<any> {
    try {
      const params = new URLSearchParams();
      if (orderNumber) params.set('numero', String(orderNumber));
      if (orderCode) params.set('codigo', String(orderCode));
      const res = await this.requestConSesion(
        'GET',
        `/v1/tracking?${params.toString()}`,
        empresaId,
      );
      const raw = await res.json();
      const order = raw?.order ?? {};
      const status = raw?.status ?? {};
      const oseId = order?.ose_id ?? raw?.ose_id ?? null;

      let events: any = status;
      if (oseId) {
        try {
          const evRes = await this.requestConSesion(
            'GET',
            `/v1/tracking/${oseId}/events`,
            empresaId,
          );
          events = await evRes.json();
        } catch (e: any) {
          this.logger.warn(
            `No se pudieron cargar eventos de ${oseId}: ${e?.message}`,
          );
        }
      }

      // Forma compatible con el modal de trazabilidad actual (search + statuses).
      const search = {
        contenido: order?.numero_orden ?? orderNumber ?? '',
        origen: order?.origen ?? null,
        destino: order?.destino ?? null,
        destinatario: order?.destinatario ?? order?.receiver ?? null,
        entregado: Boolean(order?.entregado),
      };
      return {
        success: true,
        search,
        statuses: events,
        order,
        events,
        ose_id: oseId,
      };
    } catch (error: any) {
      this.logger.error('Error Shalom /v1/tracking', error?.message);
      // Exponer el motivo real al frontend (no un 500 genérico).
      if (error?.status && error?.response) throw error; // ya es HttpException
      throw new BadRequestException(
        error?.message || 'No se pudo obtener el tracking en Shalom',
      );
    }
  }

  /** Resuelve el ose_id a partir de numero + codigo (necesario para los PDF). */
  private async resolverOseId(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<number> {
    const params = new URLSearchParams();
    if (orderNumber) params.set('numero', String(orderNumber));
    if (orderCode) params.set('codigo', String(orderCode));
    const res = await this.requestConSesion(
      'GET',
      `/v1/tracking?${params.toString()}`,
      empresaId,
    );
    const raw = await res.json();
    const oseId = raw?.order?.ose_id ?? raw?.ose_id;
    if (!oseId) throw new Error('No se pudo resolver el ose_id de la orden');
    return Number(oseId);
  }

  /**
   * Traduce un error de Shalom a un mensaje claro para el usuario final.
   * `doc` es el nombre del documento pedido (p. ej. "comprobante", "etiqueta").
   */
  private mensajeShalom(err: any, doc: string): string {
    const s = err?.shalomStatus;
    if (s === 502 || s === 503 || s === 504) {
      return `Shalom no está disponible en este momento (su pasarela rechazó la solicitud). Intenta de nuevo en unos minutos.`;
    }
    if (s === 401) {
      return 'Tu sesión de Shalom Pro expiró. Vuelve a intentarlo.';
    }
    return err?.message || `No se pudo obtener ${doc} de Shalom.`;
  }

  // ─── Documentos (PDF) ────────────────────────────────────────────────────
  // El nuevo proveedor indexa por ose_id y entrega PDFs (no PNG).
  // "ticket" → voucher (comprobante de envío); "label" → etiqueta.

  /**
   * Descarga un documento PDF (voucher/etiqueta) por ose_id.
   * Primero intenta con el token de sesión (Opción A). Si el gateway rechaza
   * ese token hacia el upstream (502) o la sesión expira (401), reintenta con
   * las credenciales Pro directas `X-Shalom-Email`/`X-Shalom-Password`
   * (Opción B de la doc), que el upstream sí propaga. Esto resuelve el
   * "upstream rechazó las credenciales del gateway" del comprobante.
   */
  private async fetchDocumento(
    path: string,
    empresaId?: number,
  ): Promise<Buffer> {
    try {
      const res = await this.requestConSesion('GET', path, empresaId);
      return Buffer.from(await res.arrayBuffer());
    } catch (err: any) {
      if (err?.shalomStatus === 502 || err?.shalomStatus === 401) {
        const creds = await this.resolverCreds(empresaId);
        if (creds.email && creds.password) {
          this.logger.warn(
            `Shalom ${err?.shalomStatus} en ${path}: reintentando con credenciales Pro directas (Opción B)…`,
          );
          const res = await this.request('GET', path, { proCreds: creds });
          return Buffer.from(await res.arrayBuffer());
        }
      }
      throw err;
    }
  }

  async ticketImage(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<Buffer> {
    try {
      const oseId = await this.resolverOseId(orderNumber, orderCode, empresaId);
      return await this.fetchDocumento(
        `/v1/tracking/${oseId}/voucher`,
        empresaId,
      );
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      // El voucher (comprobante fiscal) puede no estar emitido todavía (404).
      // No caemos a la etiqueta: eso lo cubre el botón "Etiqueta PDF" aparte.
      if (err?.shalomStatus === 404) {
        throw new BadRequestException(
          'La orden aún no tiene comprobante emitido en Shalom. Usa "Etiqueta PDF" para la guía de envío.',
        );
      }
      throw new BadRequestException(this.mensajeShalom(err, 'el comprobante'));
    }
  }

  async label(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<Buffer> {
    try {
      const oseId = await this.resolverOseId(orderNumber, orderCode, empresaId);
      return await this.fetchDocumento(`/v1/orders/${oseId}/label`, empresaId);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(this.mensajeShalom(err, 'la etiqueta'));
    }
  }

  // ─── Cotización de tarifa ──────────────────────────────────────────────────
  // POST /v1/tariff/calculate { origin_terminal_id, destiny_terminal_id }
  async quote(origin: number, destination: number): Promise<any> {
    try {
      const res = await this.request('POST', '/v1/tariff/calculate', {
        body: {
          origin_terminal_id: Number(origin),
          destiny_terminal_id: Number(destination),
        },
      });
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Shalom /v1/tariff/calculate', error?.message);
      throw error;
    }
  }

  // ─── Crear orden / envío ────────────────────────────────────────────────────
  // POST /v1/orders → { guia, serie, codigo }
  async createOrder(input: ShalomOrderInput, empresaId?: number): Promise<any> {
    const sessionToken = await this.obtenerSessionToken(empresaId);
    try {
      const res = await this.request('POST', '/v1/orders', {
        body: input,
        sessionToken,
      });
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Shalom /v1/orders', error?.message);
      throw error;
    }
  }
}
