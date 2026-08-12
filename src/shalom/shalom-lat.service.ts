import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';

export interface ShalomAgencia {
  terId: string;
  nombre: string;
  departamento: string;
  provincia: string;
  distrito: string;
  estado: string;
  aereo: boolean;
  label: string;
  direccion?: string;
  telefono?: string;
  latitud?: string;
  longitud?: string;
}

// Payload para registrar un envío individual en Shalom Pro.
// Doc: POST /api/register-individual (requiere plan Pro + instanceId).
export interface ShalomOrderInput {
  instanceId?: string;
  origen: number | string;
  destino: number | string;
  content: string;
  cantidad: number;
  documento: string;
  name: string;
  firstname?: string;
  lastname?: string;
  phone: number | string;
  clave?: string;
  declaracion_jurada?: string;
}

/**
 * Cliente del proveedor Shalom API Perú (https://shalom-api.lat).
 *
 * Autenticación: header `x-api-key` (una sola API key global, en
 * SHALOM_LAT_API_KEY). A diferencia del proveedor anterior, este NO requiere
 * credenciales Shalom Pro (email/password) ni tokens de sesión para consultar
 * tracking, agencias, comprobante, etiqueta ni cotización.
 *
 * Endpoints usados:
 *  - GET  /api/listar                         → lista completa de agencias
 *  - POST /api/track        { orderNumber, orderCode }  → tracking { search, statuses }
 *  - POST /api/ticket-image { orderNumber, orderCode }  → comprobante (PNG)
 *  - POST /api/label        { orderNumber, orderCode }  → etiqueta (PDF)
 *  - POST /api/quote        { origin, destination }     → cotización (JSON)
 *  - POST /api/register-individual { instanceId, ... }  → crear envío (plan Pro)
 */
@Injectable()
export class ShalomLatService {
  private readonly logger = new Logger(ShalomLatService.name);
  private agenciasCache: ShalomAgencia[] | null = null;
  private lastCacheTime = 0;
  private readonly CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  // Consultas de /api/track en curso, por empresa+orden: track() y las
  // descargas (ticket/label) piden lo mismo; deduplicar evita disparar varias
  // cadenas de scraping contra un upstream ya degradado.
  private trackInFlight = new Map<string, Promise<any>>();

  // Estados transitorios que vale la pena reintentar: el scraper de Shalom
  // devuelve 500 "fetch failed" / 404 "No se pudieron cargar los datos" de
  // forma intermitente cuando su upstream está saturado.
  private readonly RETRYABLE_STATUS = new Set([404, 429, 500, 502, 503, 504]);

  private get baseUrl(): string {
    return (process.env.SHALOM_LAT_BASE_URL ?? 'https://shalom-api.lat').replace(
      /\/$/,
      '',
    );
  }
  private get apiKey(): string {
    return process.env.SHALOM_LAT_API_KEY ?? '';
  }

