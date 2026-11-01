import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { descifrarSecreto } from '../common/utils/secreto.util';
import { fechaKeyLima } from '../common/utils/egresos-caja.util';
import { numeroTakiy } from './takiy';
import { EvolutionClient, EvolutionError } from './evolution';
import {
  EvolutionEnv,
  evolutionDisponible,
  leerEvolutionEnv,
} from './evolution-config';

export type MotivoFalloEvolution =
  | 'NO_DISPONIBLE'
  | 'NO_CONECTADO'
  | 'NUMERO_INVALIDO'
  | 'COLA_LLENA'
  | 'TOPE_DIARIO'
  | 'ENVIO';

export type ResultadoEvolution =
  | { success: true }
  | {
      success: false;
      error: string;
      motivo: MotivoFalloEvolution;
      /** Timeout/5xx: el mensaje pudo salir; no conviene repetirlo por otra vía. */
      ambiguo?: boolean;
    };

export interface MensajeNegocio {
  numero: string;
  mensaje: string;
  /** URL pública de un PDF o imagen que va como adjunto (el mensaje es el pie). */
  archivoUrl?: string;
  nombreArchivo?: string;
}

/**
 * Envío por Evolution API desde el número del negocio, con protección contra
 * bloqueos de WhatsApp:
 *
 * - Cola por instancia: los mensajes de un mismo número salen de a uno, con
 *   una pausa aleatoria entre ellos (EVOLUTION_PAUSA_MIN_MS–MAX_MS, 3–7 s).
 *   Un mensaje suelto sale al toque: la pausa se cuenta desde el anterior.
 * - Cola acotada (EVOLUTION_COLA_MAX, 20): si se llena, el mensaje no espera
 *   y pasa al siguiente proveedor. Nunca hay envíos masivos por acá.
 * - Tope diario por número (EVOLUTION_TOPE_DIARIO, 300) persistido en la base
 *   con un UPDATE condicional (atómico): sobrevive reinicios y réplicas.
 *
 * Limitación: la cola y la pausa viven en memoria de este proceso. Un reinicio
 * corta los mensajes que esperaban turno (sus llamadores también mueren) y con
 * varias réplicas cada una lleva su propia pausa. No se usa BullMQ porque los
 * llamadores necesitan el resultado para caer a Takiy/Meta en el momento.
 */
@Injectable()
export class EvolutionEnvioService {
  private readonly logger = new Logger(EvolutionEnvioService.name);
  private readonly colas = new Map<string, Promise<unknown>>();
  private readonly pendientes = new Map<string, number>();
  private readonly ultimoEnvio = new Map<string, number>();

