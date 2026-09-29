/**
 * El asistente de soporte: responde en el chat mientras no haya una persona.
 *
 * No reemplaza al equipo — contesta lo repetido al instante y calla en cuanto
 * aparece alguien o la consulta se le escapa. Todas las reglas de silencio
 * están en `soporte-bot.ts` y se prueban sin base ni red.
 *
 * Apagado por defecto: se prende con SOPORTE_IA=true.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../gemini/gemini.service';
import { debeResponder, type EstadoConversacion } from './soporte-bot';
import { construirPromptSoporte, pidioEscalar } from './soporte-prompt';
import { CONOCIMIENTO_GENERADO } from './conocimiento.generado';
import { CONOCIMIENTO_BASE } from './soporte-prompt';
import { conocimientoPara } from './soporte-conocimiento';

/**
 * Con qué nombre firma el asistente.
 *
 * Es lo que ve el empresario y además lo que usa el servicio para distinguir
 * sus propios mensajes de los de una persona. Cambiarlo sin migrar los
 * mensajes viejos haría que el bot los lea como humanos y se calle de más
 * (que es el lado seguro del error, pero conviene saberlo).
 */
export const NOMBRE_DEL_BOT = 'Asistente';

/** Cuántos mensajes previos se le pasan al modelo. */
const MENSAJES_DE_CONTEXTO = 10;

/**
 * Lo que se le dice al empresario cuando la consulta pasa a una persona.
 *
 * Existe porque la primera versión escalaba EN SILENCIO, y en la primera
 * prueba real eso se vio enseguida: el empresario preguntó algo que el
 * asistente no sabía, no recibió nada, y siguió con "hello?" y "estás ahí?".
 * Silencio e "instalación rota" se ven igual desde el otro lado.
 */
export const AVISO_ESCALADO =
  'Eso prefiero que lo vea alguien del equipo. Ya les avisé y te responden por acá.';

/** Marca del aviso, para no repetirlo en cada mensaje que siga. */
const esAvisoDeEscalado = (texto: string) => texto === AVISO_ESCALADO;

@Injectable()
export class SoporteBotService {
  private readonly logger = new Logger(SoporteBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
    private readonly config: ConfigService,
  ) {}

  /** El asistente está prendido y hay motor de IA disponible. */
  disponible(): boolean {
    const prendido =
      String(this.config.get('SOPORTE_IA') ?? '').toLowerCase() === 'true';
    return prendido && this.gemini.isEnabled();
  }

  /**
   * La respuesta del asistente, o null si le toca callarse.
   *
   * Devolver null NO es un error: es la mitad del diseño. El mensaje queda
   * para una persona y el empresario no ve nada raro.
   */
  async responder(params: {
    conversacionId: number;
    mensaje: string;
    marca: string;
    horario: string;
  }): Promise<string | null> {
    if (!this.disponible()) return null;

    const estado = await this.estadoDeLaConversacion(params.conversacionId);
    const decision = debeResponder(params.mensaje, estado);
    if (!decision.responde) {
      this.logger.debug(
        `[soporte-bot] no responde conversación ${params.conversacionId}: ${decision.motivo}`,
      );
      // Si hay una persona en la conversación, silencio absoluto: cualquier
      // aviso automático se metería en el medio de lo que está hablando.
      const hayHumano =
        decision.motivo === 'conversacion-tomada' ||
        decision.motivo === 'humano-respondiendo';
      if (hayHumano) return null;
      return this.avisoDeEscalado(params.conversacionId);
    }

    const historial = await this.historial(params.conversacionId);
    try {
      // El conocimiento sale del código (ver scripts/extraer-conocimiento.ts) y
      // se acota a lo que tiene que ver con la pregunta: mandar los 29 KB
      // enteros le diluye la atención al modelo y cuesta de más.
      const respuesta = await this.gemini.chatConHistorial(
        construirPromptSoporte({
          marca: params.marca,
          horario: params.horario,
          conocimiento: conocimientoPara(
            CONOCIMIENTO_GENERADO,
            params.mensaje,
            undefined,
            CONOCIMIENTO_BASE,
          ),
        }),
        historial,
        400,
      );
      // El modelo pidió escalar, o no devolvió nada: en los dos casos le toca a
      // una persona, y el empresario tiene que enterarse.
      if (!respuesta?.trim() || pidioEscalar(respuesta)) {
        return this.avisoDeEscalado(params.conversacionId);
      }
      return respuesta.trim();
    } catch (error: any) {
      // Que falle Gemini no puede costarle el mensaje al empresario: ya está
      // guardado y queda para una persona, igual que si el bot hubiera callado.
      this.logger.warn(
        `[soporte-bot] Gemini falló en la conversación ${params.conversacionId}: ${error?.message}`,
      );
      return this.avisoDeEscalado(params.conversacionId);
    }
  }

  /**
   * El aviso de que la consulta pasó a una persona, salvo que ya se haya dado.
   *
   * Repetirlo en cada mensaje sería tan molesto como el silencio: el empresario
   * ya sabe que está esperando, no necesita que se lo digan tres veces.
   */
  private async avisoDeEscalado(conversacionId: number): Promise<string | null> {
    const ultimo = await this.prisma.soporteMensaje.findFirst({
      where: { conversacionId, rol: 'SISTEMA' },
      orderBy: { creadoEn: 'desc' },
      select: { contenido: true, autorNombre: true },
    });
    if (ultimo?.autorNombre === NOMBRE_DEL_BOT && esAvisoDeEscalado(ultimo.contenido)) {
      return null;
    }
    return AVISO_ESCALADO;
  }

  /** Quién viene atendiendo la conversación, para decidir si el bot habla. */
  private async estadoDeLaConversacion(
    conversacionId: number,
  ): Promise<EstadoConversacion> {
    const conversacion = await this.prisma.soporteConversacion.findUnique({
      where: { id: conversacionId },
      select: { asignadoAId: true },
    });

    const ultimos = await this.prisma.soporteMensaje.findMany({
      where: { conversacionId },
      orderBy: { creadoEn: 'desc' },
      take: 20,
      select: { rol: true, autorNombre: true, creadoEn: true },
    });

    // Los mensajes del bot van con rol SISTEMA igual que los de una persona:
    // se distinguen por el autor, que es el único lugar donde queda la marca.
    const esDelBot = (m: { autorNombre: string | null }) =>
      m.autorNombre === NOMBRE_DEL_BOT;

    const ultimoHumano = ultimos.find(
      (m) => m.rol === 'SISTEMA' && !esDelBot(m),
    );

    let seguidas = 0;
    for (const m of ultimos) {
      if (m.rol === 'SISTEMA') {
        if (!esDelBot(m)) break;
        seguidas++;
      }
    }

    return {
      asignadoAId: conversacion?.asignadoAId ?? null,
      ultimoMensajeHumano: ultimoHumano?.creadoEn ?? null,
      respuestasSeguidasDelBot: seguidas,
    };
  }

  /** Los últimos mensajes, en el formato que espera el motor. */
  private async historial(
    conversacionId: number,
  ): Promise<{ role: 'user' | 'model'; content: string }[]> {
    const mensajes = await this.prisma.soporteMensaje.findMany({
      where: { conversacionId },
      orderBy: { creadoEn: 'desc' },
      take: MENSAJES_DE_CONTEXTO,
      select: { rol: true, contenido: true },
    });
    return mensajes
      .reverse()
      .map((m) => ({
        role: m.rol === 'EMPRESA' ? ('user' as const) : ('model' as const),
        content: m.contenido,
      }));
  }
}
