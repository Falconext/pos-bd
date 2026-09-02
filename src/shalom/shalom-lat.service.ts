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

// Payload para registrar un envío en Shalom (POST /account/register).
// Requiere credenciales del cliente final vía instancias (/instances/*).
export interface ShalomOrderInput {
  securityCode?: string;
  shipments: any[];
}

/**
 * Cliente del proveedor Shalom API (https://api.shalom-api.lat) — versión NUEVA.
 *
 * Autenticación: header `x-api-key` (una sola API key global, en SHALOM_LAT_API_KEY).
 * Para TRACKING, AGENCIAS, COMPROBANTE, ETIQUETA y COTIZACIÓN **no se necesita**
 * cuenta de Shalom Pro ni credenciales del negocio: basta la API key. Solo crear
 * envíos (POST /account/register) requiere credenciales del cliente vía /instances.
 *
 * Endpoints usados:
 *  - GET  /agencies                              → lista de agencias
 *  - POST /track            { orderNumber, orderCode }        → tracking + timeline
 *  - GET  /track/voucher?orderNumber=&orderCode= → comprobante (PNG/PDF)
 *  - GET  /track/label?orderNumber=&orderCode=   → etiqueta (PDF)
 *  - POST /account/quote    { origin, destination }          → cotización
 *  - POST /account/register { shipments[], securityCode }    → crear envío (Pro)
 */
@Injectable()
export class ShalomLatService {
  private readonly logger = new Logger(ShalomLatService.name);
  private agenciasCache: ShalomAgencia[] | null = null;
  private lastCacheTime = 0;
  private readonly CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  // Consultas de /track en curso, por empresa+orden: track() y las descargas
  // piden lo mismo; deduplicar evita disparar varias cadenas contra un upstream
  // ya degradado.
  private trackInFlight = new Map<string, Promise<any>>();

  // Estados transitorios que vale la pena reintentar.
  private readonly RETRYABLE_STATUS = new Set([404, 429, 500, 502, 503, 504]);

  private get baseUrl(): string {
    return (
      process.env.SHALOM_LAT_BASE_URL ?? 'https://api.shalom-api.lat'
    ).replace(/\/$/, '');
  }
  private get apiKey(): string {
    return process.env.SHALOM_LAT_API_KEY ?? '';
  }

  /** Headers base: API key + JSON. */
  private headers(): Record<string, string> {
    return { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' };
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

  /** Petición con reintento ante estados transitorios (backoff incremental). */
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
    if (s === 401 || s === 403) {
      return 'La API key de Shalom no es válida o no está configurada. Contacta al administrador.';
    }
    return err?.message || `No se pudo obtener ${doc} de Shalom.`;
  }

  // ─── Agencias ──────────────────────────────────────────────────────────────
  // GET /agencies → { success, total, data: [ { ter_id, lugar, zona, provincia,
  //                   departamento, direccion, telefono, latitud, longitud } ] }
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
    // Sin key privada se puede usar el listado público (misma forma).
    const path = this.apiKey ? '/agencies' : '/public/agencies';
    try {
      const res = await this.requestConReintento('GET', path);
      const raw = await res.json();
      const items: any[] = Array.isArray(raw)
        ? raw
        : (raw?.data ?? raw?.resultados ?? raw?.agencias ?? []);
      this.agenciasCache = items.map((a): ShalomAgencia => {
        const nombre = String(a.lugar ?? a.lugar_over ?? a.nombre ?? '');
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
      this.logger.error(`Error Shalom ${path}`, error?.message);
      if (this.agenciasCache)
        return { success: true, data: this.agenciasCache };
      return { success: false, data: [] };
    }
  }

  // ─── Tracking ────────────────────────────────────────────────────────────────
  // POST /track { orderNumber, orderCode } → orden completa + timeline de estados.
  private async obtenerTrackingRaw(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<any> {
    const dedupeKey = `${empresaId ?? 'env'}:${orderNumber}:${orderCode}`;
    const enCurso = this.trackInFlight.get(dedupeKey);
    if (enCurso) return enCurso;

    const promesa = this.requestConReintento('POST', '/track', {
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
      const raw = await this.obtenerTrackingRaw(orderNumber, orderCode, empresaId);
      // Verificado con orden real: la API devuelve
      //   { search: { success, message, data: { ose_id, contenido, origen, destino,
      //     destinatario, entregado, ... } },
      //     statuses: { success, message, data: { registrado, origen, transito,
      //     destino, entregado, ... (cada uno { fecha }) } } }
      // Tanto el frontend (ShalomTrackingModal) como derivarEstadoShalom ya
      // desenvuelven `.data`, así que devolvemos la forma anidada tal cual y solo
      // elevamos `ose_id` (que el frontend usa para descargar comprobante/etiqueta).
      // `?? raw?.xxx` mantiene compatibilidad si el proveedor devolviera la forma plana.
      const searchData = raw?.search?.data ?? raw?.search ?? {};
      const oseId =
        searchData?.ose_id ?? raw?.ose_id ?? raw?.order?.ose_id ?? null;
      return {
        success: true,
        search: raw?.search ?? {},
        statuses: raw?.statuses ?? {},
        order: searchData,
        ose_id: oseId,
      };
    } catch (error: any) {
      this.logger.error('Error Shalom /track', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(this.mensajeShalom(error, 'el tracking'));
    }
  }

  // ─── Documentos ──────────────────────────────────────────────────────────────
  // GET /track/voucher → comprobante (PNG/PDF). GET /track/label → etiqueta (PDF).
  private async fetchDocumento(
    path: string,
    orderNumber: string,
    orderCode: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const qs = new URLSearchParams({ orderNumber, orderCode }).toString();
    const res = await this.requestConReintento('GET', `${path}?${qs}`);
    const contentType = res.headers.get('content-type') || 'application/pdf';
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  }

  // Comprobante del envío (GET /track/voucher → PNG/PDF).
  async ticketImage(
    orderNumber: string,
    orderCode: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      return await this.fetchDocumento('/track/voucher', orderNumber, orderCode);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(this.mensajeShalom(err, 'el comprobante'));
    }
  }

  // Etiqueta / rótulo del envío (GET /track/label → PDF).
  async label(
    orderNumber: string,
    orderCode: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      return await this.fetchDocumento('/track/label', orderNumber, orderCode);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(this.mensajeShalom(err, 'la etiqueta'));
    }
  }

  // ─── Cotización de tarifa ──────────────────────────────────────────────────
  // POST /account/quote { origin, destination }
  async quote(origin: number, destination: number): Promise<any> {
    try {
      const res = await this.requestConReintento('POST', '/account/quote', {
        body: { origin: Number(origin), destination: Number(destination) },
      });
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Shalom /account/quote', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(this.mensajeShalom(error, 'la cotización'));
    }
  }

  // ─── Crear envío ────────────────────────────────────────────────────────────
  // POST /account/register { shipments[], securityCode } → requiere credenciales
  // del cliente vía /instances (no cubierto por la API key global).
  async createOrder(input: ShalomOrderInput): Promise<any> {
    try {
      const res = await this.requestConReintento('POST', '/account/register', {
        body: { ...input },
      });
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Shalom /account/register', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(this.mensajeShalom(error, 'el registro del envío'));
    }
  }
}
