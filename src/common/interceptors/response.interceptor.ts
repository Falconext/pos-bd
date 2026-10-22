import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Las APIs públicas (`/api/v1/…`: Logística, Facturación, la API del negocio)
 * NO usan el envelope del ERP: devuelven el recurso limpio y sus errores con
 * el formato del contrato OpenAPI. Antes solo se exceptuaba `/v1/logistics`, y
 * Facturación respondía envuelta en `{ code, message, data }`, distinto de lo
 * que documenta el portal.
 */
function esApiPublica(url: string | undefined): boolean {
  return typeof url === 'string' && /(^|\/)v1\//.test(url.split('?')[0]);
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    // API pública: respuesta cruda (sin { code, message, data }).
    if (esApiPublica(request?.originalUrl ?? request?.url)) {
      return next.handle();
    }

    const message = response.locals?.message ?? 'OK';
    return next.handle().pipe(
      map((data) => ({
        code: 1,
        message,
        data,
      })),
    );
  }
}
