import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/** Rutas de la API pública de Logística: usan el formato de error del contrato. */
function esApiPublica(url: string | undefined): boolean {
  return typeof url === 'string' && url.includes('/v1/logistics');
}

/** status HTTP → `type` del error (contrato). */
function tipoPorStatus(status: number): string {
  if (status === 401 || status === 403) return 'authentication_error';
  if (status === 429) return 'rate_limit_error';
  if (status >= 500) return 'api_error';
  return 'invalid_request_error';
}

/** `code` por defecto si el throw no trae uno. */
function codigoPorStatus(status: number): string {
  switch (status) {
    case 400: return 'bad_request';
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 422: return 'unprocessable_entity';
    case 429: return 'too_many_requests';
    default: return status >= 500 ? 'server_error' : 'error';
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;
    const rawObj = raw && typeof raw === 'object' ? (raw as any) : {};
    let message =
      rawObj.message ??
      (typeof raw === 'string' ? raw : (exception as any)?.message) ??
      'Error';
    if (Array.isArray(message)) message = message.join(', ');

    // API pública: { error: { type, code, message, param } } (contrato OpenAPI).
    if (esApiPublica(request?.originalUrl ?? request?.url)) {
      const error: Record<string, any> = {
        type: rawObj.type ?? tipoPorStatus(status),
        code: rawObj.code ?? codigoPorStatus(status),
        message,
      };
      if (rawObj.param) error.param = rawObj.param;
      response.status(status).json({ error });
      return;
    }

    // ERP (interno): envelope de siempre.
    response.status(status).json({
      code: 0,
      message,
      error: (exception as any)?.name ?? 'Error',
    });
  }
}
