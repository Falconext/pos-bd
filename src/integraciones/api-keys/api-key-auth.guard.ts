import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from './api-keys.service';
import { RateLimitsService } from '../rate-limits/rate-limits.service';
import { CLAVE_PRODUCTO_API, esProductoApi, type ProductoApi } from './producto-api';

/**
 * Autenticación por API key para las APIs públicas, de cualquier producto.
 *
 * Acepta la clave como `Authorization: Bearer <API_KEY>` (esquema `bearerAuth`
 * del contrato) o como `x-api-key`. Si es válida, adjunta el contexto de la
 * empresa a la request y aplica rate limiting con cabeceras `RateLimit-*`.
 *
 * El producto sale del decorador `@ApiProducto(...)` del controlador, no de un
 * guard por producto: así el guard es uno solo y el día que se abra el tercero
 * se decora y ya. Sin decorador NO autentica: prefiere romperse a dejar pasar
 * una key de otra API, que es el error que no se nota hasta que alguien emite
 * una factura con una key de logística.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly rateLimits: RateLimitsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const producto = this.productoDe(context);
    if (!producto) {
      throw new HttpException(
        {
          code: 'api_product_not_configured',
          message: 'Este endpoint no declara a qué API pertenece.',
        },
        500,
      );
    }

    const apiKey = this.extractKey(req);
    if (!apiKey) {
      throw new UnauthorizedException({
        code: 'missing_api_key',
        message: 'Falta la API key. Envía `Authorization: Bearer <API_KEY>`.',
      });
    }

    const resultado = await this.apiKeys.validarParaProducto(apiKey, producto);
    if (!resultado.ok) {
      // Una key de otro producto es 403, no 401: existe y es suya, pero no
      // sirve acá. Decirle "inválida" lo mandaría a rotar una key que está
      // bien y el problema seguiría.
      if (resultado.motivo === 'producto') {
        throw new ForbiddenException({
          code: 'product_forbidden',
          message: `Esta API key no pertenece a la API de ${producto}. Genera una para este producto.`,
        });
      }
      throw new UnauthorizedException({
        code: 'invalid_api_key',
        message: 'API key inválida o revocada.',
      });
    }

    const { registro } = resultado;
    req.apiKey = {
      id: registro.id,
      empresaId: registro.empresaId,
      entorno: registro.entorno,
      producto: registro.producto,
    };
    req.apiEmpresaId = registro.empresaId;
    req.apiProducto = registro.producto;
    // Compatibilidad con lo que ya lee el módulo de logística.
    req.logisticaApiKey = req.apiKey;
    req.logisticaEmpresaId = registro.empresaId;

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

  /** El producto declarado en el método o, si no, en el controlador. */
  private productoDe(context: ExecutionContext): ProductoApi | null {
    const valor = this.reflector.getAllAndOverride(CLAVE_PRODUCTO_API, [
      context.getHandler(),
      context.getClass(),
    ]);
    return esProductoApi(valor) ? valor : null;
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
