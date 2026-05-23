import { HttpException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

type JambleAuthConfig = {
  baseUrl: string;
  token?: string | null;
  username?: string | null;
  password?: string | null;
};

@Injectable()
export class JambleClient {
  private readonly logger = new Logger(JambleClient.name);
  private readonly tokenCache = new Map<string, string>();
  private readonly preferLoginToken = !['0', 'false', 'no'].includes(
    String(process.env.JAMBLE_PREFER_LOGIN_TOKEN || 'true').toLowerCase(),
  );

  private readonly issuePaths = this.parsePaths(
    process.env.JAMBLE_API_ISSUE_PATHS,
    ['/api/documents', '/documents'],
  );

  private readonly statusPaths = this.parsePaths(
    process.env.JAMBLE_API_STATUS_PATHS || process.env.JAMBLE_API_STATUS_PATH,
    ['/api/documents/{id}', '/documents/{id}', '/api/documents/record/{id}'],
  );

  private readonly sendPaths = this.parsePaths(
    process.env.JAMBLE_API_SEND_PATHS,
    ['/api/documents/send', '/documents/send', '/api/documents/send/{id}', '/documents/send/{id}'],
  );

  private readonly listPaths = this.parsePaths(
    process.env.JAMBLE_API_LIST_PATHS,
    ['/api/documents/lists/{date_ini}/{date_end}', '/documents/lists/{date_ini}/{date_end}'],
  );

  private readonly voidPathTemplate =
    process.env.JAMBLE_API_VOID_PATH || '/api/documents/{id}/void';

  private readonly loginPaths = this.parsePaths(
    process.env.JAMBLE_API_LOGIN_PATHS,
    ['/api/login', '/login', '/api/auth/login'],
  );

  async emitirDocumento(auth: JambleAuthConfig, payload: any): Promise<any> {
    const normalizedAuth = await this.resolvePreferredAuth(this.normalizeAuth(auth));
    const url = this.normalizeBaseUrl(auth.baseUrl);
    let lastError: unknown = null;

    // Try with provided auth first
    for (const path of this.issuePaths) {
      try {
        const { data } = await axios.post(
          `${url}${path}`,
          payload,
          this.buildRequestConfig(normalizedAuth),
        );
        return data;
      } catch (error) {
        lastError = error;
        if (!this.isNotFound(error)) break;
      }
    }

    // If provider says unauthenticated and we have user/pass, try obtaining token and retry once
    if (this.isUnauthorized(lastError) && normalizedAuth.username && normalizedAuth.password) {
      const fetchedToken = await this.obtenerTokenDesdeLogin(normalizedAuth).catch(() => null);
      if (fetchedToken) {
        const authWithToken: JambleAuthConfig = { ...normalizedAuth, token: fetchedToken };
        for (const path of this.issuePaths) {
          try {
            const { data } = await axios.post(
              `${url}${path}`,
              payload,
              this.buildRequestConfig(authWithToken),
            );
            return data;
          } catch (error) {
            lastError = error;
            if (!this.isNotFound(error)) break;
          }
        }
      }
    }

    throw this.wrapError('emitir documento', lastError);
  }

  async consultarDocumento(auth: JambleAuthConfig, documentId: string): Promise<any> {
    const normalizedAuth = await this.resolvePreferredAuth(this.normalizeAuth(auth));
    const url = this.normalizeBaseUrl(auth.baseUrl);
    let lastError: unknown = null;
    for (const template of this.statusPaths) {
      const path = template.replace('{id}', encodeURIComponent(String(documentId)));
      try {
        const { data } = await axios.get(`${url}${path}`, this.buildRequestConfig(normalizedAuth));
        return data;
      } catch (error) {
        lastError = error;
      }
    }

    if (this.isUnauthorized(lastError) && normalizedAuth.username && normalizedAuth.password) {
      const fetchedToken = await this.obtenerTokenDesdeLogin(normalizedAuth).catch(() => null);
      if (fetchedToken) {
        const authWithToken: JambleAuthConfig = { ...normalizedAuth, token: fetchedToken };
        for (const template of this.statusPaths) {
          const path = template.replace('{id}', encodeURIComponent(String(documentId)));
          try {
            const { data } = await axios.get(`${url}${path}`, this.buildRequestConfig(authWithToken));
            return data;
          } catch (error) {
            lastError = error;
          }
        }
      }
    }

    throw this.wrapError('consultar documento', lastError);
  }

  async enviarDocumentoSunat(auth: JambleAuthConfig, externalId: string, internalId?: string | number | null): Promise<any> {
    const normalizedAuth = await this.resolvePreferredAuth(this.normalizeAuth(auth));
    const url = this.normalizeBaseUrl(auth.baseUrl);
    let lastError: unknown = null;
    const identifiers = [String(externalId || '').trim(), String(internalId || '').trim()]
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index);

    for (const identifier of identifiers) {
      for (const template of this.sendPaths) {
        const hasParam = template.includes('{id}');
        const path = hasParam
          ? template.replace('{id}', encodeURIComponent(identifier))
          : template;

        const payload = hasParam
          ? undefined
          : { external_id: identifier };

        try {
          const { data } = await axios.post(
            `${url}${path}`,
            payload,
            this.buildRequestConfig(normalizedAuth),
          );
          return data;
        } catch (error) {
          lastError = error;
          if (this.isMethodNotAllowed(error)) {
            try {
              const { data } = await axios.get(
                `${url}${path}`,
                this.buildRequestConfig(normalizedAuth),
              );
              return data;
            } catch (getError) {
              lastError = getError;
            }
          }
        }
      }
    }

    throw this.wrapError('enviar documento a SUNAT', lastError);
  }

  async anularDocumento(auth: JambleAuthConfig, documentId: string, reason: string): Promise<any> {
    const url = this.normalizeBaseUrl(auth.baseUrl);
    const path = this.voidPathTemplate.replace('{id}', encodeURIComponent(String(documentId)));
    try {
      const { data } = await axios.post(
        `${url}${path}`,
        { reason: String(reason || '').trim() },
        this.buildRequestConfig(auth),
      );
      return data;
    } catch (error) {
      throw this.wrapError('anular documento', error);
    }
  }

  async obtenerSiguienteCorrelativo(
    auth: JambleAuthConfig,
    serie: string,
    tipoDoc: string,
  ): Promise<number | null> {
    const normalizedAuth = await this.resolvePreferredAuth(this.normalizeAuth(auth));
    const url = this.normalizeBaseUrl(auth.baseUrl);
    const now = new Date();
    const dateEnd = now.toISOString().slice(0, 10);
    const dateStart = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);

    const serieUpper = String(serie || '').trim().toUpperCase();
    const tipoDocText = String(tipoDoc || '').trim();
    if (!serieUpper || !tipoDocText) return null;

    let lastError: unknown = null;
    for (const template of this.listPaths) {
      const path = template
        .replace('{date_ini}', encodeURIComponent(dateStart))
        .replace('{date_end}', encodeURIComponent(dateEnd));
      try {
        const { data } = await axios.get(`${url}${path}`, this.buildRequestConfig(normalizedAuth));
        const records = this.extractDocumentRecords(data);
        if (!records.length) continue;

        let max = 0;
        for (const row of records) {
          const rowTipo = String(row?.document_type_id ?? row?.tipo_documento ?? row?.tipoDoc ?? '').trim();
          const rowSerieRaw = String(row?.series ?? row?.serie ?? '').trim().toUpperCase();
          const rowNumberRaw = String(
            row?.number ??
            row?.numero ??
            row?.correlativo ??
            row?.number_full ??
            row?.full_number ??
            row?.numero_completo ??
            '',
          ).trim();

          const rowSerie =
            rowSerieRaw ||
            this.extractSerieFromNumber(rowNumberRaw) ||
            '';
          if (rowSerie !== serieUpper) continue;
          if (rowTipo && rowTipo !== tipoDocText) continue;

          const rowNumber = this.extractCorrelativoNumber(rowNumberRaw, rowSerie);
          if (!Number.isNaN(rowNumber) && rowNumber > max) max = rowNumber;
        }
        if (max > 0) return max + 1;
      } catch (error) {
        lastError = error;
      }
    }

    if (this.isUnauthorized(lastError) && normalizedAuth.username && normalizedAuth.password) {
      const fetchedToken = await this.obtenerTokenDesdeLogin(normalizedAuth).catch(() => null);
      if (fetchedToken) {
        return this.obtenerSiguienteCorrelativo({ ...normalizedAuth, token: fetchedToken }, serie, tipoDoc);
      }
    }

    return null;
  }

  private normalizeBaseUrl(baseUrl: string): string {
    const raw = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!raw) return raw;

    // Permite guardar:
    // - https://facturas.app.jambleperu.com
    // - https://facturas.app.jambleperu.com/api
    // - https://facturas.app.jambleperu.com/api/documents
    // y lo normaliza al host(+/api opcional) para no duplicar rutas.
    return raw.replace(/\/(?:api\/)?documents(?:\/.*)?$/i, '');
  }

  private parsePaths(raw: string | undefined, fallback: string[]): string[] {
    const parsed = String(raw || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (item.startsWith('/') ? item : `/${item}`));

    return parsed.length ? parsed : fallback;
  }

  private normalizeAuth(auth: JambleAuthConfig): JambleAuthConfig {
    const rawToken = String(auth.token || '').trim();
    const token = rawToken.replace(/^bearer\s+/i, '').trim();
    const username = String(auth.username || '').trim();
    const password = String(auth.password || '').trim();
    const cacheKey = this.getTokenCacheKey(auth.baseUrl, username);
    const cachedToken = cacheKey ? this.tokenCache.get(cacheKey) : null;
    return {
      ...auth,
      // Prefer fresh cached token from login flow over static token
      // because some tenants rotate/issue short-lived tokens.
      token: cachedToken || token || null,
      username: username || null,
      password: password || null,
    };
  }

  private async resolvePreferredAuth(auth: JambleAuthConfig): Promise<JambleAuthConfig> {
    if (!this.preferLoginToken) return auth;
    if (!auth.username || !auth.password) return auth;

    try {
      const fetchedToken = await this.obtenerTokenDesdeLogin(auth);
      if (fetchedToken) {
        return { ...auth, token: fetchedToken };
      }
    } catch {
      // no-op: keep existing token strategy
    }

    return auth;
  }

  private extractCorrelativoNumber(raw: string, serie?: string): number {
    const plain = String(raw || '').trim();
    if (!plain) return Number.NaN;

    const direct = Number(plain);
    if (!Number.isNaN(direct)) return direct;

    const serieUpper = String(serie || '').toUpperCase();
    const seriePattern = serieUpper ? new RegExp(`${serieUpper}-(\\d{1,12})`, 'i') : /([A-Z]\d{3})-(\d{1,12})/i;
    const match = plain.match(seriePattern);
    if (!match) return Number.NaN;

    const value = Number(match[1] || match[2]);
    return Number.isNaN(value) ? Number.NaN : value;
  }

  private extractSerieFromNumber(raw: string): string {
    const text = String(raw || '').trim().toUpperCase();
    const match = text.match(/([A-Z]\d{3})-\d{1,12}/);
    return match?.[1] || '';
  }

  private buildRequestConfig(auth: JambleAuthConfig): AxiosRequestConfig {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const token = String(auth.token || '').trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers['x-api-key'] = token;
      headers['x-token'] = token;
    }

    const config: AxiosRequestConfig = {
      headers,
      timeout: 30000,
    };

    const username = String(auth.username || '').trim();
    const password = String(auth.password || '').trim();
    // IMPORTANT:
    // In axios, `auth` (Basic) overwrites any existing Authorization header.
    // If a Bearer token exists, we must NOT attach Basic auth.
    if (!token && username && password) {
      config.auth = { username, password };
    }

    return config;
  }

  private async obtenerTokenDesdeLogin(auth: JambleAuthConfig): Promise<string | null> {
    const url = this.normalizeBaseUrl(auth.baseUrl);
    const username = String(auth.username || '').trim();
    const password = String(auth.password || '').trim();
    if (!username || !password) return null;

    const payloads = [
      { email: username, password },
      { username, password },
      { user: username, password },
    ];

    for (const path of this.loginPaths) {
      for (const body of payloads) {
        try {
          const { data } = await axios.post(
            `${url}${path}`,
            body,
            {
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              timeout: 30000,
            },
          );

          const token =
            data?.token ||
            data?.access_token ||
            data?.data?.token ||
            data?.data?.access_token ||
            data?.authorization?.token;

          if (token && typeof token === 'string' && token.trim()) {
            this.logger.log(`Token JAMBLE obtenido desde ${path}`);
            const normalized = token.trim().replace(/^bearer\s+/i, '').trim();
            const cacheKey = this.getTokenCacheKey(auth.baseUrl, username);
            if (cacheKey) this.tokenCache.set(cacheKey, normalized);
            return normalized;
          }
        } catch {
          // keep trying other login variants
        }
      }
    }

    return null;
  }

  private isNotFound(error: unknown): boolean {
    const err = error as AxiosError<any>;
    return Number(err?.response?.status || 0) === 404;
  }

  private isUnauthorized(error: unknown): boolean {
    const err = error as AxiosError<any>;
    const status = Number(err?.response?.status || 0);
    if (status === 401 || status === 403) return true;

    const text = JSON.stringify(err?.response?.data || err?.message || '').toLowerCase();
    return text.includes('no se encuentra autenticado') || text.includes('unauthenticated');
  }

  private isMethodNotAllowed(error: unknown): boolean {
    const err = error as AxiosError<any>;
    const status = Number(err?.response?.status || 0);
    if (status === 405) return true;
    const text = JSON.stringify(err?.response?.data || err?.message || '').toLowerCase();
    return text.includes('método especificado') || text.includes('method not allowed');
  }

  private getTokenCacheKey(baseUrl?: string | null, username?: string | null): string | null {
    const base = String(baseUrl || '').trim().toLowerCase();
    const user = String(username || '').trim().toLowerCase();
    if (!base || !user) return null;
    return `${base}::${user}`;
  }

  private extractDocumentRecords(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.data?.data)) return data.data.data;
    if (Array.isArray(data?.records)) return data.records;
    if (Array.isArray(data?.result)) return data.result;
    return [];
  }

  private wrapError(action: string, error: unknown): HttpException {
    const err = error as AxiosError<any>;
    const providerMessage =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.response?.data?.descripcion ||
      err?.message ||
      `Error al ${action} en JAMBLE`;

    this.logger.error(
      `Error al ${action}`,
      this.sanitizeLogPayload(err?.response?.data || err?.message),
    );
    return new HttpException(`JAMBLE: ${providerMessage}`, err?.response?.status || 502);
  }

  private sanitizeLogPayload(payload: any): any {
    const LIMIT = 240;
    const HIDDEN_KEYS = new Set([
      'logo',
      'image',
      'imagen',
      'base64',
      'xml',
      'xml_unsigned',
      'cdr',
      'pdf_base64',
      'qr',
      'file',
      'content',
    ]);

    const walk = (value: any, key = ''): any => {
      if (value === null || value === undefined) return value;
      if (Array.isArray(value)) return value.map((item) => walk(item));
      if (typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
        return out;
      }
      if (typeof value === 'string') {
        const lowerKey = String(key || '').toLowerCase();
        if (HIDDEN_KEYS.has(lowerKey)) {
          return `[hidden:${lowerKey}:len=${value.length}]`;
        }
        if (value.length > LIMIT) {
          return `${value.slice(0, LIMIT)}...[truncated:${value.length - LIMIT}]`;
        }
      }
      return value;
    };

    return walk(payload);
  }
}