  /** Headers base: API key + JSON. */
  private headers(): Record<string, string> {
    return { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' };
  }

  /** Resuelve el instanceId de Shalom Pro (global, SHALOM_LAT_INSTANCE_ID). */
  private resolverInstanceId(): string | undefined {
    return process.env.SHALOM_LAT_INSTANCE_ID || undefined;
  }

  /** Petición cruda al proveedor. Lanza un Error con `.shalomStatus` en fallo. */
  private async request(
    method: string,
    path: string,
    opts: { body?: object } = {},
  ): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // El proveedor devuelve { error: "mensaje" }; extraerlo para el usuario.
      let mensaje = '';
      try {
        mensaje = JSON.parse(text)?.error || '';
      } catch {
        /* body no-JSON (p. ej. un PDF de error) */
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

  /**
   * Petición con reintento ante estados transitorios. El scraper de Shalom
   * falla de forma intermitente (500 "fetch failed", 404 "No se pudieron
   * cargar los datos") cuando su upstream está saturado; reintentar con backoff
   * resuelve el clásico "la primera vez no consulta y la segunda sí".
   */
  private async requestConReintento(
    method: string,
    path: string,
    opts: { body?: object } = {},
  ): Promise<Response> {
    let lastErr: any;
    for (let intento = 0; intento < 3; intento++) {
      try {
        return await this.request(method, path, opts);
      } catch (err: any) {
        lastErr = err;
        if (!this.RETRYABLE_STATUS.has(err?.shalomStatus)) throw err;
        this.logger.warn(
          `Shalom ${err?.shalomStatus} en ${path}: reintentando (${intento + 1}/3)…`,
        );
        await new Promise((r) => setTimeout(r, 800 * (intento + 1)));
      }
    }
    throw lastErr;
  }

  /** Traduce un error del proveedor a un mensaje claro para el usuario final. */
  private mensajeShalom(err: any, doc: string): string {
    const s = err?.shalomStatus;
    if (s === 500 || s === 502 || s === 503 || s === 504) {
      return 'Shalom no está disponible en este momento (su servicio de rastreo no respondió). Intenta de nuevo en unos minutos.';
    }
    if (s === 404) {
      return `No se pudo obtener ${doc}. Verifica el N° de orden y la clave, o intenta de nuevo en unos minutos.`;
    }
    if (s === 401) {
      return 'La API key de Shalom no es válida o no está configurada. Contacta al administrador.';
    }
    return err?.message || `No se pudo obtener ${doc} de Shalom.`;
  }

  // ─── Agencias ──────────────────────────────────────────────────────────────
  // GET /api/listar → lista completa de agencias.
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
      this.logger.warn('SHALOM_LAT_API_KEY no configurada en .env');
      return { success: false, data: [] };
    }
    try {
      const res = await this.requestConReintento('GET', '/api/listar');
      const raw = await res.json();
      const items: any[] = Array.isArray(raw)
        ? raw
        : (raw?.resultados ?? raw?.data ?? raw?.agencias ?? []);
      this.agenciasCache = items.map((a): ShalomAgencia => {
        // `lugar_over` es el nombre corto/legible de la agencia.
        const nombre = String(a.lugar_over ?? a.nombre ?? a.lugar ?? '');
        const dep = String(a.departamento ?? '');
        const prov = String(a.provincia ?? '');
        const dist = String(a.zona ?? a.distrito ?? '');
        return {
          terId: String(a.ter_id ?? a.id ?? a.terminal_id ?? ''),
          nombre,
          departamento: dep,
          provincia: prov,
          distrito: dist,
          estado: String(a.estado ?? ''),
          aereo: Boolean(a.aereo),
          label: [nombre, prov, dep].filter(Boolean).join(' - '),
          direccion: a.direccion ? String(a.direccion) : undefined,
          telefono: a.telefono ? String(a.telefono) : undefined,
          latitud: a.latitud ? String(a.latitud) : undefined,
          longitud: a.longitud ? String(a.longitud) : undefined,
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
      this.logger.error('Error Shalom /api/listar', error?.message);
      if (this.agenciasCache)
        return { success: true, data: this.agenciasCache };
      return { success: false, data: [] };
    }
  }

  // ─── Tracking ────────────────────────────────────────────────────────────────
  // POST /api/track { orderNumber, orderCode } → { search, statuses }
  private async obtenerTrackingRaw(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<any> {
    const dedupeKey = `${empresaId ?? 'env'}:${orderNumber}:${orderCode}`;
    const enCurso = this.trackInFlight.get(dedupeKey);
    if (enCurso) return enCurso;

    const promesa = this.requestConReintento('POST', '/api/track', {
      body: { orderNumber, orderCode },
    }).then((res) => res.json());
    this.trackInFlight.set(dedupeKey, promesa);
    try {
      return await promesa;
    } finally {
      this.trackInFlight.delete(dedupeKey);
    }
  }

  async track(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<any> {
    try {
      const raw = await this.obtenerTrackingRaw(
        orderNumber,
        orderCode,
        empresaId,
      );
      // El proveedor ya devuelve { search, statuses }; se pasa tal cual y se
      // añade ose_id si viene (para las descargas de comprobante/etiqueta).
      const oseId =
        raw?.ose_id ?? raw?.order?.ose_id ?? raw?.search?.ose_id ?? null;
      return { success: true, ...raw, ose_id: oseId };
    } catch (error: any) {
      this.logger.error('Error Shalom /api/track', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(this.mensajeShalom(error, 'el tracking'));
    }
  }

  // ─── Documentos ──────────────────────────────────────────────────────────────
  // POST /api/ticket-image → comprobante (PNG). POST /api/label → etiqueta (PDF).
  private async fetchDocumento(
    path: string,
    orderNumber: string,
    orderCode: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const res = await this.requestConReintento('POST', path, {
      body: { orderNumber, orderCode },
    });
    const contentType = res.headers.get('content-type') || 'application/pdf';
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  }

  // Comprobante del envío (POST /api/ticket-image → PNG).
  async ticketImage(
    orderNumber: string,
    orderCode: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      return await this.fetchDocumento(
        '/api/ticket-image',
        orderNumber,
        orderCode,
      );
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(this.mensajeShalom(err, 'el comprobante'));
    }
  }

  // Etiqueta / rótulo del envío (POST /api/label → PDF).
  async label(
    orderNumber: string,
    orderCode: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      return await this.fetchDocumento('/api/label', orderNumber, orderCode);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(this.mensajeShalom(err, 'la etiqueta'));
    }
  }

  // ─── Cotización de tarifa ──────────────────────────────────────────────────
  // POST /api/quote { origin, destination }
  async quote(origin: number, destination: number): Promise<any> {
    try {
      const res = await this.requestConReintento('POST', '/api/quote', {
        body: { origin: Number(origin), destination: Number(destination) },
      });
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Shalom /api/quote', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(this.mensajeShalom(error, 'la cotización'));
    }
  }

  // ─── Crear envío (Shalom Pro) ────────────────────────────────────────────────
  // POST /api/register-individual { instanceId, origen, destino, ... } → requiere plan Pro.
  async createOrder(input: ShalomOrderInput): Promise<any> {
    const instanceId = input.instanceId ?? this.resolverInstanceId();
    if (!instanceId) {
      throw new BadRequestException(
        'Para registrar envíos en Shalom necesitas conectar tu Instancia Pro (instanceId) en Configuración.',
      );
    }
    try {
      const res = await this.requestConReintento(
        'POST',
        '/api/register-individual',
        { body: { ...input, instanceId } },
      );
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Shalom /api/register-individual', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(this.mensajeShalom(error, 'el registro del envío'));
    }
  }
}
