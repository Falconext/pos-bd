import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Las rutas de la API pública de Logística NO usan el envelope del ERP:
 *  devuelven el recurso limpio (Order, OrderList, …) tal como el contrato OpenAPI. */
function esApiPublica(url: string | undefined): boolean {
  return typeof url === 'string' && url.includes('/v1/logistics');
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
