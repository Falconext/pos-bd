import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';

/** Agencia Olva normalizada para el frontend (misma forma que ShalomAgencia). */
export interface OlvaAgencia {
  /** Código de agencia Olva — es el identificador que pide POST /shipments. */
  codigo: string;
  nombre: string;
  tipo: string;
  departamento: string;
  provincia: string;
  distrito: string;
  ubigeo: string;
  direccion?: string;
  telefono?: string;
  latitud?: number;
  longitud?: number;
  /** Sede a la que pertenece la agencia (la usa el flujo de carrito). */
  sedeId?: string;
  sedeCodigo?: string;
  label: string;
}

/** Persona/empresa de un envío (remitente o destinatario). */
export interface OlvaPersona {
  name: string;
  document: string;
  documentType?: 'DNI' | 'RUC' | 'CE' | 'PAS';
  phone?: string;
  email?: string;
  address?: string;
}

/** Punto de origen/destino: agencia (oficina) o dirección (domicilio). */
export interface OlvaPunto {
  agencyCode?: string;
  address?: string;
  department?: string;
  province?: string;
  district?: string;
  reference?: string;
}

export interface OlvaPaquete {
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  description?: string;
  declaredValue?: number;
  quantity?: number;
}

export type OlvaServicio =
  | 'REGULAR'
  | 'PAGO_EN_DESTINO'
  | 'RECOJO_DOMICILIO'
  | 'CARGA';

/** Payload de POST /shipments. */
export interface OlvaShipmentInput {
  sender: OlvaPersona;
  recipient: OlvaPersona;
  origin?: OlvaPunto;
  destination?: OlvaPunto;
  package: OlvaPaquete;
  service?: OlvaServicio;
  observations?: string;
  reference?: string;
}

/** Cotización de POST /catalog/calculate. */
export interface OlvaCotizacionInput {
  ubigeo_code_origin: string;
  ubigeo_code_destiny: string;
  /** D = domicilio, O = oficina/tienda. */
  delivery_type: 'D' | 'O';
  shipment_type: number;
  weight: number;
  partner_rate: boolean;
}

/**
 * Cliente del proveedor Olva API (https://api.olva-api.lat).
 *
 * Autenticación: header `x-api-key` (una sola API key global, en OLVA_API_KEY).
 * Igual que en Shalom, el rastreo, el catálogo de agencias y la cotización se
 * cubren con la API key; lo que separa los planes es CREAR guías, que se gatea
 * en `OlvaService` (solo Corporativo) — el proveedor no exige cuenta por negocio.
 *
 * Endpoints usados:
 *  - GET  /agencies?department&province&district&q  → catálogo de agencias
 *  - GET  /agencies/nearest?lat&lng&limit           → agencias más cercanas
 *  - GET  /tracking/{nro}?fresh&year                → estado + eventos de una guía
 *  - POST /tracking/bulk    { trackingNumbers[] }   → hasta 50 guías por llamada
 *  - POST /catalog/calculate                        → cotización antes de registrar
 *  - GET  /catalog/ubigeos                          → ubigeos de Perú
 *  - GET  /catalog/article-categories               → categorías de contenido
 *  - GET  /catalog/standard-sizes                   → tamaños estándar de paquete
 *  - GET  /person/{tipoDoc}/{nroDoc}                → datos por DNI/RUC
 *  - POST /shipments        { sender, recipient, package, … } → registrar guía
 *  - POST /shipments/bulk   { shipments[] }         → hasta 25 guías por lote
 */
@Injectable()
export class OlvaApiService {
  private readonly logger = new Logger(OlvaApiService.name);
  private agenciasCache: OlvaAgencia[] | null = null;
  private lastCacheTime = 0;
  private readonly CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  // Consultas de tracking en curso por empresa+guía: el modal y el cron piden lo
  // mismo, deduplicar evita golpear dos veces a un upstream ya degradado.
  private trackInFlight = new Map<string, Promise<any>>();

  private readonly RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

  private get baseUrl(): string {
    return (process.env.OLVA_BASE_URL ?? 'https://api.olva-api.lat').replace(
      /\/$/,
      '',
    );
  }

  private get apiKey(): string {
    return process.env.OLVA_API_KEY ?? '';
  }

