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

/**
 * Traduce errores conocidos de Prisma a mensajes amables + status HTTP.
 * Evita que el usuario vea cosas como
 * "Invalid `prisma.producto.create()` invocation: Unique constraint failed...".
 */
function mapearErrorPrisma(
  exception: unknown,
): { status: number; message: string } | null {
  const err = exception as any;
  if (
    !err ||
    typeof err !== 'object' ||
    err.name !== 'PrismaClientKnownRequestError'
  ) {
    return null;
  }
  const target = err?.meta?.target;
  const campos: string[] = Array.isArray(target)
    ? target.map((t: unknown) => String(t))
    : typeof target === 'string'
      ? [target]
      : [];
  switch (err.code) {
    case 'P2002': {
      const set = new Set(campos.map((c) => c.toLowerCase()));
      if (set.has('codigo')) {
        return {
          status: HttpStatus.CONFLICT,
          message: 'Ya existe un producto con ese código.',
        };
      }
      if (set.has('codigobarras')) {
        return {
          status: HttpStatus.CONFLICT,
          message: 'Ya existe un producto con ese código de barras.',
        };
      }
      const detalle = campos.length ? ` (${campos.join(', ')})` : '';
      return {
        status: HttpStatus.CONFLICT,
        message: `Ya existe un registro con esos datos${detalle}.`,
      };
    }
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        message: 'El registro solicitado no existe o ya fue eliminado.',
      };
    case 'P2003':
      return {
        status: HttpStatus.CONFLICT,
        message:
          'No se puede completar la operación porque el registro está relacionado con otros datos.',
      };
    default:
      return null;
  }
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
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable_entity';
    case 429:
      return 'too_many_requests';
    default:
      return status >= 500 ? 'server_error' : 'error';
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const errorPrisma = mapearErrorPrisma(exception);

    const status = errorPrisma
      ? errorPrisma.status
      : exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;
    const rawObj = raw && typeof raw === 'object' ? (raw as any) : {};
    let message = errorPrisma
      ? errorPrisma.message
      : (rawObj.message ??
        (typeof raw === 'string' ? raw : (exception as any)?.message) ??
        'Error');
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
