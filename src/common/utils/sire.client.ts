import axios from 'axios';

/**
 * Cliente de la API del SIRE de SUNAT (RVIE/RCE).
 *
 * Diferencias con la API de "Consulta de Validez" (`sunat-validez.client.ts`),
 * verificadas contra SUNAT el 2026-09-22 con credenciales reales:
 *
 *  - El token se pide en `/clientessol/...` (no `/clientesextranet/...`).
 *  - Usa `grant_type=password`: además del client_id/secret exige el USUARIO y
 *    la CLAVE SOL (`username` = RUC + usuario SOL).
 *  - El scope es `https://api-sire.sunat.gob.pe`.
 *  - Las credenciales se generan aparte, en Menú SOL → Credenciales de API
 *    SUNAT → Gestión, marcando el servicio "MIGE RCE y RVIE - SIRE". Las de
 *    Consulta de Validez NO sirven: SUNAT responde `unauthorized_client`.
 *
 * Errores típicos y qué significan (observados en pruebas):
 *  - 400 `access_denied` "Error en la autenticacion del usuario" → usuario o
 *    clave SOL incorrectos.
 *  - 401 `unauthorized_client` → el client_id no tiene habilitado el SIRE.
 *  - 401 del gateway (HTML de nginx) al llamar un recurso → credenciales aún no
 *    propagadas del lado de SUNAT, o sin permiso sobre ese recurso.
 */

const AUTH_URL = (clientId: string) =>
  `https://api-seguridad.sunat.gob.pe/v1/clientessol/${encodeURIComponent(
    clientId,
  )}/oauth2/token/`;

const SCOPE = 'https://api-sire.sunat.gob.pe';
export const SIRE_BASE = 'https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv';

export interface SireCredenciales {
  ruc: string;
  clientId: string;
  clientSecret: string;
  usuarioSol: string;
  claveSol: string;
}

export class SireError extends Error {
  constructor(
    message: string,
    /** Pista accionable para mostrarle al usuario en la UI. */
    readonly detalle?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SireError';
  }
}

export class SireClient {
  /** Token por empresa, reusado mientras no venza (SUNAT lo da por ~1 hora). */
  private static cache = new Map<string, { token: string; venceEn: number }>();

  constructor(private readonly cred: SireCredenciales) {}

  private get cacheKey() {
    return `${this.cred.ruc}|${this.cred.clientId}`;
  }

  /** Token de acceso al SIRE. Reusa el vigente si queda más de un minuto. */
  async obtenerToken(): Promise<string> {
    const enCache = SireClient.cache.get(this.cacheKey);
    if (enCache && enCache.venceEn - Date.now() > 60_000) return enCache.token;

    const body = new URLSearchParams({
      grant_type: 'password',
      scope: SCOPE,
      client_id: this.cred.clientId,
      client_secret: this.cred.clientSecret,
      // SUNAT espera RUC + usuario SOL pegados, sin separador.
      username: `${this.cred.ruc}${this.cred.usuarioSol}`,
      password: this.cred.claveSol,
    });

    try {
      const resp = await axios.post(AUTH_URL(this.cred.clientId), body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 20000,
      });
      const token = String(resp.data?.access_token ?? '');
      if (!token) {
        throw new SireError(
          'SUNAT no devolvió un token de acceso al SIRE.',
          'Revisa las credenciales en Perfil → Configuración.',
        );
      }
      const segundos = Number(resp.data?.expires_in) || 3600;
      SireClient.cache.set(this.cacheKey, {
        token,
        venceEn: Date.now() + segundos * 1000,
      });
      return token;
    } catch (e: any) {
      if (e instanceof SireError) throw e;
      const status = e?.response?.status;
      const err = String(e?.response?.data?.error ?? '');
      if (err === 'access_denied') {
        throw new SireError(
          'SUNAT rechazó el usuario o la clave SOL.',
          'Verifica el usuario SOL y su clave en Perfil → Configuración.',
          status,
        );
      }
      if (err === 'unauthorized_client' || status === 401) {
        throw new SireError(
          'Las credenciales de API no están habilitadas para el SIRE.',
          'Genera las credenciales en Menú SOL → Credenciales de API SUNAT → Gestión, marcando "MIGE RCE y RVIE - SIRE". Si acabas de crearlas, SUNAT puede tardar en activarlas.',
          status,
        );
      }
      if (err === 'invalid_scope') {
        throw new SireError(
          'SUNAT no reconoce el permiso solicitado para el SIRE.',
          'La aplicación registrada no incluye el servicio "MIGE RCE y RVIE - SIRE".',
          status,
        );
      }
      throw new SireError(
        'No se pudo conectar con el SIRE de SUNAT.',
        e?.message,
        status,
      );
    }
  }

  /** GET autenticado contra el SIRE, con los errores ya traducidos. */
  async get<T = any>(path: string, responseType: 'json' | 'text' = 'json') {
    const token = await this.obtenerToken();
    try {
      const resp = await axios.get<T>(`${SIRE_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 60000,
        responseType: responseType === 'text' ? 'text' : 'json',
      });
      return resp.data;
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401) {
        throw new SireError(
          'SUNAT rechazó el acceso al SIRE (401).',
          'Las credenciales son válidas pero SUNAT todavía no habilita el acceso a este recurso. Si las acabas de crear, vuelve a intentar más tarde.',
          status,
        );
      }
      if (status === 429) {
        throw new SireError(
          'SUNAT está limitando las consultas (429).',
          'Espera unos minutos antes de volver a intentar.',
          status,
        );
      }
      throw new SireError(
        'El SIRE de SUNAT respondió con un error.',
        `HTTP ${status ?? '?'}`,
        status,
      );
    }
  }

  /**
   * Pide la propuesta del RCE (compras que SUNAT tiene a nombre del RUC) de un
   * período AAAAMM. SUNAT trabaja con tickets: primero se solicita la
   * exportación y luego se consulta/descarga.
   *
   * PENDIENTE DE VERIFICACIÓN: mientras el gateway devuelva 401 no se pudo
   * comprobar la ruta ni la forma de la respuesta. Por eso el path es
   * configurable con `SIRE_RCE_PROPUESTA_PATH`: si SUNAT usa otra, se ajusta
   * por variable de entorno sin tocar el código.
   */
  async solicitarPropuestaRce(periodo: string): Promise<any> {
    const plantilla =
      process.env.SIRE_RCE_PROPUESTA_PATH ||
      '/libros/rce/propuesta/web/propuesta/{periodo}/exportacioncomprobantepropuesta?codTipoArchivo=0';
    return this.get(plantilla.replace('{periodo}', periodo));
  }

  /** Estado de un ticket de exportación (mismo caveat que el método anterior). */
  async consultarTicket(periodo: string, numTicket: string): Promise<any> {
    const plantilla =
      process.env.SIRE_TICKET_PATH ||
      '/libros/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets?perIni={periodo}&perFin={periodo}&numTicket={ticket}';
    return this.get(
      plantilla
        .replace(/\{periodo\}/g, periodo)
        .replace('{ticket}', encodeURIComponent(numTicket)),
    );
  }

  /** Descarga el archivo generado por un ticket, como texto (formato TXT SUNAT). */
  async descargarArchivo(nombreArchivo: string): Promise<string> {
    const plantilla =
      process.env.SIRE_DESCARGA_PATH ||
      '/libros/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte?nomArchivoReporte={archivo}&codTipoAchivoReporte=01';
    const data = await this.get<string>(
      plantilla.replace('{archivo}', encodeURIComponent(nombreArchivo)),
      'text',
    );
    return typeof data === 'string' ? data : String(data ?? '');
  }
}
