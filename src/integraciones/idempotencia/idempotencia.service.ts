import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  decidir,
  debeGuardarse,
  huellaDelCuerpo,
  venceEn,
  type DecisionIdempotente,
} from './idempotencia';

/**
 * La parte de la idempotencia que habla con la base.
 *
 * La decisión vive en `idempotencia.ts`, sin Prisma, para poder probarla. Acá
 * está lo que no se puede probar sin base: reservar la clave de forma que dos
 * requests simultáneos no ejecuten los dos.
 *
 * La reserva se hace con un INSERT contra el índice único (empresaId, clave),
 * no con un "leer y después escribir": entre la lectura y la escritura caben
 * dos reintentos, y los dos emitirían. Quien gana el INSERT ejecuta; quien
 * choca lee lo que hay y decide.
 */
@Injectable()
export class IdempotenciaService {
  private readonly logger = new Logger(IdempotenciaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserva la clave para esta llamada, o dice qué hacer si ya existía.
   *
   * Devuelve `nueva` solo a quien debe ejecutar.
   */
  async reservar(input: {
    empresaId: number;
    clave: string;
    metodo: string;
    ruta: string;
    cuerpo: unknown;
  }): Promise<DecisionIdempotente> {
    const huella = huellaDelCuerpo(input.cuerpo);
    try {
      await this.prisma.idempotenciaApi.create({
        data: {
          empresaId: input.empresaId,
          clave: input.clave,
          metodo: input.metodo,
          ruta: input.ruta,
          huella,
          expiraEn: venceEn(),
        },
      });
      return { tipo: 'nueva' };
    } catch (e: any) {
      // P2002 = ya existe esa (empresaId, clave). No es un error: es el caso
      // que esta tabla existe para detectar.
      if (e?.code !== 'P2002') throw e;
    }

    const previo = await this.prisma.idempotenciaApi.findUnique({
      where: { empresaId_clave: { empresaId: input.empresaId, clave: input.clave } },
    });
    const decision = decidir(
      previo && {
        huella: previo.huella,
        estadoHttp: previo.estadoHttp,
        respuesta: previo.respuesta,
        expiraEn: previo.expiraEn,
      },
      huella,
    );

    // Venció: la fila vieja se reemplaza por la de esta llamada. Un `update`
    // y no un borrar-e-insertar, para no abrir una ventana en la que la clave
    // no existe y un tercer request simultáneo también la reserve.
    if (decision.tipo === 'nueva' && previo) {
      await this.prisma.idempotenciaApi.update({
        where: { id: previo.id },
        data: {
          huella,
          metodo: input.metodo,
          ruta: input.ruta,
          estadoHttp: null,
          // `DbNull` y no `null`: en una columna Json, Prisma exige decir que se
          // quiere NULL en la base, no omitir el campo.
          respuesta: Prisma.DbNull,
          creadoEn: new Date(),
          expiraEn: venceEn(),
        },
      });
    }
    return decision;
  }

  /** Guarda el resultado para que el próximo reintento lo reciba sin ejecutar. */
  async guardarRespuesta(input: {
    empresaId: number;
    clave: string;
    estadoHttp: number;
    respuesta: unknown;
  }): Promise<void> {
    if (!debeGuardarse(input.estadoHttp)) {
      // Un 5xx no se guarda, y además se libera la reserva: si quedara como
      // "en curso", el reintento recibiría 409 durante 24 horas por una falla
      // nuestra de hace un segundo.
      await this.liberar(input.empresaId, input.clave);
      return;
    }
    await this.prisma.idempotenciaApi
      .update({
        where: { empresaId_clave: { empresaId: input.empresaId, clave: input.clave } },
        data: { estadoHttp: input.estadoHttp, respuesta: input.respuesta as never },
      })
      .catch((e) =>
        this.logger.warn(
          `No se pudo guardar la respuesta idempotente ${input.clave}: ${e?.message}`,
        ),
      );
  }

  /** Suelta una reserva que no llegó a producir respuesta. */
  async liberar(empresaId: number, clave: string): Promise<void> {
    await this.prisma.idempotenciaApi
      .deleteMany({ where: { empresaId, clave, estadoHttp: null } })
      .catch(() => undefined);
  }

  /** El 409 que recibe quien reusa una clave con otro cuerpo. */
  static conflicto(): ConflictException {
    return new ConflictException({
      code: 'idempotency_key_reused',
      message:
        'Esta Idempotency-Key ya se usó con un cuerpo distinto. Usa una clave nueva para una operación nueva.',
    });
  }

  /** El 409 que recibe quien reintenta mientras la primera llamada sigue. */
  static enCurso(): ConflictException {
    return new ConflictException({
      code: 'idempotency_request_in_progress',
      message:
        'Una solicitud con esta Idempotency-Key sigue en proceso. Reintenta en unos segundos.',
    });
  }

  /** Borra las claves vencidas. Lo llama el scheduler. */
  async limpiarVencidas(): Promise<number> {
    const { count } = await this.prisma.idempotenciaApi.deleteMany({
      where: { expiraEn: { lt: new Date() } },
    });
    if (count > 0) this.logger.log(`Idempotencia: ${count} clave(s) vencida(s) borrada(s).`);
    return count;
  }
}
