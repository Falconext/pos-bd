import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

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

    // Errores de contrato de la API de facturación (`ErrorDeContrato`): son
    // errores del integrador, no del servidor. Al ser un Error simple caían en
    // 500 "server_error" y el integrador creía que la API estaba caída (QA en
    // producción, 25-10). Se detecta por forma para no importar el módulo.
    const contrato =
      exception instanceof Error && !(exception instanceof HttpException) && typeof (exception as any).codigo === 'string'
        ? (exception as any)
        : null;
    if (contrato) {
      const status409 = ['invalid_state', 'already_voided', 'duplicate_external_id'].includes(contrato.codigo);
      const s = status409 ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
      const error: Record<string, any> = { type: 'invalid_request_error', code: contrato.codigo, message: contrato.message };
      if (contrato.parametro) error.param = contrato.parametro;
      if (esApiPublica(request?.originalUrl ?? request?.url)) {
        response.status(s).json({ error });
      } else {
        response.status(s).json({ code: 0, message: contrato.message, error: 'ErrorDeContrato' });
      }
      return;
    }

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
      // El parser de JSON de Express falla antes de llegar al controlador y su
      // mensaje ("Unexpected token 'n'…") no le dice al integrador qué hacer.
      if (status === 400 && (exception as any)?.type === 'entity.parse.failed' || /is not valid JSON|Unexpected token .* JSON/i.test(String(message))) {
        response.status(400).json({
          error: {
            type: 'invalid_request_error',
            code: 'invalid_json',
            message: 'El cuerpo no es un JSON válido. Revisa comillas, comas y llaves, y manda la cabecera Content-Type: application/json.',
            param: 'body',
          },
        });
        return;
      }
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
      // Errores por fila (p. ej. entradas y salidas de inventario): la
      // pantalla marca cada fila con lo suyo en vez de un solo aviso.
      ...(Array.isArray(rawObj?.problemas) ? { problemas: rawObj.problemas } : {}),
    });
  }
}