  private headers(): Record<string, string> {
    return { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' };
  }

  /** Petición cruda al proveedor. Lanza un Error con `.olvaStatus` en fallo. */
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
      // El proveedor devuelve { error, details, statusCode }.
      let mensaje = '';
      try {
        mensaje = JSON.parse(text)?.error || '';
      } catch {
        /* body no-JSON (p. ej. un PDF de error) */
      }
      this.logger.error(
        `Olva ${method} ${path} → ${res.status} ${text.slice(0, 300)}`,
      );
      const err: any = new Error(mensaje || `Olva respondió ${res.status}`);
      err.olvaStatus = res.status;
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
        if (!this.RETRYABLE_STATUS.has(err?.olvaStatus)) throw err;
        this.logger.warn(
          `Olva ${err?.olvaStatus} en ${path}: reintentando (${intento + 1}/3)…`,
        );
        await new Promise((r) => setTimeout(r, 800 * (intento + 1)));
      }
    }
    throw lastErr;
  }

  /** Traduce un error del proveedor a un mensaje claro para el usuario final. */
  private mensajeOlva(err: any, doc: string): string {
    const s = err?.olvaStatus;
    if (s === 500 || s === 502 || s === 503 || s === 504) {
      return 'Olva no está disponible en este momento. Intenta de nuevo en unos minutos.';
    }
    if (s === 501) {
      // El proveedor devuelve 501 cuando la operación está en modo mock o el
      // upstream de Olva no está configurado para esta cuenta.
      return (
        err?.message ||
        'Esta operación no está habilitada en tu cuenta de Olva API. Contacta al administrador.'
      );
    }
    if (s === 404) {
      return `No se pudo obtener ${doc}. Verifica el N° de guía (y su año si es de un año anterior).`;
    }
    if (s === 403) {
      return (
        err?.message ||
        'Tu plan de Olva API no permite esta operación. Contacta al administrador.'
      );
    }
    if (s === 401) {
      return 'La API key de Olva no es válida o no está configurada. Contacta al administrador.';
    }
    return err?.message || `No se pudo obtener ${doc} de Olva.`;
  }

  /** `true` si hay API key configurada (si no, solo sirve el catálogo público). */
  get configurado(): boolean {
    return Boolean(this.apiKey);
  }

  // ─── Agencias ──────────────────────────────────────────────────────────────
  // GET /agencies → { success, total, data: [ { code, name, type, department,
  //                   province, district, address, ubigeo, phone, schedule,
  //                   latitude, longitude, headquarterCode, headquarterId } ] }

  private mapAgencia(a: any): OlvaAgencia {
    const nombre = String(a.name ?? a.nombre ?? '').trim();
    const departamento = String(a.department ?? a.departamento ?? '');
    const provincia = String(a.province ?? a.provincia ?? '');
    const distrito = String(a.district ?? a.distrito ?? '');
    return {
      codigo: String(a.code ?? a.codigo ?? ''),
      nombre,
      tipo: String(a.type ?? ''),
      departamento,
      provincia,
      distrito,
      ubigeo: String(a.ubigeo ?? ''),
      direccion: a.address ? String(a.address) : undefined,
      telefono: a.phone ? String(a.phone) : undefined,
      latitud: a.latitude != null ? Number(a.latitude) : undefined,
      longitud: a.longitude != null ? Number(a.longitude) : undefined,
      sedeId: a.headquarterId != null ? String(a.headquarterId) : undefined,
      sedeCodigo: a.headquarterCode ? String(a.headquarterCode) : undefined,
      label: [nombre, provincia, departamento].filter(Boolean).join(' - '),
    };
  }

  /**
   * Catálogo completo de agencias, cacheado 12 h en memoria. Sin API key cae al
   * listado público (`/public/agencies`), que devuelve la misma forma.
   */
  async getAgencias(): Promise<{
    success: boolean;
    data: OlvaAgencia[];
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
    const path = this.apiKey ? '/agencies' : '/public/agencies';
    try {
      const res = await this.requestConReintento('GET', path);
      const raw = await res.json();
      const items: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      this.agenciasCache = items.map((a) => this.mapAgencia(a));
      this.lastCacheTime = now;
      this.logger.log(`Olva cache: ${this.agenciasCache.length} agencias`);
      return {
        success: true,
        data: this.agenciasCache,
        total: this.agenciasCache.length,
      };
    } catch (error: any) {
      this.logger.error(`Error Olva ${path}`, error?.message);
      if (this.agenciasCache)
        return { success: true, data: this.agenciasCache };
      return { success: false, data: [] };
    }
  }

  /** GET /agencies/nearest → agencias ordenadas por distancia a un punto. */
  async agenciasCercanas(
    lat: number,
    lng: number,
    limit = 5,
  ): Promise<OlvaAgencia[]> {
    try {
      const qs = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
        limit: String(limit),
      }).toString();
      const res = await this.requestConReintento(
        'GET',
        `/agencies/nearest?${qs}`,
      );
      const raw = await res.json();
      const items: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      return items.map((a) => ({
        ...this.mapAgencia(a),
        // El endpoint agrega la distancia calculada; se conserva tal cual.
        ...(a.distanceKm != null ? { distanciaKm: Number(a.distanceKm) } : {}),
      }));
    } catch (error: any) {
      this.logger.error('Error Olva /agencies/nearest', error?.message);
      return [];
    }
  }

  // ─── Tracking ──────────────────────────────────────────────────────────────
  // GET /tracking/{nro} → { success, data: { trackingNumber, status, events[] } }

  private async obtenerTrackingRaw(
    trackingNumber: string,
    opts: { year?: string; fresh?: boolean; empresaId?: number } = {},
  ): Promise<any> {
    const dedupeKey = `${opts.empresaId ?? 'env'}:${trackingNumber}:${opts.year ?? ''}:${opts.fresh ? 1 : 0}`;
    const enCurso = this.trackInFlight.get(dedupeKey);
    if (enCurso) return enCurso;

    const qs = new URLSearchParams({
      ...(opts.fresh ? { fresh: 'true' } : {}),
      ...(opts.year ? { year: opts.year } : {}),
    }).toString();
    const path = `/tracking/${encodeURIComponent(trackingNumber)}${qs ? `?${qs}` : ''}`;

    const promesa = this.requestConReintento('GET', path).then((res) =>
      res.json(),
    );
    this.trackInFlight.set(dedupeKey, promesa);
    try {
      return await promesa;
    } finally {
      this.trackInFlight.delete(dedupeKey);
    }
  }

  /** Rastreo de una guía. Devuelve `{ success, data: {...} }` normalizado. */
  async track(
    trackingNumber: string,
    opts: { year?: string; fresh?: boolean; empresaId?: number } = {},
  ): Promise<any> {
    try {
      const raw = await this.obtenerTrackingRaw(trackingNumber, opts);
      const data = raw?.data ?? raw ?? {};
      return { success: true, data };
    } catch (error: any) {
      this.logger.error('Error Olva /tracking', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(this.mensajeOlva(error, 'el tracking'));
    }
  }

  /** POST /tracking/bulk → hasta 50 guías en una sola llamada (lo usa el cron). */
  async trackBulk(
    trackingNumbers: string[],
    opts: { year?: string; fresh?: boolean } = {},
  ): Promise<any[]> {
    if (!trackingNumbers.length) return [];
    try {
      const res = await this.requestConReintento('POST', '/tracking/bulk', {
        body: {
          trackingNumbers: trackingNumbers.slice(0, 50),
          ...(opts.fresh ? { fresh: true } : {}),
          ...(opts.year ? { year: opts.year } : {}),
        },
      });
      const raw = await res.json();
      return Array.isArray(raw) ? raw : (raw?.data ?? []);
    } catch (error: any) {
      this.logger.error('Error Olva /tracking/bulk', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        this.mensajeOlva(error, 'el tracking del lote'),
      );
    }
  }

  // ─── Cotización ────────────────────────────────────────────────────────────
  // POST /catalog/calculate { ubigeo_code_origin, ubigeo_code_destiny,
  //                           delivery_type, shipment_type, weight, partner_rate }
  async cotizar(input: OlvaCotizacionInput): Promise<any> {
    try {
      const res = await this.requestConReintento('POST', '/catalog/calculate', {
        body: input,
      });
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Olva /catalog/calculate', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(this.mensajeOlva(error, 'la cotización'));
    }
  }

  // ─── Catálogos ─────────────────────────────────────────────────────────────

  /** GET /catalog/ubigeos → ubigeos de Perú (departamento/provincia/distrito). */
  async ubigeos(): Promise<any> {
    return this.catalogo('/catalog/ubigeos', 'los ubigeos');
  }

  /** GET /catalog/article-categories → categorías permitidas del contenido. */
  async categoriasArticulo(): Promise<any> {
    return this.catalogo('/catalog/article-categories', 'las categorías');
  }

  /** GET /catalog/standard-sizes → Sobre, XXS, XS, S, M, L… con peso máximo. */
  async tamanosEstandar(): Promise<any> {
    return this.catalogo('/catalog/standard-sizes', 'los tamaños');
  }

  private async catalogo(path: string, doc: string): Promise<any> {
    try {
      const res = await this.requestConReintento('GET', path);
      return await res.json();
    } catch (error: any) {
      this.logger.error(`Error Olva ${path}`, error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(this.mensajeOlva(error, doc));
    }
  }

  // ─── Personas ──────────────────────────────────────────────────────────────
  // GET /person/{docType}/{docNumber} → nombre, teléfono, email y dirección.
  async buscarPersona(
    docType: 'DNI' | 'RUC' | 'CE',
    docNumber: string,
  ): Promise<any> {
    try {
      const res = await this.requestConReintento(
        'GET',
        `/person/${docType}/${encodeURIComponent(docNumber)}`,
      );
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Olva /person', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        this.mensajeOlva(error, 'los datos del documento'),
      );
    }
  }

  // ─── Registro de guías ─────────────────────────────────────────────────────
  // POST /shipments → registra el envío y devuelve el número de guía asignado.
  async crearEnvio(input: OlvaShipmentInput): Promise<any> {
    try {
      const res = await this.requestConReintento('POST', '/shipments', {
        body: input,
      });
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Olva /shipments', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        this.mensajeOlva(error, 'el registro del envío'),
      );
    }
  }

  // POST /shipments/bulk → hasta 25 envíos; un fallo individual no aborta el lote.
  async crearEnvioBulk(shipments: OlvaShipmentInput[]): Promise<any> {
    try {
      const res = await this.requestConReintento('POST', '/shipments/bulk', {
        body: { shipments: shipments.slice(0, 25) },
      });
      return await res.json();
    } catch (error: any) {
      this.logger.error('Error Olva /shipments/bulk', error?.message);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        this.mensajeOlva(error, 'el registro masivo de envíos'),
      );
    }
  }
}
