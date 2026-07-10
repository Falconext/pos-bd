import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { RateLimitsService } from '../rate-limits/rate-limits.service';

/**
 * Guard de autenticación por API key para la API pública de Logística.
 *
 * Acepta la clave como `Authorization: Bearer <API_KEY>` (esquema `bearerAuth`
 * del contrato) o, alternativamente, como header `x-api-key`. Si es válida,
 * adjunta el contexto de la empresa a la request y aplica rate limiting con
 * cabeceras `RateLimit-*` (contrato). Los errores usan `code` estable.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly rateLimits: RateLimitsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const apiKey = this.extractKey(req);
    if (!apiKey) {
      throw new UnauthorizedException({
        code: 'missing_api_key',
        message: 'Falta la API key. Envía `Authorization: Bearer <API_KEY>`.',
      });
    }
    const registro = await this.apiKeys.validateKey(apiKey);
    if (!registro) {
      throw new UnauthorizedException({
        code: 'invalid_api_key',
        message: 'API key inválida o revocada.',
      });
    }
    req.logisticaApiKey = {
      id: registro.id,
      empresaId: registro.empresaId,
      entorno: registro.entorno,
    };
    req.logisticaEmpresaId = registro.empresaId;

    // Rate limiting por API key + cabeceras de cuota (contrato).
    const rl = this.rateLimits.consume(String(registro.id), req.method ?? 'GET');
    if (res?.setHeader) {
      res.setHeader('RateLimit-Limit', String(rl.limit));
      res.setHeader('RateLimit-Remaining', String(rl.remaining));
      res.setHeader('RateLimit-Reset', String(rl.reset));
    }
    if (!rl.allowed) {
      if (res?.setHeader) res.setHeader('Retry-After', String(rl.reset));
      throw new HttpException(
        {
          code: 'too_many_requests',
          message: `Superaste el límite de solicitudes. Reintenta en ${rl.reset} segundos.`,
        },
        429,
      );
    }
    return true;
  }

  private extractKey(req: any): string | null {
    const auth = req?.headers?.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (token) return token;
    }
    const headerKey = req?.headers?.['x-api-key'];
    if (typeof headerKey === 'string' && headerKey.trim()) {
      return headerKey.trim();
    }
    return null;
  }
}
