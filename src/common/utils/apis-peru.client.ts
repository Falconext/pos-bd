import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

const BASE_URL = 'https://back.apisunat.com/api';
const BASE_URL_V1 = 'https://back.apisunat.com';
const URL_APISUNAT = 'https://apisunat.com/api';

@Injectable()
export class ApisPeruClient {
  private readonly logger = new Logger(ApisPeruClient.name);
  public client: AxiosInstance;
  public clientV1: AxiosInstance;
  public accessToken?: string;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      headers: { 'Content-Type': 'application/json' },
    });
    this.clientV1 = axios.create({
      baseURL: BASE_URL_V1,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async login(email: string, password: string): Promise<void> {
    try {
      const resp = await axios.post<{
        username: string;
        email: string;
        avatar: string;
        fullname: string;
        phone: string;
        id: string;
        accessToken: string;
      }>(`${URL_APISUNAT}/users/login`, {
        email,
        password,
      });

      this.logger.debug('RESPUESTA DE APISUNAT LOGIN');
      this.accessToken = resp.data.accessToken;
    } catch (err: any) {
      this.logger.error(
        'Error al autenticar en APISUNAT:',
        err.response?.data || err.message,
      );
      throw new Error('Error al autenticar en APISUNAT');
    }
  }

  async createCompany(payload: {
    RUC: string;
    name: string;
    address: string;
    tradename: string;
  }): Promise<{
    ruc: string;
    address: string;
    name: string;
    tradename: string;
  }> {
    if (!this.accessToken) {
      throw new Error('Debe autenticarse primero con login()');
    }

    const url = `/personas?access_token=${this.accessToken}`;

    try {
      const resp = await this.client.post<{
        ruc: string;
        address: string;
        name: string;
        tradename: string;
      }>(url, payload);

      this.logger.debug('RESPUESTA DE APISUNAT CREATE COMPANY');
      return resp.data;
    } catch (err: any) {
      this.logger.error(
        'Error al crear empresa en APISUNAT:',
        err.response?.data || err.message,
      );
      throw new Error('Error al crear empresa en APISUNAT');
    }
  }

  async listCompanies(): Promise<any[]> {
    if (!this.accessToken) {
      throw new Error('Debe autenticarse primero con login()');
    }
    const resp = await this.client.get<{ data: any[] }>('/companies');
    return resp.data.data;
  }

  async sendBill(input: {
    personaId: string;
    personaToken: string;
    fileName: string;
    documentBody: any;
    customerEmail?: string;
  }): Promise<{ status: string; documentId?: string; error?: any }> {
    try {
      const resp = await this.client.post<{
        status: string;
        documentId?: string;
        error?: any;
      }>('/personas/v1/sendBill', {
        personaId: String(input.personaId).trim(),
        personaToken: String(input.personaToken).trim(),
        fileName: String(input.fileName).trim(),
        documentBody: input.documentBody,
        ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
      });
      return resp.data;
    } catch (err: any) {
      const statusCode = err?.response?.status;
      if (statusCode === 404) {
        const fallback = await this.clientV1.post<{
          status: string;
          documentId?: string;
          error?: any;
        }>('/personas/v1/sendBill', {
          personaId: String(input.personaId).trim(),
          personaToken: String(input.personaToken).trim(),
          fileName: String(input.fileName).trim(),
          documentBody: input.documentBody,
          ...(input.customerEmail
            ? { customerEmail: input.customerEmail }
            : {}),
        });
        return fallback.data;
      }
      this.logger.error(
        'Error enviando documento a APISUNAT:',
        err.response?.data || err.message,
      );
      throw err;
    }
  }

  async getDocumentById(documentId: string): Promise<{
    status: string;
    fileName?: string;
    xml?: string;
    cdr?: string;
    faults?: any[];
    notes?: any[];
    error?: any;
  }> {
    try {
      const resp = await this.client.get<{
        status: string;
        fileName?: string;
        xml?: string;
        cdr?: string;
        faults?: any[];
        notes?: any[];
        error?: any;
      }>(`/documents/${encodeURIComponent(String(documentId).trim())}/getById`);
      return resp.data;
    } catch (err: any) {
      const statusCode = err?.response?.status;
      if (statusCode === 404) {
        const fallback = await this.clientV1.get<{
          status: string;
          fileName?: string;
          xml?: string;
          cdr?: string;
          faults?: any[];
          notes?: any[];
          error?: any;
        }>(
          `/documents/${encodeURIComponent(String(documentId).trim())}/getById`,
        );
        return fallback.data;
      }
      this.logger.error(
        'Error consultando documento en APISUNAT:',
        err.response?.data || err.message,
      );
      throw err;
    }
  }

  async voidBill(input: {
    personaId: string;
    personaToken: string;
    documentId: string;
    reason: string;
  }): Promise<{ status: string; documentId?: string; error?: any }> {
    try {
      const resp = await this.client.post<{
        status: string;
        documentId?: string;
        error?: any;
      }>('/personas/v1/voidBill', {
        personaId: String(input.personaId).trim(),
        personaToken: String(input.personaToken).trim(),
        documentId: String(input.documentId).trim(),
        reason: String(input.reason || '').trim(),
      });
      return resp.data;
    } catch (err: any) {
      const statusCode = err?.response?.status;
      if (statusCode === 404) {
        const fallback = await this.clientV1.post<{
          status: string;
          documentId?: string;
          error?: any;
        }>('/personas/v1/voidBill', {
          personaId: String(input.personaId).trim(),
          personaToken: String(input.personaToken).trim(),
          documentId: String(input.documentId).trim(),
          reason: String(input.reason || '').trim(),
        });
        return fallback.data;
      }
      this.logger.error(
        'Error anulando documento en APISUNAT:',
        err.response?.data || err.message,
      );
      throw err;
    }
  }
}
