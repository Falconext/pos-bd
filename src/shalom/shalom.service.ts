import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Credenciales Shalom Pro resueltas (empresa o env).
interface ProCreds { email?: string; password?: string; session?: string }

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
    private sessionCache = new Map<string, { token: string; expiresAt: number }>();

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Resuelve las credenciales Shalom Pro: primero las de la empresa (guardadas
     * en Configuración), y si no tiene, cae a las globales del env.
     */
    private async resolverCreds(empresaId?: number): Promise<ProCreds> {
        if (empresaId) {
            const emp = await this.prisma.empresa
                .findUnique({ where: { id: empresaId }, select: { shalomEmail: true, shalomPassword: true } })
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
        return (process.env.SHALOM_BASE_URL ?? 'https://api.shalom-api-peru.com').replace(/\/$/, '');
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
        if (!creds.email || !creds.password) throw new BadRequestException(this.MSG_SIN_PRO);

        const cacheKey = String(empresaId ?? 'env');
        const cached = this.sessionCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

        const res = await fetch(`${this.baseUrl}/v1/shalom/sessions`, {
            method: 'POST',
            headers: this.baseHeaders(),
            body: JSON.stringify({ email: creds.email, password: creds.password }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            this.logger.error(`Shalom sessions → ${res.status} ${text.slice(0, 200)}`);
            throw new BadRequestException(
                'No se pudo iniciar sesión en Shalom Pro. Verifica tu correo y contraseña de pro.shalom.pe.',
            );
        }
        const data = await res.json();
        const token = data?.session_token;
        if (!token) throw new BadRequestException('Shalom no devolvió un token de sesión válido.');
        const expiresAt = data?.expires_at ? new Date(data.expires_at).getTime() : Date.now() + 2 * 60 * 60 * 1000;
        this.sessionCache.set(cacheKey, { token, expiresAt });
        return token;
    }

    private async request(
        method: string,
        path: string,
        opts: { body?: object; sessionToken?: string } = {},
    ): Promise<Response> {
        const headers = opts.sessionToken
            ? { ...this.baseHeaders(), 'X-Shalom-Session': opts.sessionToken }
            : this.baseHeaders();
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
            try { mensaje = JSON.parse(text)?.error?.message || ''; } catch { /* body no-JSON */ }
            this.logger.error(`Shalom ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
            const err: any = new Error(mensaje || `Shalom respondió ${res.status}`);
            err.shalomStatus = res.status;
            throw err;
        }
        return res;
    }

    // ─── Agencias ────────────────────────────────────────────────────────────
    // GET /v1/agencies?page=&per_page=100 (paginado, items[]).
    async getAgencias(): Promise<{ success: boolean; data: ShalomAgencia[]; total?: number }> {
        const now = Date.now();
        if (this.agenciasCache && now - this.lastCacheTime < this.CACHE_TTL_MS) {
            return { success: true, data: this.agenciasCache, total: this.agenciasCache.length };
        }
        if (!this.apiKey) {
            this.logger.warn('SHALOM_API_KEY no configurada en .env');
            return { success: false, data: [] };
        }
        try {
            const perPage = 100;
            const acumulado: any[] = [];
            for (let page = 1; page <= 50; page++) {
                const res = await this.request('GET', `/v1/agencies?page=${page}&per_page=${perPage}`);
                const raw = await res.json();
                const items: any[] = Array.isArray(raw) ? raw : (raw?.items ?? raw?.data ?? []);
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
            return { success: true, data: this.agenciasCache, total: this.agenciasCache.length };
        } catch (error: any) {
            this.logger.error('Error Shalom /v1/agencies', error?.message);
            if (this.agenciasCache) return { success: true, data: this.agenciasCache };
            return { success: false, data: [] };
        }
    }

    // ─── Tracking ──────────────────────────────────────────────────────────────
    // GET /v1/tracking?numero=&codigo= → { order, status }
    // GET /v1/tracking/{ose_id}/events → eventos por etapa.
    // Se devuelve una forma compatible ({ search, statuses }) para el front actual,
    // más los objetos crudos (order, events, ose_id) del nuevo proveedor.
    async track(orderNumber: string, orderCode: string, empresaId?: number): Promise<any> {
        const sessionToken = await this.obtenerSessionToken(empresaId);
        try {
            const params = new URLSearchParams();
            if (orderNumber) params.set('numero', String(orderNumber));
            if (orderCode) params.set('codigo', String(orderCode));
            const res = await this.request('GET', `/v1/tracking?${params.toString()}`, { sessionToken });
            const raw = await res.json();
            const order = raw?.order ?? {};
            const status = raw?.status ?? {};
            const oseId = order?.ose_id ?? raw?.ose_id ?? null;

            let events: any = status;
            if (oseId) {
                try {
                    const evRes = await this.request('GET', `/v1/tracking/${oseId}/events`, { sessionToken });
                    events = await evRes.json();
                } catch (e: any) {
                    this.logger.warn(`No se pudieron cargar eventos de ${oseId}: ${e?.message}`);
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
            return { success: true, search, statuses: events, order, events, ose_id: oseId };
        } catch (error: any) {
            this.logger.error('Error Shalom /v1/tracking', error?.message);
            // Exponer el motivo real al frontend (no un 500 genérico).
            if (error?.status && error?.response) throw error; // ya es HttpException
            throw new BadRequestException(error?.message || 'No se pudo obtener el tracking en Shalom');
        }
    }

    /** Resuelve el ose_id a partir de numero + codigo (necesario para los PDF). */
    private async resolverOseId(orderNumber: string, orderCode: string, sessionToken: string): Promise<number> {
        const params = new URLSearchParams();
        if (orderNumber) params.set('numero', String(orderNumber));
        if (orderCode) params.set('codigo', String(orderCode));
        const res = await this.request('GET', `/v1/tracking?${params.toString()}`, { sessionToken });
        const raw = await res.json();
        const oseId = raw?.order?.ose_id ?? raw?.ose_id;
        if (!oseId) throw new Error('No se pudo resolver el ose_id de la orden');
        return Number(oseId);
    }

    // ─── Documentos (PDF) ────────────────────────────────────────────────────
    // El nuevo proveedor indexa por ose_id y entrega PDFs (no PNG).
    // "ticket" → voucher (comprobante de envío); "label" → etiqueta.
    async ticketImage(orderNumber: string, orderCode: string, empresaId?: number): Promise<Buffer> {
        const sessionToken = await this.obtenerSessionToken(empresaId);
        const oseId = await this.resolverOseId(orderNumber, orderCode, sessionToken);
        const res = await this.request('GET', `/v1/tracking/${oseId}/voucher`, { sessionToken });
        return Buffer.from(await res.arrayBuffer());
    }

    async label(orderNumber: string, orderCode: string, empresaId?: number): Promise<Buffer> {
        const sessionToken = await this.obtenerSessionToken(empresaId);
        const oseId = await this.resolverOseId(orderNumber, orderCode, sessionToken);
        const res = await this.request('GET', `/v1/orders/${oseId}/label`, { sessionToken });
        return Buffer.from(await res.arrayBuffer());
    }

    // ─── Cotización de tarifa ──────────────────────────────────────────────────
    // POST /v1/tariff/calculate { origin_terminal_id, destiny_terminal_id }
    async quote(origin: number, destination: number): Promise<any> {
        try {
            const res = await this.request('POST', '/v1/tariff/calculate', {
                body: { origin_terminal_id: Number(origin), destiny_terminal_id: Number(destination) },
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
            const res = await this.request('POST', '/v1/orders', { body: input, sessionToken });
            return await res.json();
        } catch (error: any) {
            this.logger.error('Error Shalom /v1/orders', error?.message);
            throw error;
        }
    }
}
