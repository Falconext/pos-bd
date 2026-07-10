import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

/**
 * Guard de autenticación por API key para la API pública de Logística.
 *
 * Acepta la clave como `Authorization: Bearer <API_KEY>` (esquema `bearerAuth`
 * del contrato) o, alternativamente, como header `x-api-key`. Si es válida,
 * adjunta el contexto de la empresa autenticada a la request:
 *   - `req.logisticaApiKey = { id, empresaId, entorno }`
 *   - `req.logisticaEmpresaId = empresaId`
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const apiKey = this.extractKey(req);
    if (!apiKey) {
      throw new UnauthorizedException(
        'Falta la API key. Envía `Authorization: Bearer <API_KEY>`.',
      );
    }
    const registro = await this.apiKeys.validateKey(apiKey);
    if (!registro) {
      throw new UnauthorizedException('API key inválida o revocada.');
    }
    req.logisticaApiKey = {
      id: registro.id,
      empresaId: registro.empresaId,
      entorno: registro.entorno,
    };
    req.logisticaEmpresaId = registro.empresaId;
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
