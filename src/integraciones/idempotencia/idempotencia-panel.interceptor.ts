import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, switchMap, tap, catchError, throwError } from 'rxjs';
import { IdempotenciaService } from './idempotencia.service';
import { claveValida } from './idempotencia';

/**
 * Lo que identifica una venta, sin lo que cambia entre un intento y su
 * reintento: `fechaEmision` lleva los segundos del momento en que se armó, y
 * un reintento de la misma venta un segundo después no es otra venta.
 */
export function cuerpoParaHuella(cuerpo: any): Record<string, unknown> {
  const { fechaEmision: _f, claveIdempotencia: _c, ...resto } = cuerpo ?? {};
  return resto;
}

/**
 * La idempotencia de la API pública, para las ventas del panel (POS).
 *
 * DEMENVER (31-10): la misma venta llegaba dos y tres veces al servidor con
 * milisegundos de diferencia (B0A1-1951/52/53, NV01-8514/15) y cada una se
 * registraba. El heurístico de doble envío lee y después escribe: dos
 * llamadas simultáneas pasan las dos. Acá la clave se reserva con un INSERT
 * contra un índice único, así que solo una ejecuta.
 *
 * A diferencia de la API, la clave es opcional: la app móvil y el escritorio
 * todavía no la mandan y no deben dejar de vender.
 */
@Injectable()
export class IdempotenciaPanelInterceptor implements NestInterceptor {
  constructor(private readonly idempotencia: IdempotenciaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const empresaId: number | undefined = req.user?.empresaId;
    const clave = req.headers?.['idempotency-key'];
    if (!empresaId || !claveValida(clave)) return next.handle();
    const cuerpo = cuerpoParaHuella(req.body);
    // Para que el servicio sepa que esta venta ya está protegida y no aplique
    // el heurístico de doble envío, que frena dos ventas reales iguales.
    if (req.body && typeof req.body === 'object') req.body.claveIdempotencia = clave;

    return from(
      this.idempotencia.reservar({
        empresaId,
        clave,
        metodo: String(req.method ?? 'POST'),
        ruta: String(req.route?.path ?? req.url ?? ''),
        cuerpo,
      }),
    ).pipe(
      switchMap((decision) => {
        if (decision.tipo === 'conflicto') {
          return throwError(() => IdempotenciaService.conflicto());
        }
        if (decision.tipo === 'en_curso') {
          return throwError(() => IdempotenciaService.enCurso());
        }
        if (decision.tipo === 'repetida') {
          res?.setHeader?.('Idempotent-Replay', 'true');
          // Un error guardado vuelve como error: devuelto como cuerpo normal,
          // el panel lo leería como venta hecha sin que exista.
          if (decision.estadoHttp >= 400) {
            return throwError(() => new HttpException(decision.respuesta as any, decision.estadoHttp));
          }
          return of(decision.respuesta);
        }
        return next.handle().pipe(
          tap((respuesta) => {
            void this.idempotencia.guardarRespuesta({
              empresaId,
              clave,
              estadoHttp: Number(res?.statusCode ?? 200),
              // El comprobante trae Decimal y Date: a JSON plano, que es lo que
              // acepta la columna y lo que recibiría el panel de todos modos.
              respuesta: JSON.parse(JSON.stringify(respuesta ?? null)),
            });
          }),
          catchError((err) => {
            const estado = Number(err?.status ?? err?.getStatus?.() ?? 500);
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
