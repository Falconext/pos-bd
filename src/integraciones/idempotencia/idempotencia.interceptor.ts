import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, switchMap, tap, catchError, throwError } from 'rxjs';
import { IdempotenciaService } from './idempotencia.service';
import { claveValida } from './idempotencia';

/**
 * Aplica la idempotencia a los endpoints que escriben.
 *
 * Va como interceptor y no dentro de cada servicio porque la regla es la
 * misma para emitir, anular y acreditar: si se repitiera en cada uno, el
 * primero que se olvide es el que emite dos facturas.
 *
 * Exige la clave en vez de hacerla opcional. Es más áspero de integrar, y es
 * a propósito: el integrador que no la manda no se entera de que le falta
 * hasta el día que un timeout le duplica una factura, y para entonces el
 * problema es del contador de su cliente.
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  constructor(private readonly idempotencia: IdempotenciaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    // La empresa sale de la API key, nunca del cuerpo: si viniera del cuerpo,
    // dos integradores podrían pisarse las claves entre sí.
    const empresaId: number | undefined = req.apiEmpresaId ?? req.logisticaEmpresaId;
    if (!empresaId) return next.handle();

    const clave = req.headers['idempotency-key'];
    if (!claveValida(clave)) {
      return throwError(
        () =>
          new BadRequestException({
            code: 'idempotency_key_required',
            message:
              'Falta la cabecera Idempotency-Key. Envía una clave única por operación (UUID o el id del documento en tu sistema).',
            param: 'Idempotency-Key',
          }),
      );
    }

    const datos = {
      empresaId,
      clave,
      metodo: String(req.method ?? 'POST'),
      ruta: String(req.route?.path ?? req.url ?? ''),
      cuerpo: req.body ?? {},
    };

    return from(this.idempotencia.reservar(datos)).pipe(
      switchMap((decision) => {
        if (decision.tipo === 'conflicto') {
          return throwError(() => IdempotenciaService.conflicto());
        }
        if (decision.tipo === 'en_curso') {
          return throwError(() => IdempotenciaService.enCurso());
        }
        if (decision.tipo === 'repetida') {
          // Se responde lo guardado sin tocar el motor de emisión. La cabecera
          // le dice al integrador que esto no volvió a ejecutarse, que es la
          // diferencia entre "ya estaba" y "lo hice otra vez".
          res?.setHeader?.('Idempotent-Replay', 'true');
          res?.status?.(decision.estadoHttp);
          return of(decision.respuesta);
        }

        return next.handle().pipe(
          tap((respuesta) => {
            void this.idempotencia.guardarRespuesta({
              empresaId,
              clave,
              estadoHttp: Number(res?.statusCode ?? 200),
              respuesta,
            });
          }),
          catchError((err) => {
            const estado = Number(err?.status ?? err?.getStatus?.() ?? 500);
            // Un 4xx se guarda: va a repetirse igual, y devolverlo de memoria
            // le ahorra al integrador otra llamada. Un 5xx libera la reserva
            // para que el reintento vuelva a intentarlo de verdad.
            void this.idempotencia.guardarRespuesta({
              empresaId,
              clave,
              estadoHttp: estado,
              respuesta: err?.response ?? { message: err?.message },
            });
            return throwError(() => err);
          }),
        );
      }),
    );
  }
}
