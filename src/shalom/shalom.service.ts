import { Injectable, Logger } from '@nestjs/common';

export interface ShalomAgencia {
    terId: string;
    nombre: string;
    departamento: string;
    provincia: string;
    estado: string;
    label: string;
}

@Injectable()
export class ShalomService {
    private readonly logger = new Logger(ShalomService.name);
    private agenciasCache: ShalomAgencia[] | null = null;
    private lastCacheTime = 0;
    private readonly CACHE_TTL_MS = 12 * 60 * 60 * 1000;

    private get apiKey(): string {
        return process.env.SHALOM_API_KEY ?? '';
    }

    private async shalomPost(path: string, body: object): Promise<any> {
        const res = await fetch(`https://shalom-api.lat${path}`, {
            method: 'POST',
            headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Shalom ${path} → ${res.status}`);
        return res;
    }

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
            const response = await fetch('https://shalom-api.lat/api/listar', {
                headers: { 'x-api-key': this.apiKey },
            });
            if (!response.ok) throw new Error(`Shalom API ${response.status}`);
            const raw = await response.json();
            const items: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
            this.agenciasCache = items.map((a): ShalomAgencia => {
                const nombre = String(a.lugar_over ?? a.lugar ?? '');
                const dep = String(a.departamento ?? '');
                const prov = String(a.provincia ?? '');
                return {
                    terId: String(a.ter_id ?? ''),
                    nombre,
                    departamento: dep,
                    provincia: prov,
                    estado: String(a.estadoAgencia ?? ''),
                    label: [nombre, prov, dep].filter(Boolean).join(' - '),
                };
            });
            this.lastCacheTime = now;
            this.logger.log(`Shalom cache: ${this.agenciasCache.length} agencias`);
            return { success: true, data: this.agenciasCache, total: this.agenciasCache.length };
        } catch (error) {
            this.logger.error('Error Shalom /api/listar', error?.message);
            if (this.agenciasCache) return { success: true, data: this.agenciasCache };
            return { success: false, data: [] };
        }
    }

    async track(orderNumber: string, orderCode: string): Promise<any> {
        try {
            const res = await this.shalomPost('/api/track', { orderNumber, orderCode });
            return await res.json();
        } catch (error) {
            this.logger.error('Error Shalom /api/track', error?.message);
            throw error;
        }
    }

    async ticketImage(orderNumber: string, orderCode: string): Promise<Buffer> {
        const res = await this.shalomPost('/api/ticket-image', { orderNumber, orderCode });
        const ab = await res.arrayBuffer();
        return Buffer.from(ab);
    }

    async label(orderNumber: string, orderCode: string): Promise<Buffer> {
        const res = await this.shalomPost('/api/label', { orderNumber, orderCode });
        const ab = await res.arrayBuffer();
        return Buffer.from(ab);
    }

    async quote(origin: number, destination: number): Promise<any> {
        try {
            const res = await this.shalomPost('/api/quote', { origin, destination });
            return await res.json();
        } catch (error) {
            this.logger.error('Error Shalom /api/quote', error?.message);
            throw error;
        }
    }
}
