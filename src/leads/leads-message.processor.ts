import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { RagVentasService } from './leads-rag.service';
import { LeadsAlertaService } from './leads-alerta.service';
import { LEADS_MESSAGES_QUEUE } from './leads.constants';
import {
  IaVentasService,
  MensajeConversacion,
  RespuestaVenta,
  CalificacionBant,
  estadoProspectoDesde,
} from './leads-ia.service';

interface MensajeEntrante {
  phoneNumberId: string;
  from: string;
  messageId: string;
  text: string;
  esAudio: boolean;
  mediaId?: string;
  nombre?: string;
  timestamp?: string;
}

/**
 * Procesa mensajes entrantes de WhatsApp de prospectos.
 * FASE 1b: resuelve la empresa por phone_number_id, upsert de conversación y
 * persiste el mensaje entrante.
 * FASE 1c: si la empresa tiene la IA de ventas activa y el bot no está pausado,
 * genera la respuesta (BANT/SPIN, Gemini), la envía desde el número de la
 * empresa, califica el lead y alerta al vendedor cuando es CALIENTE.
 *
 * Idempotente: tolera entregas duplicadas de Meta y reintentos de BullMQ sin
 * duplicar respuestas (guarda por whatsappMsgId + chequeo de mensaje ya respondido).
 */
