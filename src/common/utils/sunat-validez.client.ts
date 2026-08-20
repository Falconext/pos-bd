import axios from 'axios';
import { Logger } from '@nestjs/common';

/**
 * Cliente para el servicio gratuito "Consulta de Validez de Comprobante de Pago
 * Electrónico" de SUNAT (API REST). Confirma si un CPE fue ACEPTADO por SUNAT.
 *
 * Requiere credenciales de tipo client_credentials (client_id / client_secret)
 * que el contribuyente genera una sola vez en su portal SOL:
 *   Menú SOL → Empresas → Comprobantes de pago → Consulta de validez del CPE →
 *   Credenciales de API.
 *
 * Flujo:
 *   1) OAuth2 (client_credentials) → access_token.
 *   2) POST validarcomprobante con los datos del CPE → estadoCp.
 *
 * estadoCp (según SUNAT):
 *   '0' → NO EXISTE (no registrado)
 *   '1' → ACEPTADO
 *   '2' → ANULADO / dado de baja
 *   '3' → AUTORIZADO CON REPAROS (raro)
 */

const AUTH_URL = (clientId: string) =>
  `https://api-seguridad.sunat.gob.pe/v1/clientessol/${encodeURIComponent(
    clientId,
  )}/oauth2/token/`;

const VALIDAR_URL = (ruc: string) =>
  `https://api.sunat.gob.pe/v1/contribuyente/contribuyentes/${encodeURIComponent(
    ruc,
  )}/validarcomprobante`;

const SCOPE = 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes';

export interface SunatValidezInput {
  clientId: string;
  clientSecret: string;
  rucEmisor: string;
  // Catálogo 01 SUNAT: '01' Factura, '03' Boleta, '07' NC, '08' ND.
  codComprobante: string;
  serie: string;
  numero: number | string;
  // Fecha de emisión en formato dd/mm/aaaa (requerido por SUNAT).
  fechaEmision: string;
  // Monto total del comprobante.
  monto: number | string;
}

export interface SunatValidezResult {
  // Estado normalizado de nuestro dominio.
  estado: 'ACEPTADO' | 'NO_EXISTE' | 'ANULADO' | 'DESCONOCIDO';
  estadoCp: string | null;
  estadoRuc: string | null;
  condDomiRuc: string | null;
  observaciones: string[];
  raw: any;
}

export class SunatValidezClient {
  private readonly logger = new Logger(SunatValidezClient.name);

  private async obtenerToken(
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: SCOPE,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const { data, status } = await axios.post(
      AUTH_URL(clientId),
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
        // No lanzar por código de estado: necesitamos inspeccionar la respuesta
        // real de SUNAT para dar un mensaje correcto en vez de culpar siempre a
        // las credenciales.
        validateStatus: () => true,
      },
    );
    const token = data?.access_token;
    if (!token) {
      // SUNAT devuelve 204 (sin contenido) a TODAS las solicitudes de token
      // durante sus ventanas de mantenimiento/incidencias — incluso con
      // credenciales inválidas. En ese caso NO es un problema de client_id/secret.
      if (status === 204 || data == null || data === '') {
        throw new Error(
          'SUNAT no está emitiendo token en este momento (respondió 204 sin ' +
            'contenido). Suele ser mantenimiento o incidencia temporal de SUNAT; ' +
            'reintenta más tarde (normalmente en horario diurno de Perú).',
        );
      }
      // Cualquier otra respuesta sin token sí trae el motivo real de SUNAT
      // (p. ej. { "error": "invalid_client" }): mostrarlo tal cual.
      const detalle =
        typeof data === 'string' ? data : JSON.stringify(data);
      throw new Error(
        `SUNAT rechazó la autenticación (HTTP ${status}): ${detalle}`,
      );
    }
    return token;
  }

  private mapEstado(estadoCp: string | null): SunatValidezResult['estado'] {
    switch (String(estadoCp ?? '')) {
      case '1':
        return 'ACEPTADO';
      case '0':
        return 'NO_EXISTE';
      case '2':
        return 'ANULADO';
      default:
        return 'DESCONOCIDO';
    }
  }

  async verificar(input: SunatValidezInput): Promise<SunatValidezResult> {
    const token = await this.obtenerToken(input.clientId, input.clientSecret);
    const payload = {
      numRuc: String(input.rucEmisor),
      codComp: String(input.codComprobante),
      numeroSerie: String(input.serie),
      numero: String(input.numero),
      fechaEmision: String(input.fechaEmision),
      monto: String(input.monto),
    };
    const { data } = await axios.post(VALIDAR_URL(input.rucEmisor), payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
    const d = data?.data ?? data ?? {};
    const estadoCp = d?.estadoCp != null ? String(d.estadoCp) : null;
    return {
      estado: this.mapEstado(estadoCp),
      estadoCp,
      estadoRuc: d?.estadoRuc != null ? String(d.estadoRuc) : null,
      condDomiRuc: d?.condDomiRuc != null ? String(d.condDomiRuc) : null,
      observaciones: Array.isArray(d?.observaciones) ? d.observaciones : [],
      raw: data,
    };
  }
}