  // Inyectables para pruebas.
  dormir: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms));
  azar: () => number = Math.random;
  ahora: () => number = Date.now;
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  leerEnv: () => EvolutionEnv | null = () => leerEvolutionEnv();

  constructor(private readonly prisma: PrismaService) {}

  cliente(cfg: EvolutionEnv): EvolutionClient {
    return new EvolutionClient(
      { url: cfg.url, apiKey: cfg.apiKey },
      this.fetchImpl,
    );
  }

  /** ¿Evolution está habilitado para la empresa (env + piloto)? */
  disponible(empresaId: number): EvolutionEnv | null {
    const cfg = this.leerEnv();
    return evolutionDisponible(empresaId, cfg) ? cfg : null;
  }

  /** Habilitado y con la sesión abierta. */
  async conectado(empresaId: number): Promise<boolean> {
    if (!this.disponible(empresaId)) return false;
    const c = await this.prisma.whatsappConexion.findUnique({
      where: { empresaId },
      select: { estado: true },
    });
    return c?.estado === 'CONECTADO';
  }

  async enviar(
    empresaId: number,
    m: MensajeNegocio,
  ): Promise<ResultadoEvolution> {
    const cfg = this.disponible(empresaId);
    if (!cfg)
      return falla(
        'NO_DISPONIBLE',
        'WhatsApp por QR no está habilitado para esta empresa.',
      );

    const conexion = await this.prisma.whatsappConexion.findUnique({
      where: { empresaId },
      select: { instancia: true, tokenCifrado: true, estado: true },
    });
    if (!conexion || conexion.estado !== 'CONECTADO') {
      return falla(
        'NO_CONECTADO',
        'El WhatsApp del negocio no está conectado.',
      );
    }

    const numero = numeroTakiy(m.numero);
    if (numero.length < 10 || numero.length > 15) {
      return falla('NUMERO_INVALIDO', `Número inválido: ${m.numero}`);
    }
    if (!m.mensaje?.trim() && !m.archivoUrl)
      return falla('ENVIO', 'El mensaje está vacío.');

    const instancia = conexion.instancia;
    // Revisar y ocupar el lugar en la cola en el mismo tick: sin await de por medio.
    if ((this.pendientes.get(instancia) ?? 0) >= cfg.colaMax) {
      return falla(
        'COLA_LLENA',
        'Hay demasiados mensajes en espera para este número.',
      );
    }
    this.sumarPendiente(instancia, 1);
    if (
      !(await this.reservarCupo(empresaId, cfg.topeDiario).catch(() => false))
    ) {
      this.sumarPendiente(instancia, -1);
      return falla(
        'TOPE_DIARIO',
        `Se alcanzó el tope diario de ${cfg.topeDiario} mensajes por QR.`,
      );
    }

    // La llave global también sirve; el token de instancia limita el alcance.
    const apiKey = descifrarSecreto(conexion.tokenCifrado) ?? cfg.apiKey;
    const r = await this.enCola(instancia, cfg, () =>
      this.mandar(cfg, instancia, apiKey, numero, m),
    );
    if (!r.success && !r.ambiguo) await this.liberarCupo(empresaId);
    return r;
  }

  /** Mensajes del día (Lima) para mostrar en el panel. */
  enviadosHoy(
    c: { enviadosHoy: number; enviadosDia: string | null } | null,
  ): number {
    if (!c || c.enviadosDia !== this.hoy()) return 0;
    return c.enviadosHoy;
  }

  hoy(): string {
    return fechaKeyLima(new Date(this.ahora()));
  }

  private async mandar(
    cfg: EvolutionEnv,
    instancia: string,
    apiKey: string,
    numero: string,
    m: MensajeNegocio,
  ): Promise<ResultadoEvolution> {
    const cli = this.cliente(cfg);
    try {
      if (m.archivoUrl) {
        await cli.enviarMedia(instancia, apiKey, numero, {
          url: m.archivoUrl,
          nombreArchivo: m.nombreArchivo,
          caption: m.mensaje?.trim() || undefined,
        });
      } else {
        await cli.enviarTexto(instancia, apiKey, numero, m.mensaje.trim());
      }
      return { success: true };
    } catch (e) {
      const err =
        e instanceof EvolutionError
          ? e
          : new EvolutionError(
              'RED',
              'No se pudo contactar al servidor de WhatsApp.',
            );
      // Solo el código y el texto mapeado: nunca la llave ni el cuerpo de la respuesta.
      this.logger.warn(
        `Evolution ${instancia} → ${numero}: ${err.codigo} ${err.message}`,
      );
      return {
        success: false,
        error: err.message,
        motivo: 'ENVIO',
        ambiguo: err.ambiguo,
      };
    }
  }

  /** Encadena el envío detrás del anterior del mismo número, con pausa aleatoria. */
  private enCola<T>(
    instancia: string,
    cfg: EvolutionEnv,
    tarea: () => Promise<T>,
  ): Promise<T> {
    const previa = this.colas.get(instancia) ?? Promise.resolve();
    const turno = previa
      .catch(() => undefined)
      .then(async () => {
        const ultimo = this.ultimoEnvio.get(instancia);
        if (ultimo !== undefined) {
          const pausa =
            cfg.pausaMinMs +
            Math.floor(this.azar() * (cfg.pausaMaxMs - cfg.pausaMinMs + 1));
          const falta = ultimo + pausa - this.ahora();
          if (falta > 0) await this.dormir(falta);
        }
        try {
          return await tarea();
        } finally {
          this.ultimoEnvio.set(instancia, this.ahora());
        }
      })
      .finally(() => {
        this.sumarPendiente(instancia, -1);
        if (this.colas.get(instancia) === turno) this.colas.delete(instancia);
      });
    this.colas.set(instancia, turno);
    return turno;
  }

  /**
   * Reserva un mensaje del tope diario. Dos UPDATE condicionales (atómicos en
   * Postgres): reinicia el contador si cambió el día y suma solo si hay cupo.
   */
  private async reservarCupo(
    empresaId: number,
    tope: number,
  ): Promise<boolean> {
    const hoy = this.hoy();
    await this.prisma.whatsappConexion.updateMany({
      where: {
        empresaId,
        OR: [{ enviadosDia: null }, { enviadosDia: { not: hoy } }],
      },
      data: { enviadosHoy: 0, enviadosDia: hoy },
    });
    const r = await this.prisma.whatsappConexion.updateMany({
      where: { empresaId, enviadosDia: hoy, enviadosHoy: { lt: tope } },
      data: { enviadosHoy: { increment: 1 } },
    });
    return r.count > 0;
  }

  private async liberarCupo(empresaId: number): Promise<void> {
    await this.prisma.whatsappConexion
      .updateMany({
        where: { empresaId, enviadosDia: this.hoy(), enviadosHoy: { gt: 0 } },
        data: { enviadosHoy: { decrement: 1 } },
      })
      .catch(() => undefined);
  }

  private sumarPendiente(instancia: string, d: number): void {
    const n = (this.pendientes.get(instancia) ?? 0) + d;
    if (n <= 0) this.pendientes.delete(instancia);
    else this.pendientes.set(instancia, n);
  }

  /** Olvida la cola de una instancia borrada. */
  olvidar(instancia: string): void {
    this.ultimoEnvio.delete(instancia);
  }
}

function falla(
  motivo: MotivoFalloEvolution,
  error: string,
): ResultadoEvolution {
  return { success: false, motivo, error };
}
