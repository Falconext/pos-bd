import { HttpException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';

const DEFAULT_QPSE_BASE_URL = 'https://cpe.qpse.pe';
const DEFAULT_QPSE_PANEL_BASE_URL = 'https://cpanel.qpse.pe';
const DEFAULT_QPSE_DEMO_BASE_URL = 'https://demo-cpe.qpse.pe';
const DEFAULT_QPSE_AUTH_BASE_URL = 'https://cpanel.qpse.pe';

export interface QpseSignResponse {
  success?: boolean;
  external_id?: string;
  message?: string;
  xml?: string;
  hash?: string;
  estado?: number;
  mensaje?: string;
  codigo_hash?: string;
}

export interface QpseSendResponse {
  success?: boolean;
  connection?: boolean;
  sunat_success?: boolean | null;
  state_label?: string | null;
  code?: string | number | null;
  message?: string | null;
  notes?: string[] | null;
  errors?: string[] | null;
  cdr?: string | null;
  ticket?: string | null;
  date_reception?: string | null;
  time?: number | null;
  estado?: number;
  mensaje?: string | null;
  observaciones?: string[] | null;
  errores?: string[] | null;
}

export interface QpseCancelResponse {
  success?: boolean;
  connection?: boolean;
  code?: string | number | null;
  message?: string | null;
  mensaje?: string | null;
  state_label?: string | null;
  notes?: string[] | null;
  errors?: string[] | null;
  observaciones?: string[] | null;
  errores?: string[] | null;
}

export interface QpseAccessTokenResponse {
  token_acceso?: string;
  access_token?: string;
  expira_en?: string | number;
  expires_in?: string | number;
}

@Injectable()
export class QpseClient {
  private readonly logger = new Logger(QpseClient.name);
  private readonly baseUrl =
    (process.env.QPSE_BASE_URL || DEFAULT_QPSE_BASE_URL).replace(/\/+$/, '');
  private readonly panelBaseUrl =
    (process.env.QPSE_PANEL_BASE_URL || DEFAULT_QPSE_PANEL_BASE_URL).replace(/\/+$/, '');
  private readonly demoBaseUrl =
    (process.env.QPSE_DEMO_BASE_URL || DEFAULT_QPSE_DEMO_BASE_URL).replace(/\/+$/, '');
  private readonly authBaseUrl =
    (process.env.QPSE_AUTH_BASE_URL || DEFAULT_QPSE_AUTH_BASE_URL).replace(/\/+$/, '');
  private readonly integrationToken = process.env.QPSE_ACCESS_TOKEN;
  private readonly client: AxiosInstance;
  private readonly panelClient: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.panelClient = axios.create({
      baseURL: this.panelBaseUrl,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async obtenerTokenAcceso(input: {
    username: string;
    password: string;
  }): Promise<QpseAccessTokenResponse> {
    const username = input.username.trim();
    const password = input.password.trim();
    const url = `${this.authBaseUrl}/api/auth/cpe/token`;

    try {
      console.log(`[QPSE] Intentando token_acceso en: ${url}`);
      console.log(
        `[QPSE] Auth user: ${username} | passwordLength: ${password.length}`,
      );

      const { data } = await axios.post<QpseAccessTokenResponse>(
        url,
        {
          username,
          password,
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const token = data?.token_acceso || data?.access_token;
      if (!token) {
        throw new HttpException('QPSE no devolvió token_acceso', 502);
      }

      return {
        ...data,
        token_acceso: token,
        expira_en: data?.expira_en ?? data?.expires_in,
      };
    } catch (error) {
      throw this.wrapError('obtener token_acceso QPSE', error);
    }
  }

  async firmarXML(input: {
    accessToken: string;
    xmlFilename: string;
    xmlContentBase64: string;
  }): Promise<QpseSignResponse> {
    try {
      const { data } = await this.client.post<QpseSignResponse>(
        '/api/cpe/generar',
        {
          xml_filename: input.xmlFilename,
          xml_content_base64: input.xmlContentBase64,
        },
        {
          headers: this.buildAccessHeaders(input.accessToken),
        },
      );
      return data;
    } catch (error) {
      throw this.wrapError('firmar XML', error);
    }
  }

  async enviarXML(input: {
    accessToken: string;
    xmlFilename: string;
    externalId?: string;
    xmlSignedBase64?: string;
  }): Promise<QpseSendResponse> {
    try {
      const { data } = await this.client.post<QpseSendResponse>(
        '/api/cpe/enviar',
        {
          xml_filename: input.xmlFilename,
          ...(input.externalId ? { external_id: input.externalId } : {}),
          ...(input.xmlSignedBase64 ? { xml_signed_base64: input.xmlSignedBase64 } : {}),
        },
        {
          headers: this.buildAccessHeaders(input.accessToken),
        },
      );
      return data;
    } catch (error) {
      throw this.wrapError('enviar XML a SUNAT', error);
    }
  }

  async anularComprobante(input: {
    accessToken: string;
    externalId: string;
    motivo: string;
  }): Promise<QpseCancelResponse> {
    try {
      const { data } = await this.client.post<QpseCancelResponse>(
        '/api/cpe/anular',
        {
          external_id: input.externalId,
          reason: input.motivo,
          motivo: input.motivo,
        },
        {
          headers: this.buildAccessHeaders(input.accessToken),
        },
      );
      return data;
    } catch (error) {
      throw this.wrapError('anular comprobante en QPSE', error);
    }
  }

  async consultarTicket(identifier: string, accessToken: string): Promise<QpseSendResponse> {
    try {
      const safeIdentifier = encodeURIComponent(identifier);
      const { data } = await this.client.get<QpseSendResponse>(
        `/api/cpe/consultar/${safeIdentifier}`,
        {
          headers: this.buildAccessHeaders(accessToken),
        },
      );
      return data;
    } catch (error) {
      throw this.wrapError('consultar ticket QPSE', error);
    }
  }

  getIntegrationToken(): string | undefined {
    return this.integrationToken;
  }

  private buildAccessHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  private wrapError(action: string, error: unknown): HttpException {
    const axiosError = error as AxiosError<any>;
    const requestUrl = axiosError.config?.url || '';
    const fullUrl = requestUrl.startsWith('http')
      ? requestUrl
      : `${this.baseUrl}${requestUrl.startsWith('/') ? '' : '/'}${requestUrl}`;
    const providerMessage =
      axiosError.response?.data?.message ||
      axiosError.response?.data?.mensaje ||
      axiosError.response?.data?.error ||
      axiosError.message ||
      `Error al ${action} en QPSE`;

    console.log(`[QPSE] Error request URL: ${fullUrl}`);
    this.logger.error(`Error al ${action}`, axiosError.response?.data || axiosError.message);
    return new HttpException(`QPSE: ${providerMessage}`, axiosError.response?.status || 502);
  }
}