@Processor(LEADS_MESSAGES_QUEUE, { concurrency: 5 })
export class LeadsMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadsMessageProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ia: IaVentasService,
    private readonly rag: RagVentasService,
    private readonly whatsapp: WhatsAppService,
    private readonly notificaciones: NotificacionesService,
    private readonly alerta: LeadsAlertaService,
  ) {
    super();
  }

  async process(job: Job<MensajeEntrante>): Promise<void> {
    const d = job.data;

    // 1) ¿Qué empresa tiene conectado este número?
    const empresa = await this.prisma.empresa.findFirst({
      where: { whatsappPhoneNumberId: d.phoneNumberId },
      select: {
        id: true,
        razonSocial: true,
        nombreComercial: true,
        descripcionTienda: true,
        iaVentasActiva: true,
        iaVentasContexto: true,
        rubro: { select: { nombre: true } },
        plan: { select: { maxLeadsMes: true } },
      },
    });
    if (!empresa) {
      this.logger.warn(
        `Mensaje entrante de ${d.from} para phoneNumberId ${d.phoneNumberId} sin empresa asociada; se ignora.`,
      );
      return;
    }

    // 2) Upsert de la conversación (una por prospecto/empresa).
    const conv = await this.prisma.leadConversacion.upsert({
      where: {
        empresaId_telefonoProspecto: {
          empresaId: empresa.id,
          telefonoProspecto: d.from,
        },
      },
      create: {
        empresaId: empresa.id,
        telefonoProspecto: d.from,
        nombreProspecto: d.nombre ?? null,
        numeroWhatsappId: d.phoneNumberId,
        cantidadMensajes: 0,
      },
      update: d.nombre ? { nombreProspecto: d.nombre } : {},
      select: { id: true, creadoEn: true },
    });

    // 3) Si es nota de voz, transcribir con Gemini (para responder y para el CRM).
    let contenido = d.text;
    let audioTranscrito = false;
    if (d.esAudio) {
      contenido = '[nota de voz]';
      if (d.mediaId && this.ia.disponible()) {
        try {
          const { buffer, mimeType } = await this.whatsapp.descargarMedia(
            d.mediaId,
            empresa.id,
          );
          const texto = await this.ia.transcribirAudio(buffer, mimeType);
          if (texto?.trim()) {
            contenido = texto.trim();
            audioTranscrito = true;
            this.logger.log(
              `Lead: nota de voz de ${d.from} transcrita (${contenido.length} chars).`,
            );
          }
        } catch (e: any) {
          this.logger.warn(
            `Lead: no se pudo transcribir audio de ${d.from}: ${e?.message}`,
          );
        }
      }
    }
    const userMsgId = await this.persistirMensajeUsuario(
      conv.id,
      d.messageId,
      contenido,
      d.esAudio,
    );
    if (userMsgId === null) {
      // Ya existía y ya fue respondido → nada que hacer.
      return;
    }

    this.logger.log(
      `Lead: mensaje de ${d.from} guardado (empresa ${empresa.id}, conv ${conv.id}).`,
    );

    // ─── FASE 1c: respuesta con IA ────────────────────────────────────────────
    // Toggle multi-tenant: si la empresa no activó la IA, sólo capturamos el CRM.
    if (!empresa.iaVentasActiva) return;
    if (!this.ia.disponible()) {
      this.logger.warn('IA de ventas sin GEMINI_API_KEY; no se responde.');
      return;
    }
    // Si era nota de voz y no se pudo transcribir, solo guardamos (no respondemos).
    if (d.esAudio && !audioTranscrito) return;

    // Bot pausado en este prospecto (un humano tomó el chat).
    const prospecto = await this.prisma.leadProspecto.findUnique({
      where: { conversacionId: conv.id },
      select: { id: true, botActivo: true, notificadoEn: true },
    });
    if (prospecto && !prospecto.botActivo) return;

    // Idempotencia de la respuesta: ¿ya contestamos a este mensaje?
    const yaRespondido = await this.prisma.leadMensaje.count({
      where: {
        conversacionId: conv.id,
        rol: 'ASISTENTE',
        id: { gt: userMsgId },
      },
    });
    if (yaRespondido > 0) return;

    // Tope mensual de leads del plan (soft-block): el lead se captura igual, pero
    // si esta conversación supera el tope, la IA no responde y se avisa al admin.
    if (await this.superaTopeLeads(empresa.id, empresa.plan?.maxLeadsMes ?? null, conv.creadoEn)) {
      return;
    }

    // Historial completo de la conversación (incluye el mensaje recién guardado).
    const mensajes = await this.prisma.leadMensaje.findMany({
      where: { conversacionId: conv.id },
      orderBy: { id: 'asc' },
      select: { rol: true, contenido: true },
    });
    const historial: MensajeConversacion[] = mensajes.map((m) => ({
      role: m.rol === 'USUARIO' ? 'user' : 'assistant',
      content: m.contenido,
    }));

    // Contexto = datos de la empresa + fragmentos RAG relevantes al mensaje.
    const contextoEmpresa = this.construirContexto(empresa);
    const contextoRag = await this.rag.buscarContexto(empresa.id, d.text, 5);
    const businessContext = [contextoEmpresa, contextoRag]
      .filter((s) => s && s.trim())
      .join('\n\n');

    let resultado: RespuestaVenta;
    try {
      resultado = await this.ia.generarRespuesta(
        historial,
        businessContext,
        historial.length,
      );
    } catch (err) {
      if (esErrorPermanente(err)) {
        // Credenciales/modelo inválidos → no reintentar.
        const msg = err instanceof Error ? err.message : String(err);
        throw new UnrecoverableError(`IA auth error: ${msg}`);
      }
      // Transitorio (rate limit, red) → relanzar para que BullMQ reintente.
      throw err;
    }

    // Persistir la respuesta y enviarla desde el número de la empresa.
    await this.prisma.leadMensaje.create({
      data: {
        conversacionId: conv.id,
        rol: 'ASISTENTE',
        contenido: resultado.reply,
      },
    });
    const envio = await this.whatsapp.enviarTexto(
      d.from,
      resultado.reply,
      empresa.id,
    );
    if (!envio.success) {
      this.logger.warn(
        `Lead: envío WhatsApp falló a ${d.from}: ${envio.error}`,
      );
    }
    // Solo +1: el mensaje del usuario ya se contó en persistirMensajeUsuario.
    await this.prisma.leadConversacion.update({
      where: { id: conv.id },
      data: { cantidadMensajes: { increment: 1 } },
    });

    // Calificación BANT + alerta de lead caliente.
    if (resultado.calificacion) {
      await this.aplicarCalificacion(
        empresa,
        conv.id,
        d,
        resultado.calificacion,
      );
    }
  }

  /**
   * Crea el mensaje del prospecto si no existe. Devuelve su id, o `null` si ya
   * existía Y ya fue respondido (nada que hacer). Si existía pero aún sin
   * respuesta (reintento tras fallo de IA), devuelve el id para reintentar.
   */
  /**
   * Soft-block por tope mensual de leads del plan. Cuenta la posición (rank) de
   * ESTA conversación entre las creadas en el mes; si supera el tope, la IA no
   * responde (el lead ya quedó capturado). Avisa al admin una sola vez (cuando
   * es el primer lead que pasa el tope). `tope` null/≤0 = ilimitado.
   */
  private async superaTopeLeads(
    empresaId: number,
    tope: number | null,
    convCreadoEn: Date,
  ): Promise<boolean> {
    if (!tope || tope <= 0) return false;
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const rank = await this.prisma.leadConversacion.count({
      where: { empresaId, creadoEn: { gte: inicioMes, lte: convCreadoEn } },
    });
    if (rank <= tope) return false;

    this.logger.log(
      `Lead sobre el tope del plan (${rank}/${tope}) en empresa ${empresaId}; IA no responde.`,
    );
    // Primer lead que supera el tope este mes → avisar al admin una sola vez.
    if (rank === tope + 1) {
      await this.notificaciones
        .notificarAdminsEmpresa({
          empresaId,
          tipo: 'WARNING',
          titulo: '📈 Alcanzaste el tope de leads de tu plan',
          mensaje: `Tu plan atiende hasta ${tope} leads al mes con IA y llegaste al límite. Los nuevos leads se siguen guardando, pero la IA no responde automáticamente hasta que subas de plan.`,
          metaData: { origen: 'ia-ventas-tope', tope, actual: rank },
        })
        .catch(() => {});
    }
    return true;
  }

  private async persistirMensajeUsuario(
    conversacionId: number,
    whatsappMsgId: string,
    contenido: string,
    esAudio: boolean,
  ): Promise<number | null> {
    const existente = await this.prisma.leadMensaje.findUnique({
      where: { whatsappMsgId },
      select: { id: true, conversacionId: true },
    });
    if (existente) {
      const respondido = await this.prisma.leadMensaje.count({
        where: {
          conversacionId: existente.conversacionId,
          rol: 'ASISTENTE',
          id: { gt: existente.id },
        },
      });
      return respondido > 0 ? null : existente.id;
    }
    try {
      const creado = await this.prisma.leadMensaje.create({
        data: {
          conversacionId,
          rol: 'USUARIO',
          contenido,
          whatsappMsgId,
          esAudio,
        },
        select: { id: true },
      });
      await this.prisma.leadConversacion.update({
        where: { id: conversacionId },
        data: { cantidadMensajes: { increment: 1 } },
      });
      return creado.id;
    } catch (e) {
      if (esCodigoPrisma(e, 'P2002')) {
        // Carrera con otra entrega: recuperar el id existente.
        const m = await this.prisma.leadMensaje.findUnique({
          where: { whatsappMsgId },
          select: { id: true },
        });
        return m?.id ?? null;
      }
      throw e;
    }
  }

  /** Construye el contexto de negocio que la IA usa como conocimiento base. */
  private construirContexto(empresa: {
    razonSocial: string;
    nombreComercial: string | null;
    descripcionTienda: string | null;
    iaVentasContexto: string | null;
    rubro: { nombre: string } | null;
  }): string {
    const partes: string[] = [];
    partes.push(
      `Negocio: ${empresa.nombreComercial || empresa.razonSocial}${
        empresa.rubro ? ` (rubro: ${empresa.rubro.nombre})` : ''
      }.`,
    );
    if (empresa.descripcionTienda) partes.push(empresa.descripcionTienda);
    if (empresa.iaVentasContexto) partes.push(empresa.iaVentasContexto);
    return partes.join('\n');
  }

  /** Crea/actualiza el LeadProspecto con la calificación y alerta si es caliente. */
  private async aplicarCalificacion(
    empresa: {
      id: number;
      nombreComercial: string | null;
      razonSocial: string;
    },
    conversacionId: number,
    d: MensajeEntrante,
    cal: CalificacionBant,
  ): Promise<void> {
    const data = {
      puntaje: cal.score.total,
      estado: estadoProspectoDesde(cal.status),
      presupuesto: cal.score.budget,
      autoridad: cal.score.authority,
      necesidad: cal.score.need,
      plazo: cal.score.timeline,
      resumen: cal.resumen,
      puntosClave: cal.puntosClave,
      proximaAccion: cal.proximaAccion,
    };

    const prospecto = await this.prisma.leadProspecto.upsert({
      where: { conversacionId },
      create: {
        empresaId: empresa.id,
        telefonoProspecto: d.from,
        nombreProspecto: d.nombre ?? null,
        conversacionId,
        ...data,
      },
      update: data,
      select: { id: true, notificadoEn: true },
    });

    // Alerta de lead CALIENTE al vendedor (una sola vez, reusa notificaciones de MYPE).
    if (cal.debeTransferir && !prospecto.notificadoEn) {
      const nombre = d.nombre || d.from;
      await this.notificaciones.notificarAdminsEmpresa({
        empresaId: empresa.id,
        tipo: 'INFO',
        titulo: `🔥 Lead caliente: ${nombre}`,
        mensaje: `${cal.resumen}\n\nAcción sugerida: ${cal.proximaAccion}`,
        metaData: {
          origen: 'ia-ventas',
          prospectoId: prospecto.id,
          telefono: d.from,
          puntaje: cal.score.total,
        },
      });
      // Alerta multicanal (correo + WhatsApp al vendedor), best-effort.
      await this.alerta.alertarLeadCaliente({
        empresaId: empresa.id,
        empresaNombre: empresa.nombreComercial || empresa.razonSocial,
        prospectoId: prospecto.id,
        nombreProspecto: nombre,
        telefonoProspecto: d.from,
        cal,
      });

      await this.prisma.leadProspecto.update({
        where: { id: prospecto.id },
        data: { notificadoEn: new Date() },
      });
    }
  }
}

/** ¿El error es un error conocido de Prisma con el código dado (p. ej. P2002)? */
function esCodigoPrisma(e: unknown, codigo: string): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === codigo
  );
}

/** Errores de IA que NO tiene sentido reintentar (credenciales/modelo). */
function esErrorPermanente(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('401') ||
    msg.includes('invalid api key') ||
    msg.includes('api key') ||
    msg.includes('not configurado') ||
    msg.includes('model_not_found') ||
    msg.includes('404')
  );
}
