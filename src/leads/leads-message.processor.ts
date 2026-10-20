import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { RagVentasService, codigosDeFichas } from './leads-rag.service';
import { LeadsAlertaService } from './leads-alerta.service';
import { ComprobanteService } from '../comprobante/comprobante.service';
import {
  DEBOUNCE_RESPUESTA_MS,
  JOB_RESPONDER,
  LEADS_MESSAGES_QUEUE,
} from './leads.constants';
import { DisponibilidadProducto, Prisma } from '@prisma/client';
import { EjecutorHerramienta } from '../gemini/gemini.service';
import {
  HERRAMIENTA_AVISAR_VISITA,
  HERRAMIENTA_CANCELAR_PEDIDO,
  HERRAMIENTA_BUSCAR_PRODUCTOS,
  HERRAMIENTA_COTIZAR,
  HERRAMIENTA_DERIVAR,
  HERRAMIENTA_AVISAR_RIESGO,
  HERRAMIENTA_AGENDAR_RECORDATORIO,
  HERRAMIENTA_ENVIAR_FOTO,
  HERRAMIENTA_GUARDAR_DATOS,
  HERRAMIENTA_REGISTRAR_PEDIDO,
} from './leads-herramientas';
import {
  debeReactivarse,
  estaPausado,
  esMotivoDeComprobante,
  motivoDerivacionValido,
  venceEn,
} from './pausa-bot';
import { conDescargoLegal } from './prompt-asesor';
import { afirmaCancelacion, sinConfirmacionFalsa } from './confirmacion-falsa';
import { conRegistroDirecto, yaAceptoAntes } from './registro-directo';
import { conCotizacionExacta } from './cotizacion-exacta';
import { conBloqueDeDatosExacto } from './datos-en-bloque';
import { conIndicacionMedica, esAltoRiesgo } from './alto-riesgo';
import { avisoVoucher, extraerTitular } from './voucher-verificacion';
import { conNombreBienEscrito } from './nombre-negocio';
import { fechaMencionada } from './fecha-mencionada';

/** Frases de "retomo después" que acompañan a una fecha. */
const POSPONE =
  /\b(te escribo|te aviso|te confirmo|te hablo|cobro|cobre|me pagan|regreso|vuelvo|lo compro|lo pido|ahi compro|ahi te)\b/i;
import { esNumeroInterno, numerosInternos } from './numeros-internos';
import { bloqueComercial } from './tarifas-y-descuentos';
import {
  DatosDelCliente,
  ItemPedido,
  LeadsPedidoService,
} from './leads-pedido.service';
import { LeadsEmbudoService } from './leads-embudo.service';
import { LeadsConsultasService } from './leads-consultas.service';
import { LeadsDisparadoresService } from './leads-disparadores.service';
import {
  TipoDisparo,
  aLaHoraEnLima,
  postergaLaCompra,
} from './leads-disparadores';
import { EtapaCrm } from './leads-embudo';
import {
  disponibilidadEfectiva,
  textoParaElCliente,
} from '../producto/disponibilidad.util';
import {
  RESPUESTAS_A_COMPARAR,
  aportaDatoNuevo,
  esCortesiaBreve,
  esDespedidaClara,
  esRepetida,
} from './leads-repeticion';
import {
  IaVentasService,
  MensajeConversacion,
  RespuestaVenta,
  CalificacionBant,
  estadoProspectoDesde,
} from './leads-ia.service';

/** Un producto tal como lo necesita la IA. */
interface ProductoParaIa {
  id: number;
  descripcion: string;
  precioUnitario: any;
  stock: any;
  moneda: string;
  imagenUrl: string | null;
  disponibilidad: DisponibilidadProducto | null;
  prioridadVenta: number | null;
}

/**
 * Cuánto tiene que parecerse el nombre de un producto a lo que escribió el
 * cliente. Medido contra el catálogo real de Hierba Sana: a 0.45 "fenocreco"
 * encuentra Fenogreco (0.538) y una dolencia no devuelve nada. Más bajo
 * empieza a traer productos que no vienen a cuento.
 */
const UMBRAL_PARECIDO = 0.45;

/** Lo que la IA logró leer de un comprobante de pago. Null = no se pudo. */
type ComprobanteLeido = Awaited<
  ReturnType<IaVentasService['leerComprobantePago']>
>;

/** Lo que necesita el trabajo de respuesta: la conversación, no el mensaje. */
interface TareaRespuesta {
  empresaId: number;
  conversacionId: number;
}

interface MensajeEntrante {
  phoneNumberId: string;
  from: string;
  messageId: string;
  text: string;
  esAudio: boolean;
  esImagen?: boolean;
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
    private readonly comprobante: ComprobanteService,
    private readonly pedido: LeadsPedidoService,
    private readonly embudo: LeadsEmbudoService,
    private readonly consultas: LeadsConsultasService,
    private readonly disparadores: LeadsDisparadoresService,
    @InjectQueue(LEADS_MESSAGES_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<MensajeEntrante | TareaRespuesta>): Promise<void> {
    if (job.name === JOB_RESPONDER) {
      try {
        // Solo si este turno respondió: si no respondió a propósito (bot en
        // pausa, tope del plan), reprogramar sería un bucle.
        if (await this.responder(job.data as TareaRespuesta)) {
          await this.responderLoQueQuedo(job.data as TareaRespuesta);
        }
        return;
      } catch (e) {
        // Acá es donde el cliente se quedaba hablando solo: la cola reintenta
        // tres veces y, si la IA sigue sin poder responder, el trabajo muere
        // en silencio. Nadie le avisa al cliente y nadie le avisa al negocio.
        await this.avisarQueLaIaNoPudo(job, e).catch(() => undefined);
        throw e;
      }
    }
    return this.ingresar(job.data as MensajeEntrante);
  }

  /**
   * ¿Quedó un mensaje del cliente sin contestar al terminar este turno?
   *
   * Mientras este trabajo corre, su id está ocupado y lo que escribe el
   * cliente NO programa respuesta propia. El control de "llegó algo nuevo"
   * antes de enviar cubre lo que entra mientras la IA piensa, pero no lo que
   * entra DESPUÉS de enviar (brochure, calificación: varios segundos). 19-10,
   * Krezka: "Es Farmacia, ambas plataformas…" llegó 1 s después de la
   * respuesta y quedó sin contestar. Si lo último es del cliente, se
   * reprograma con otro id.
   */
  private async responderLoQueQuedo(t: TareaRespuesta): Promise<void> {
    const ultimo = await this.prisma.leadMensaje.findFirst({
      where: { conversacionId: t.conversacionId },
      orderBy: { id: 'desc' },
      select: { id: true, rol: true },
    });
    if (!ultimo || ultimo.rol !== 'USUARIO') return;
    await this.queue.add(JOB_RESPONDER, t, {
      jobId: `resp-${t.empresaId}-${t.conversacionId}-tras-${ultimo.id}`,
      delay: 1_000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /**
   * Cuándo se avisó por última vez que la IA de esta empresa no puede
   * responder. Sirve para no mandar cuarenta notificaciones seguidas cuando
   * se acaba la cuota: el problema es uno solo aunque lo choquen cuarenta
   * clientes.
   *
   * Vive en memoria a propósito: si el proceso se reinicia, que vuelva a
   * avisar es lo correcto — el reinicio pudo haber sido por esto mismo.
   */
  private readonly ultimoAvisoDeFalla = new Map<number, number>();
  private static readonly ESPERA_ENTRE_AVISOS_MS = 60 * 60 * 1000;

  /**
   * La IA no pudo responder y ya no va a reintentar.
   *
   * Pasa cuando se acaban los créditos de Gemini, cuando la clave se vence o
   * cuando Google está caído. Para el cliente es indistinguible de que lo
   * ignoren, así que acá se hacen tres cosas: se le avisa al negocio, se le
   * avisa al cliente que lo atiende una persona, y se pausa la IA en ese chat
   * para que no siga chocando contra la misma pared. La pausa vence sola: si
   * el problema era pasajero, la IA retoma sin que nadie la encienda.
   */
  private async avisarQueLaIaNoPudo(
    job: Job<MensajeEntrante | TareaRespuesta>,
    error: unknown,
  ): Promise<void> {
    // Un error irrecuperable (clave inválida) no se reintenta: ya es el final.
    const intentosTotales = job.opts?.attempts ?? 1;
    const esElUltimo =
      error instanceof UnrecoverableError ||
      job.attemptsMade + 1 >= intentosTotales;
    if (!esElUltimo) return;

    const { empresaId, conversacionId } = job.data as TareaRespuesta;
    const motivo = error instanceof Error ? error.message : String(error);
    const porCuota = /429|quota|RESOURCE_EXHAUSTED|billing|credit/i.test(motivo);
    this.logger.error(
      `Lead: la IA no pudo responder la conv ${conversacionId} tras ${intentosTotales} intento(s): ${motivo.slice(0, 200)}`,
    );

    const conv = await this.prisma.leadConversacion.findUnique({
      where: { id: conversacionId },
      select: { telefonoProspecto: true, nombreProspecto: true, botActivo: true },
    });
    if (!conv) return;

    // 1) La IA deja de intentar en este chat. Vence sola.
    if (conv.botActivo) {
      const pausa = {
        botActivo: false,
        pausadoHasta: venceEn(),
        motivoPausa: porCuota
          ? 'la IA se quedó sin cuota o sin créditos'
          : 'la IA no pudo responder',
      };
      await this.prisma
        .$transaction([
          this.prisma.leadConversacion.update({
            where: { id: conversacionId },
            data: pausa,
          }),
          this.prisma.leadProspecto.updateMany({
            where: { conversacionId },
            data: pausa,
          }),
        ])
        .catch(() => undefined);
    }

    // 2) El cliente se entera de que lo van a atender, en vez de nada.
    //    Una sola vez: desde acá la conversación queda pausada, así que los
    //    mensajes que sigan ya no llegan a este camino.
    if (conv.botActivo) {
      await this.whatsapp
        .enviarTexto(
          conv.telefonoProspecto,
          'Disculpa la demora, en un momento te atiende una persona del equipo.',
          empresaId,
        )
        .catch(() => undefined);
    }

    // 3) El negocio se entera. Como mucho una vez por hora: la cuota agotada
    //    es un problema solo, aunque lo choquen veinte clientes.
    const ahora = Date.now();
    const ultimo = this.ultimoAvisoDeFalla.get(empresaId) ?? 0;
    if (ahora - ultimo < LeadsMessageProcessor.ESPERA_ENTRE_AVISOS_MS) return;
    this.ultimoAvisoDeFalla.set(empresaId, ahora);

    const titulo = porCuota
      ? '🔴 La IA se quedó sin créditos y dejó de responder'
      : '🔴 La IA no está pudiendo responder';
    const quePasa = porCuota
      ? 'Gemini rechazó las respuestas por cuota o créditos agotados. Carga créditos en Google AI Studio para que vuelva a atender.'
      : 'La IA falló al responder y ya agotó los reintentos.';
    await this.notificaciones
      .notificarAdminsEmpresa({
        empresaId,
        tipo: 'CRITICAL',
        titulo,
        mensaje:
          `${quePasa}

` +
          `Mientras tanto los chats quedan en pausa y hay que atenderlos a mano desde el panel.
` +
          `Último chat afectado: ${conv.nombreProspecto ?? conv.telefonoProspecto}

` +
          `Detalle técnico: ${motivo.slice(0, 300)}`,
        metaData: {
          origen: 'ia-ventas-sin-respuesta',
          conversacionId,
          porCuota,
        },
      })
      .catch(() => undefined);

    // Y por WhatsApp a quien atiende: si nadie mira el panel, el aviso in-app
    // no sirve de nada — que es justo el escenario que esto viene a evitar.
    const cfg = await this.pedido.configDe(empresaId).catch(() => null);
    await this.alerta
      .avisarDerivacion({
        empresaId,
        telefonoProspecto: conv.telefonoProspecto,
        nombreProspecto: conv.nombreProspecto ?? null,
        motivo: porCuota ? 'sin créditos de IA' : 'fallo de la IA',
        detalle: quePasa,
        supervisorTelefono: cfg?.supervisorTelefono ?? null,
      })
      .catch(() => undefined);
  }

  /**
   * Guarda un mensaje entrante y programa la respuesta.
   *
   * La respuesta va en un trabajo aparte con un id por conversación: si el
   * cliente manda tres mensajes seguidos, los tres se guardan pero solo se
   * programa una respuesta, y esa respuesta los lee todos. Antes cada mensaje
   * disparaba el suyo y el cliente recibía tres contestaciones sueltas.
   */
  private async ingresar(d: MensajeEntrante): Promise<void> {
    // 1) ¿Qué empresa tiene conectado este número?
    const empresa = await this.prisma.empresa.findFirst({
      where: { whatsappPhoneNumberId: d.phoneNumberId },
      select: { id: true, iaVentasActiva: true },
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
      // El cliente escribió → reinicia el contador de seguimientos (silencio nuevo).
      update: {
        seguimientos: 0,
        ...(d.nombre ? { nombreProspecto: d.nombre } : {}),
      },
      select: { id: true, estado: true },
    });

    // Cerrada y el cliente vuelve a escribir: se reabre. Solo desde CERRADA —
    // CALIFICADA y TRANSFERIDA las decide otra parte del sistema.
    if (conv.estado === 'CERRADA') {
      await this.prisma.leadConversacion.update({
        where: { id: conv.id },
        data: { estado: 'ACTIVA' },
      });
    }

    // 2b) Asegura el prospecto desde el PRIMER contacto (estado FRIO, puntaje 0),
    // así el lead aparece en el panel aunque aún no haya calificación BANT. La
    // calificación posterior (aplicarCalificacion) solo actualiza su score.
    //
    // Salvo que escriba el propio negocio. El dueño y su equipo prueban la IA
    // haciéndose pasar por clientes —es la única forma de probarla— y cada
    // prueba quedaba en el embudo como un lead más: en Hierba Sana, dos de
    // las tres conversaciones del tablero eran suyas, con puntaje 82 y 96.
    // Se les responde igual; lo que no se hace es contarlos como clientes.
    const interno = await this.esDeLaEmpresa(empresa.id, d.from);
    if (!interno) {
      await this.prisma.leadProspecto.upsert({
        where: { conversacionId: conv.id },
        create: {
          empresaId: empresa.id,
          telefonoProspecto: d.from,
          nombreProspecto: d.nombre ?? null,
          conversacionId: conv.id,
        },
        update: d.nombre ? { nombreProspecto: d.nombre } : {},
      });
    }

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

    // El cliente escribió. Dos cosas, en este orden:
    //
    // 1) Si pidió la baja, se respeta ANTES de cualquier otra cosa. El pie de
    //    las plantillas lo promete, y no cumplirlo es lo que hace que
    //    reporten el número. Funciona incluso con la IA apagada.
    // 2) Los recordatorios que esperaban respuesta ya no corresponden:
    //    escribirle "¿seguimos con tu pedido?" a alguien que acaba de
    //    contestar deja al negocio como si no leyera sus mensajes.
    await this.disparadores
      .atenderSiEsBaja(empresa.id, d.from, contenido)
      .catch(() => undefined);
    await this.disparadores
      .cancelar(
        empresa.id,
        d.from,
        [
          TipoDisparo.RECUPERAR_COTIZACION,
          TipoDisparo.CARRITO_EN_ESPERA,
          TipoDisparo.REACTIVACION,
        ],
        'El cliente escribió',
      )
      .catch(() => undefined);

    // 33.3 — "te aviso luego" no es un rechazo: es una venta en pausa. Se le
    // recuerda a la mañana siguiente, que es lo que pide el anexo. Solo tiene
    // sentido si ya hay algo cotizado; si no, no hay nada que recordar.
    if (postergaLaCompra(contenido)) {
      await this.programarCarritoEnEspera(empresa.id, conv.id, d.from);
    }

    // Una imagen en una conversación con pedido en curso es, casi siempre, el
    // voucher. Se guarda y el pedido queda esperando que una persona valide el
    // pago: el candado del anexo. Si todavía no hay nada que pagar, la imagen
    // no se toca — puede ser una receta o la foto de un frasco, y archivarla
    // sin motivo es guardar datos de alguien por nada.
    if (d.esImagen) {
      await this.registrarVoucherSiCorresponde(empresa.id, conv.id, d, userMsgId);
    }

    this.logger.log(
      `Lead: mensaje de ${d.from} guardado (empresa ${empresa.id}, conv ${conv.id}).`,
    );

    // Toggle multi-tenant: si la empresa no activó la IA, sólo capturamos el CRM.
    if (!empresa.iaVentasActiva) return;
    // Nota de voz que no se pudo transcribir: queda guardada, pero no hay con
    // qué responder.
    if (d.esAudio && !audioTranscrito) return;

    await this.programarRespuesta(empresa.id, conv.id);
  }

  /**
   * Encola la respuesta a una conversación, una sola vez por lote.
   *
   * El `jobId` por conversación es lo que agrupa: mientras haya un trabajo
   * esperando, los mensajes que lleguen no programan otro. Por eso el trabajo
   * TIENE que desaparecer al terminar — si se quedara en completados o en
   * fallidos, su id seguiría ocupado y esa conversación no volvería a recibir
   * respuesta nunca más.
   */
  private async programarRespuesta(
    empresaId: number,
    conversacionId: number,
  ): Promise<void> {
    const tarea: TareaRespuesta = { empresaId, conversacionId };
    await this.queue.add(JOB_RESPONDER, tarea, {
      jobId: `resp-${empresaId}-${conversacionId}`,
      delay: DEBOUNCE_RESPUESTA_MS,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /**
   * Responde a todo lo que el cliente haya escrito desde nuestro último
   * mensaje, en un solo turno.
   */
  private async responder(t: TareaRespuesta): Promise<boolean> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: t.empresaId },
      select: {
        id: true,
        razonSocial: true,
        nombreComercial: true,
        descripcionTienda: true,
        iaVentasActiva: true,
        iaVentasContexto: true,
        iaVentasBrochureUrl: true,
        iaVentasCotizacion: true,
        rubro: { select: { nombre: true } },
        plan: { select: { maxLeadsMes: true } },
      },
    });
    if (!empresa?.iaVentasActiva) return false;
    if (!this.ia.disponible()) {
      this.logger.warn('IA de ventas sin GEMINI_API_KEY; no se responde.');
      return false;
    }

    const conv = await this.prisma.leadConversacion.findUnique({
      where: { id: t.conversacionId },
      select: {
        id: true,
        creadoEn: true,
        telefonoProspecto: true,
        nombreProspecto: true,
        botActivo: true,
        pausadoHasta: true,
      },
    });
    if (!conv) return false;

    // Bot pausado en esta conversación (un humano tomó el chat). La pausa por
    // intervención vence sola; la de una derivación, no — ahí hay una persona
    // atendiendo y la IA no debe meterse en medio.
    //
    // Se lee de la CONVERSACIÓN y no del prospecto: los chats de prueba del
    // negocio no tienen prospecto, y leyéndolo de ahí la IA seguía
    // respondiendo encima del dueño por mucho que él tomara el chat.
    const prospecto = await this.prisma.leadProspecto.findUnique({
      where: { conversacionId: conv.id },
      select: { id: true },
    });
    if (estaPausado(conv)) return false;
    if (debeReactivarse(conv)) {
      const limpio = { botActivo: true, pausadoHasta: null, motivoPausa: null };
      await this.prisma.$transaction([
        this.prisma.leadConversacion.update({
          where: { id: conv.id },
          data: limpio,
        }),
        ...(prospecto
          ? [
              this.prisma.leadProspecto.update({
                where: { id: prospecto.id },
                data: limpio,
              }),
            ]
          : []),
      ]);
      this.logger.log(
        `Lead: venció la pausa de la conv ${conv.id}; la IA retoma.`,
      );
    }

    // Tope mensual de leads del plan (soft-block): el lead se captura igual, pero
    // si esta conversación supera el tope, la IA no responde y se avisa al admin.
    if (
      await this.superaTopeLeads(
        empresa.id,
        empresa.plan?.maxLeadsMes ?? null,
        conv.creadoEn,
      )
    ) {
      return false;
    }

    const mensajes = await this.prisma.leadMensaje.findMany({
      where: { conversacionId: conv.id },
      orderBy: { id: 'asc' },
      select: { id: true, rol: true, contenido: true, herramientasJson: true },
    });
    // Hasta dónde leyó este turno. Lo que llegue después no lo vio el modelo.
    const ultimoLeido = mensajes.at(-1)?.id ?? 0;
    // Si lo último que hay es nuestro, este lote ya fue contestado (reintento
    // de BullMQ, o una respuesta manual desde el panel mientras esperábamos).
    if (mensajes.at(-1)?.rol !== 'USUARIO') return false;

    const historial: MensajeConversacion[] = mensajes.map((m) => ({
      role: m.rol === 'USUARIO' ? 'user' : 'assistant',
      content: m.contenido,
    }));
    // Todo lo que el cliente escribió desde nuestra última respuesta: la
    // búsqueda de productos y la detección de brochure miran el lote entero,
    // no solo el último mensaje.
    const contenido = this.ultimoLoteDelCliente(mensajes);

    // Contexto = datos de la empresa + fragmentos RAG relevantes al mensaje.
    const contextoEmpresa = this.construirContexto(empresa);
    // La configuración se lee ANTES de armar el contexto: las tarifas y los
    // descuentos entran en el prompt escritos desde ella, no copiados a mano
    // en el texto del empresario. Así lo que la IA dice es, por
    // construcción, lo que el sistema va a cobrar.
    const config = await this.pedido.configDe(empresa.id);
    const comercial = bloqueComercial(config);
    // Productos REALES del ERP que coinciden con lo que pregunta el cliente
    // (precio + stock en vivo). Lo que diferencia a la IA de un bot "ciego".
    const relevantes = await this.buscarProductosRelevantes(
      empresa.id,
      contenido,
    );
    await this.anotarEnListaDeEspera(
      empresa.id,
      conv.id,
      conv.telefonoProspecto,
      contenido,
      relevantes.productos[0],
    );
    const contextoRag = await this.rag.buscarContexto(empresa.id, contenido, 5);
    // Lo FIJO del negocio va en el prompt de sistema; lo que cambia en cada
    // mensaje (productos que coinciden, fragmentos del entrenamiento, lo ya
    // mostrado) viaja junto al mensaje del cliente. Si todo fuera junto, el
    // prompt cambiaría en cada mensaje y el caché de Gemini —el explícito y
    // el implícito— no se reutilizaría nunca: se pagaba el contexto completo
    // en cada llamada y además se creaba (y almacenaba) un caché nuevo por
    // mensaje.
    const businessContext = [
      contextoEmpresa,
      // Mientras un cliente siga teniendo los números copiados en su texto
      // libre, las dos versiones conviven en el prompt. Por eso el bloque
      // dice de sí mismo que es el que manda.
      comercial,
    ]
      .filter((s) => s && s.trim())
      .join('\n\n');
    const pedidoEnCurso = await this.estadoDelPedido(conv.id);
    const contextoDelTurno = [
      // La fecha va acá y no en el prompt fijo: cambia cada día y rompería el
      // caché. La necesita la IA para convertir "en una semana" en una fecha.
      `HOY: ${new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} (${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())}).`,
      this.productosYaMostrados(mensajes),
      // 20-10: el cliente quitó y agregó productos y la cotización no cambió;
      // el modelo no sabía que tenía que volver a cotizar.
      pedidoEnCurso?.cotizado
        ? `PEDIDO YA COTIZADO: ${pedidoEnCurso.cotizado}. Si en este mensaje el cliente agrega, quita o cambia un producto o una cantidad, llama a cotizar con la lista COMPLETA ya actualizada y muéstrale la cotización nueva antes de seguir.`
        : '',
      relevantes.contexto,
      contextoRag,
    ]
      .filter((s) => s && s.trim())
      .join('\n\n');

    // El modelo puede pedir herramientas (buscar en el catálogo, enviar una
    // foto). `fotosEnviadas` evita repetir la misma imagen en un turno.
    const fotosEnviadas = new Set<number>();
    const ejecutor = this.crearEjecutor(
      empresa.id,
      conv.id,
      conv.telefonoProspecto,
      fotosEnviadas,
    );

    let resultado: RespuestaVenta;
    try {
      resultado = await this.ia.generarRespuesta(
        historial,
        businessContext,
        historial.length,
        ejecutor,
        {
          nombre: empresa.nombreComercial || empresa.razonSocial,
          rubro: empresa.rubro?.nombre ?? null,
          asesor: config.asesor ?? null,
          contexto: businessContext,
        },
        contextoDelTurno,
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

    // Respuesta vacía: pasó en el QA del 20-10 ("mejor quiero dos, ya no
    // una" → 0 tokens de salida) y el envío a WhatsApp falló con el cliente
    // sin respuesta. Si el turno cotizó, va la cotización; si no, se reintenta
    // el trabajo como cualquier fallo pasajero del modelo.
    if (!resultado.reply?.trim()) {
      const cotizado = [...resultado.llamadas]
        .reverse()
        .map((ll) => ll.resultado as { texto?: unknown; pedidoActualizado?: unknown } | null)
        .find((r) => typeof r?.texto === 'string');
      if (cotizado) {
        resultado.reply = cotizado.pedidoActualizado
          ? `${String(cotizado.texto)}\n\nTu pedido ${String(cotizado.pedidoActualizado)} quedó actualizado con este total.`
          : String(cotizado.texto);
      } else {
        throw new Error(`La IA devolvió una respuesta vacía en la conv ${conv.id}.`);
      }
    }

    if (resultado.uso) {
      // Queda en el log para poder calcular el costo real por cliente: casi
      // todo es contexto fijo que se reenvía en cada vuelta del ciclo.
      this.logger.log(
        `IA conv ${conv.id}: ${resultado.uso.entrada} tokens de entrada (${resultado.uso.cacheados ?? 0} desde caché) + ${resultado.uso.salida} de salida en ${resultado.uso.llamadasAlModelo} llamada(s).`,
      );
    }

    // El descargo legal lo pone el código, no el modelo: el anexo lo exige
    // "fijo e invariable" y un modelo lo olvida justo en el mensaje que
    // importa. Solo cuando el turno recomendó productos de verdad.
    const recomendoProductos = resultado.llamadas.some((ll) => {
      const r = ll.resultado as { productos?: unknown[]; texto?: string };
      return (
        (Array.isArray(r?.productos) && r.productos.length > 0) || !!r?.texto
      );
    });
    const descargo = config.descargoLegal?.trim();
    const descargoYaEnviado = descargo
      ? !!(await this.prisma.leadMensaje.findFirst({
          where: {
            conversacionId: conv.id,
            rol: 'ASISTENTE',
            contenido: { contains: descargo },
          },
          select: { id: true },
        }))
      : false;
    resultado.reply = conDescargoLegal(
      resultado.reply,
      config.descargoLegal,
      recomendoProductos,
      descargoYaEnviado,
    );

    // El cliente solo dio las gracias o dijo "ok" y lo que íbamos a contestar
    // es otra vez lo mismo con otras palabras: no se manda. Es el error que el
    // banco del cliente marca como crítico (insistir tras la despedida).
    const embedding = await this.embeddingDe(resultado.reply);
    const previas = embedding.length
      ? await this.respuestasRecientes(conv.id)
      : [];
    if (
      embedding.length &&
      esCortesiaBreve(contenido) &&
      esRepetida(
        embedding,
        previas.map((p) => p.embedding),
      ) &&
      // Una cifra que no estaba antes (otro precio, otra presentación) es
      // información nueva aunque la frase se parezca: eso sí se manda.
      !aportaDatoNuevo(
        resultado.reply,
        previas.map((p) => p.contenido),
      )
    ) {
      this.logger.log(
        `Lead: respuesta omitida en conv ${conv.id} (repetiría un mensaje anterior y el cliente no aportó nada nuevo).`,
      );
      return false;
    }

    // El cliente escribió mientras pensábamos. Mientras este trabajo corre su
    // id está ocupado, así que ese mensaje NO programó respuesta propia: si
    // mandáramos esto, quedaría sin contestar hasta que volviera a escribir
    // (pasó en la prueba del 19-10 con los datos de envío). Se descarta esta
    // respuesta y se vuelve a responder con todo junto.
    const llegoAlgoNuevo = await this.prisma.leadMensaje.count({
      where: { conversacionId: conv.id, rol: 'USUARIO', id: { gt: ultimoLeido } },
    });
    if (llegoAlgoNuevo) {
      this.logger.log(
        `Lead: conv ${conv.id} recibió ${llegoAlgoNuevo} mensaje(s) mientras se respondía; se vuelve a responder con todo.`,
      );
      await this.queue.add(JOB_RESPONDER, t, {
        // Otro id: el de la conversación sigue ocupado por este trabajo.
        jobId: `resp-${t.empresaId}-${t.conversacionId}-tras-${ultimoLeido}`,
        delay: 1_000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
      return false;
    }

    // Nunca "tu pedido quedó registrado" si no hay pedido.
    const borradorTrasTurno = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId: conv.id },
      select: { comprobanteId: true },
    });
    resultado.reply = sinConfirmacionFalsa(
      resultado.reply,
      resultado.llamadas,
      !!borradorTrasTurno?.comprobanteId,
    );
    // Nunca "tu pedido quedó cancelado" con la nota viva: el motorizado
    // saldría igual. Si el modelo no canceló, se cancela acá; si no se puede
    // sola (ya pagó o ya salió), la ve una persona.
    if (
      borradorTrasTurno?.comprobanteId &&
      afirmaCancelacion(resultado.reply) &&
      !resultado.llamadas.some(
        (ll) =>
          ll.nombre === HERRAMIENTA_CANCELAR_PEDIDO &&
          (ll.resultado as { cancelado?: boolean } | undefined)?.cancelado,
      )
    ) {
      const argumentos = { motivo: contenido.slice(0, 200) };
      const r = (await ejecutor(HERRAMIENTA_CANCELAR_PEDIDO, argumentos)) as {
        cancelado?: boolean;
      };
      resultado.llamadas.push({
        nombre: HERRAMIENTA_CANCELAR_PEDIDO,
        argumentos,
        resultado: r,
      });
      if (!r?.cancelado) {
        await ejecutor(HERRAMIENTA_DERIVAR, {
          motivo: 'cancelacion',
          detalle: `El cliente quiere cancelar su pedido: "${contenido.slice(0, 200)}"`,
        });
        resultado.reply =
          'Entiendo. Como tu pedido ya está en proceso, la cancelación la revisa una persona del equipo: ya le avisé y te escribe por aquí.';
      }
    }
    resultado.reply = conCotizacionExacta(resultado.reply, resultado.llamadas);
    // Con lo que quedó guardado DESPUÉS del turno: si el cliente ya dio
    // algún dato, el bloque pide solo lo que falta.
    const pedidoTrasTurno = await this.estadoDelPedido(conv.id);

    // El cliente ya dijo "sí, agéndalo" antes de ver la cotización y en este
    // turno llegó lo último que faltaba: se registra ya. Antes se le mostraba
    // la cotización y se le volvía a preguntar, y el pedido quedaba colgado
    // hasta un segundo "sí" (NV01-00000025, 20-10). Solo delivery en Lima:
    // en provincia el registro va con el adelanto y los medios de pago, y
    // eso lo dice el modelo con lo que devuelve registrar_pedido.
    if (
      !pedidoEnCurso?.cotizado &&
      pedidoTrasTurno?.cotizado &&
      pedidoTrasTurno.tipoZona === 'DOMICILIO' &&
      pedidoTrasTurno.faltan.length === 0 &&
      resultado.llamadas.some((ll) => ll.nombre === HERRAMIENTA_COTIZAR) &&
      !resultado.llamadas.some((ll) => ll.nombre === HERRAMIENTA_REGISTRAR_PEDIDO) &&
      yaAceptoAntes(mensajes.filter((m) => m.rol === 'USUARIO').map((m) => m.contenido))
    ) {
      const r = (await ejecutor(HERRAMIENTA_REGISTRAR_PEDIDO, {})) as {
        pedido?: string;
        montoAPagar?: number;
      };
      resultado.llamadas.push({
        nombre: HERRAMIENTA_REGISTRAR_PEDIDO,
        argumentos: {},
        resultado: r,
      });
      if (r?.pedido) {
        resultado.reply = conRegistroDirecto(resultado.reply, r.pedido, r.montoAPagar);
      }
    }
    resultado.reply = conBloqueDeDatosExacto(
      resultado.reply,
      pedidoTrasTurno?.pedirTodoJunto,
    );

    // Cliente de alto riesgo: la indicación médica y el aviso al equipo no
    // dependen de que el modelo se acuerde (ver alto-riesgo.ts). Va después
    // del control de mensajes nuevos: si este turno se descartara, el aviso
    // saldría dos veces.
    if (esAltoRiesgo(contenido)) {
      resultado.reply = conIndicacionMedica(resultado.reply);
      const yaLoLlamo = resultado.llamadas.some(
        (ll) => ll.nombre === HERRAMIENTA_AVISAR_RIESGO,
      );
      if (!yaLoLlamo) {
        const argumentos = { riesgo: contenido.slice(0, 300) };
        const r = await ejecutor(HERRAMIENTA_AVISAR_RIESGO, argumentos);
        // Queda en el historial de herramientas: es lo que evita repetir el
        // aviso en el próximo mensaje.
        resultado.llamadas.push({
          nombre: HERRAMIENTA_AVISAR_RIESGO,
          argumentos,
          resultado: r,
        });
      }
    }

    // Dijo una fecha para retomar y el modelo no la agendó: se agenda igual.
    // Va después del control de mensajes nuevos (no duplicar si se descarta
    // el turno) y solo si de verdad está posponiendo la compra.
    const fechaDicha = fechaMencionada(contenido);
    if (
      fechaDicha &&
      (postergaLaCompra(contenido) || POSPONE.test(contenido)) &&
      !resultado.llamadas.some((ll) => ll.nombre === HERRAMIENTA_AGENDAR_RECORDATORIO) &&
      !borradorTrasTurno?.comprobanteId
    ) {
      const argumentos = { fecha: fechaDicha, motivo: 'detectado en el mensaje' };
      const r = await ejecutor(HERRAMIENTA_AGENDAR_RECORDATORIO, argumentos);
      resultado.llamadas.push({
        nombre: HERRAMIENTA_AGENDAR_RECORDATORIO,
        argumentos,
        resultado: r,
      });
    }

    resultado.reply = conNombreBienEscrito(
      resultado.reply,
      empresa.nombreComercial || empresa.razonSocial,
    );

    // Persistir la respuesta y enviarla desde el número de la empresa.
    await this.prisma.leadMensaje.create({
      data: {
        conversacionId: conv.id,
        rol: 'ASISTENTE',
        contenido: resultado.reply,
        herramientasJson: resultado.llamadas.length
          ? (resultado.llamadas as unknown as Prisma.InputJsonValue)
          : undefined,
        embedding,
      },
    });
    const envio = await this.whatsapp.enviarTexto(
      conv.telefonoProspecto,
      resultado.reply,
      empresa.id,
    );
    if (!envio.success) {
      this.logger.warn(
        `Lead: envío WhatsApp falló a ${conv.telefonoProspecto}: ${envio.error}`,
      );
    }

    // Las fotos de producto ya no se adivinan con una expresión regular sobre
    // el texto: el modelo las pide con la herramienta `enviar_foto` cuando hace
    // falta, y el ejecutor las manda en ese momento.

    await this.enviarBrochureSiCorresponde(empresa, conv, contenido);
    await this.enviarVideoBienvenidaSiEsElPrimero(empresa.id, conv, config);

    // Solo +1: los mensajes del cliente ya se contaron al guardarlos.
    await this.prisma.leadConversacion.update({
      where: { id: conv.id },
      data: { cantidadMensajes: { increment: 1 } },
    });

    // Calificación BANT + alerta de lead caliente.
    if (resultado.calificacion) {
      await this.aplicarCalificacion(
        empresa,
        conv.id,
        { telefono: conv.telefonoProspecto, nombre: conv.nombreProspecto },
        resultado.calificacion,
        historial,
      );
    }

    // Despedida clara del cliente: ya se le contestó una vez y la conversación
    // se cierra, para que el cron de seguimiento (que solo mira las ACTIVA) no
    // la reabra con otro mensaje comercial. Va al final, después de calificar:
    // un lead que se despide igual tiene que quedar puntuado en el CRM.
    if (esDespedidaClara(contenido)) {
      await this.prisma.leadConversacion.update({
        where: { id: conv.id },
        data: { estado: 'CERRADA' },
      });
      this.logger.log(
        `Lead: conv ${conv.id} cerrada por despedida del cliente.`,
      );
    }
    return true;
  }

  /**
   * Embedding de un texto, best-effort. Si Gemini falla, se devuelve vacío: el
   * control de repetición es una mejora, nunca un motivo para dejar al cliente
   * sin respuesta.
   */
  private async embeddingDe(texto: string): Promise<number[]> {
    try {
      return await this.ia.generarEmbedding(texto);
    } catch (e) {
      this.logger.warn(
        `No se pudo calcular el embedding de la respuesta: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  }

  /** Nuestras últimas respuestas en esta conversación, con su embedding. */
  private async respuestasRecientes(
    conversacionId: number,
  ): Promise<{ embedding: number[]; contenido: string }[]> {
    const previas = await this.prisma.leadMensaje.findMany({
      where: { conversacionId, rol: 'ASISTENTE' },
      orderBy: { id: 'desc' },
      take: RESPUESTAS_A_COMPARAR,
      select: { embedding: true, contenido: true },
    });
    return previas.filter((m) => m.embedding.length > 0);
  }

  /** Las columnas que la IA necesita de un producto. */
  private static readonly CAMPOS_PRODUCTO = {
    id: true,
    descripcion: true,
    precioUnitario: true,
    stock: true,
    moneda: true,
    imagenUrl: true,
    disponibilidad: true,
    prioridadVenta: true,
  } as const;

  /**
   * Segundo escalón: productos cuyo NOMBRE se parece a lo que escribió el
   * cliente, aunque lo haya escrito mal. Trigramas de Postgres (pg_trgm).
   *
   * `word_similarity` y no `similarity` porque se compara una palabra suelta
   * contra un nombre largo: "fenocreco" contra "Fenogreco Alholva - NATURAL
   * MEDIX ( 100 capsulas )" da 0.54 con la primera y casi nada con la segunda.
   * El umbral está medido contra el catálogo real: a 0.45, "fenocreco"
   * encuentra Fenogreco y "dolor de rodillas" no devuelve nada (que es lo
   * correcto: una dolencia no se parece a ningún nombre de producto).
   */
  private async buscarPorParecido(
    empresaId: number,
    texto: string,
    categoria?: string,
  ): Promise<ProductoParaIa[]> {
    const consulta = (texto || '').trim().slice(0, 120);
    if (consulta.length < 3) return [];
    try {
      const filtroCategoria = categoria
        ? Prisma.sql`AND c."nombre" ILIKE ${`%${categoria}%`}`
        : Prisma.empty;
      return await this.prisma.$queryRaw<ProductoParaIa[]>`
        SELECT p."id", p."descripcion", p."precioUnitario", p."stock",
               p."moneda", p."imagenUrl", p."disponibilidad", p."prioridadVenta"
        FROM "Producto" p
        LEFT JOIN "Categoria" c ON c."id" = p."categoriaId"
        WHERE p."empresaId" = ${empresaId}
          AND p."estado"::text = 'ACTIVO'
          AND word_similarity(${consulta}, p."descripcion") > ${UMBRAL_PARECIDO}
          ${filtroCategoria}
        ORDER BY word_similarity(${consulta}, p."descripcion") DESC,
                 p."prioridadVenta" DESC NULLS LAST
        LIMIT 8
      `;
    } catch (e) {
      // Si falta la extensión pg_trgm, la búsqueda por palabras sigue viva.
      this.logger.warn(
        `Búsqueda por parecido no disponible: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  }

  /**
   * Tercer escalón: las fichas del RAG, que sí saben a qué órgano y sistema
   * apunta cada producto. Es lo que convierte "tengo dolor de rodillas" en
   * productos concretos.
   *
   * De la ficha solo se toma el código; el precio y la disponibilidad se leen
   * de la base, porque el texto de la ficha envejece en cuanto cambia el
   * catálogo. Cuesta un embedding, por eso es el último escalón y no se usa en
   * el adelanto que va al prompt.
   */
  private async buscarPorFichas(
    empresaId: number,
    consulta: string,
  ): Promise<ProductoParaIa[]> {
    const fragmentos = await this.rag.buscarFragmentos(empresaId, consulta, 4);
    const codigos = codigosDeFichas(fragmentos).slice(0, 12);
    if (codigos.length === 0) return [];

    const productos = await this.prisma.producto.findMany({
      where: { empresaId, estado: 'ACTIVO' as any, codigo: { in: codigos } },
      select: { ...LeadsMessageProcessor.CAMPOS_PRODUCTO, codigo: true },
      take: 8,
    });
    // El RAG ya los ordenó por relevancia; la base los devuelve en otro orden.
    const posicion = new Map(codigos.map((c, i) => [c, i]));
    return productos.sort(
      (a, b) => (posicion.get(a.codigo) ?? 99) - (posicion.get(b.codigo) ?? 99),
    );
  }

  /**
   * Los productos que la IA ya le enseñó al cliente en esta conversación.
   *
   * Hace falta porque el historial que recibe el modelo es SOLO texto: los
   * resultados de sus búsquedas anteriores no se le devuelven, así que no
   * puede ver lo que ya buscó y vuelve a buscarlo. Medido en el QA del flujo
   * completo: hasta tres búsquedas repetidas en un turno, cada una un viaje
   * entero al modelo.
   *
   * De paso resuelve lo que pide el flujo del cliente: que entienda "el
   * grande", "el segundo" o "ese" refiriéndose a lo que acaba de ofrecer.
   */
  private productosYaMostrados(
    mensajes: { herramientasJson?: unknown }[],
  ): string {
    const vistos = new Map<number, string>();
    // Solo lo reciente: un catálogo entero en el prompt cuesta más de lo que
    // ahorra.
    for (const m of mensajes.slice(-12)) {
      const llamadas = m.herramientasJson;
      if (!Array.isArray(llamadas)) continue;
      for (const ll of llamadas as { resultado?: unknown }[]) {
        const productos = (
          ll?.resultado as {
            productos?: {
              id?: number;
              nombre?: string;
              precio?: string;
              disponibilidad?: string;
            }[];
          }
        )?.productos;
        for (const p of productos ?? []) {
          if (typeof p?.id !== 'number') continue;
          vistos.set(
            p.id,
            `- [id ${p.id}] ${p.nombre} — ${p.precio} (${p.disponibilidad})`,
          );
        }
      }
    }
    if (vistos.size === 0) return '';
    return (
      'PRODUCTOS QUE YA LE MOSTRASTE EN ESTA CONVERSACIÓN. No los vuelvas a ' +
      'buscar: si el cliente se refiere a "el segundo", "el grande" o "ese", ' +
      'es uno de estos, y su id es el que va entre corchetes:\n' +
      [...vistos.values()].slice(0, 20).join('\n')
    );
  }

  /**
   * Lo que el cliente escribió desde nuestra última respuesta, en un solo
   * texto. Puede ser un mensaje o cinco.
   */
  private ultimoLoteDelCliente(
    mensajes: { rol: string; contenido: string }[],
  ): string {
    const lote: string[] = [];
    for (let i = mensajes.length - 1; i >= 0; i--) {
      if (mensajes[i].rol !== 'USUARIO') break;
      lote.unshift(mensajes[i].contenido);
    }
    return lote.join('\n');
  }

  /**
   * Video de bienvenida: una sola vez por conversación, justo después de la
   * PRIMERA respuesta del asesor (Krezka: mostrar el sistema en video al que
   * llega del anuncio). "Primera" = es el único mensaje del asesor en el chat,
   * así que no se repite aunque el cliente vuelva a escribir.
   */
  private async enviarVideoBienvenidaSiEsElPrimero(
    empresaId: number,
    conv: { id: number; telefonoProspecto: string },
    config: { videoBienvenidaUrl?: string },
  ): Promise<void> {
    if (!config.videoBienvenidaUrl) return;
    const respuestas = await this.prisma.leadMensaje.count({
      where: { conversacionId: conv.id, rol: 'ASISTENTE' },
    });
    if (respuestas !== 1) return;
    const url = config.videoBienvenidaUrl;
    // Un MP4 se manda como video (se ve dentro del chat); cualquier otro
    // enlace (YouTube) como mensaje con vista previa.
    if (/\.mp4(\?|$)/i.test(url)) {
      await this.whatsapp
        .enviarVideoUrl(conv.telefonoProspecto, url, undefined, empresaId)
        .catch(() => undefined);
    } else {
      await this.whatsapp
        .enviarTexto(
          conv.telefonoProspecto,
          `🎥 Te dejo un video corto para que veas cómo funciona por dentro:\n${url}`,
          empresaId,
        )
        .catch(() => undefined);
    }
  }

  /**
   * Brochure/catálogo: si el prospecto pide más info y la empresa tiene un
   * enlace configurado, se envía UNA vez por conversación (PDF o imagen).
   */
  private async enviarBrochureSiCorresponde(
    empresa: { id: number; iaVentasBrochureUrl: string | null },
    conv: { id: number; telefonoProspecto: string },
    contenido: string,
  ): Promise<void> {
    if (!empresa.iaVentasBrochureUrl || !this.quiereBrochure(contenido)) return;

    const est = await this.prisma.leadConversacion.findUnique({
      where: { id: conv.id },
      select: { brochureEnviado: true },
    });
    if (est?.brochureEnviado) return;

    const url = empresa.iaVentasBrochureUrl;
    const esImagen = /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
    const esPdf = /\.pdf(\?|$)/i.test(url);
    let res: { success: boolean };
    if (esImagen) {
      // Imagen (foto/afiche del brochure).
      res = await this.whatsapp
        .enviarImagenUrl(conv.telefonoProspecto, url, undefined, empresa.id)
        .catch(() => ({ success: false }));
    } else if (esPdf) {
      // Archivo PDF → documento.
      res = await this.whatsapp
        .enviarDocumentoUrl(
          conv.telefonoProspecto,
          url,
          'Brochure.pdf',
          undefined,
          empresa.id,
        )
        .catch(() => ({ success: false }));
    } else {
      // Página web (no es archivo) → se comparte el enlace en un mensaje.
      res = await this.whatsapp
        .enviarTexto(
          conv.telefonoProspecto,
          `📄 Aquí tienes nuestra información completa:\n${url}`,
          empresa.id,
        )
        .catch(() => ({ success: false }));
    }
    if (res.success) {
      await this.prisma.leadConversacion.update({
        where: { id: conv.id },
        data: { brochureEnviado: true },
      });
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
          titulo: '📈 Alcanzaste el tope de conversaciones de tu plan',
          mensaje: `Tu plan incluye hasta ${tope} conversaciones al mes con IA (todo incluido) y llegaste al límite. Los nuevos prospectos se siguen guardando, pero la IA no responde automáticamente hasta que subas de plan.`,
          metaData: { origen: 'ia-ventas-tope', tope, actual: rank },
        })
        .catch(() => {});
    }
    return true;
  }

  /**
   * 33.3 — el cliente postergó. Se le recuerda a la mañana siguiente, pero
   * solo si hay un pedido o una cotización en curso: recordarle un carrito
   * que no existe es escribirle por nada.
   */
  private async programarCarritoEnEspera(
    empresaId: number,
    conversacionId: number,
    telefono: string,
  ) {
    try {
      const borrador = await this.prisma.leadPedidoBorrador.findUnique({
        where: { conversacionId },
        select: { cotizacionId: true, itemsJson: true, comprobanteId: true },
      });
      // Ya comprado no se recuerda; sin nada cotizado, tampoco hay qué.
      if (borrador?.comprobanteId) return;
      const tieneItems =
        Array.isArray(borrador?.itemsJson) &&
        (borrador?.itemsJson as unknown[]).length > 0;
      if (!borrador?.cotizacionId && !tieneItems) return;

      await this.disparadores.programar({
        empresaId,
        tipo: TipoDisparo.CARRITO_EN_ESPERA,
        telefono,
        referencia: `conversacion:${conversacionId}`,
        conversacionId,
      });
    } catch (e: any) {
      this.logger.warn(`Lead: no se pudo programar el recordatorio: ${e?.message}`);
    }
  }

  /**
   * Avanza la etapa del embudo desde un automatismo.
   *
   * Nunca retrocede: si el encargado ya pasó el pedido a despacho y después
   * entra una consulta suelta, el bot no lo devuelve a "diagnosticado". Y
   * nunca puede abrir el despacho, porque va sin usuario y esa etapa exige
   * una persona.
   */
  private async marcarEtapa(
    empresaId: number,
    conversacionId: number,
    etapa: EtapaCrm,
    nota: string,
  ) {
    try {
      const prospecto = await this.prisma.leadProspecto.findFirst({
        where: { conversacionId, empresaId },
        select: { id: true },
      });
      if (!prospecto) return;
      await this.embudo.mover(prospecto.id, empresaId, etapa, {
        nota,
        soloSiAvanza: true,
      });
    } catch (e: any) {
      this.logger.warn(`Lead: no se pudo mover la etapa: ${e?.message}`);
    }
  }

  /**
   * El cliente mandó una imagen: si hay un pedido en curso, es el voucher.
   *
   * La imagen se baja de WhatsApp porque validar un pago sin verlo no es
   * validar. Todo esto es best-effort: un problema bajando la foto no puede
   * romper la atención del cliente, que es lo que importa en ese momento.
   */
  private async registrarVoucherSiCorresponde(
    empresaId: number,
    conversacionId: number,
    d: MensajeEntrante,
    mensajeId?: number,
  ) {
    try {
      const borrador = await this.prisma.leadPedidoBorrador.findUnique({
        where: { conversacionId },
        select: { cotizacionId: true, comprobanteId: true },
      });
      // Sin cotización ni pedido no hay nada que pagar todavía.
      if (!borrador?.cotizacionId && !borrador?.comprobanteId) return;

      let buffer: Buffer | undefined;
      let mimeType: string | undefined;
      if (d.mediaId) {
        try {
          const media = await this.whatsapp.descargarMedia(d.mediaId, empresaId);
          buffer = media.buffer;
          mimeType = media.mimeType;
        } catch (e: any) {
          this.logger.warn(
            `Lead: no se pudo bajar el voucher de ${d.from}: ${e?.message}`,
          );
        }
      }

      // Se lee la imagen antes de archivarla. Hasta ahora el voucher se
      // guardaba cerrado y alguien tenía que abrirlo para saber de cuánto
      // era; el cliente, mientras tanto, recibía un "ya le avisé al asesor"
      // que no confirmaba nada. Leerlo permite responderle con el monto y el
      // número de operación en el acto.
      //
      // Es un extra, no un requisito: si la IA no está o la foto no se pudo
      // bajar, `leido` queda en null y todo sigue como antes.
      let leido: ComprobanteLeido = null;
      if (buffer && mimeType && this.ia.disponible()) {
        leido = await this.ia
          .leerComprobantePago(buffer, mimeType)
          .catch(() => null);
      }

      await this.embudo.registrarComprobantePago(empresaId, conversacionId, {
        mediaId: d.mediaId,
        // El texto que acompaña a la imagen: "ya transferí", "a nombre de…".
        nota: d.text?.replace('[el cliente envió una imagen]', '').trim(),
        buffer,
        mimeType,
        leido: leido?.esComprobante ? leido : null,
      });

      // Lo leído se le cuenta al modelo escribiéndolo en el propio mensaje
      // del cliente. Así lo confirma con naturalidad —"recibí tu Yape de
      // S/ 30, operación 12345678"— y aplica solo las reglas de pago que el
      // negocio ya tiene en su contexto (saldo pendiente, monto distinto al
      // acordado). No hace falta una herramienta nueva para eso.
      if (mensajeId && leido?.esComprobante) {
        const partes = [
          leido.medio && `por ${leido.medio}`,
          leido.monto != null && `de S/ ${leido.monto.toFixed(2)}`,
          leido.numeroOperacion && `operación ${leido.numeroOperacion}`,
          leido.fecha && `del ${leido.fecha}`,
          leido.pagador && `a nombre de ${leido.pagador}`,
        ].filter(Boolean);
        if (partes.length) {
          const aviso = await this.verificarVoucher(
            empresaId,
            borrador.comprobanteId,
            leido,
          );
          await this.prisma.leadMensaje
            .update({
              where: { id: mensajeId },
              data: {
                contenido: `[el cliente envió un comprobante de pago ${partes.join(', ')}]${aviso ? ` ${aviso}` : ''}${
                  d.text?.replace('[el cliente envió una imagen]', '').trim()
                    ? ` ${d.text.replace('[el cliente envió una imagen]', '').trim()}`
                    : ''
                }`,
              },
            })
            .catch(() => undefined);
          this.logger.log(
            `Lead: comprobante leído en la conv ${conversacionId} (${partes.join(', ')}).`,
          );
        }
      }
      this.logger.log(
        `Lead: comprobante de pago de ${d.from} registrado (conv ${conversacionId}).`,
      );
    } catch (e: any) {
      this.logger.warn(
        `Lead: no se pudo registrar el comprobante de pago: ${e?.message}`,
      );
    }
  }

  /**
   * ¿La captura cuadra con el titular del negocio y con lo que falta pagar?
   * Ver voucher-verificacion.ts. Best-effort: si algo falla, no se avisa.
   */
  private async verificarVoucher(
    empresaId: number,
    comprobanteId: number | null,
    leido: { monto?: number | null; pagador?: string | null },
  ): Promise<string | null> {
    try {
      const [cfg, empresa] = await Promise.all([
        this.pedido.configDe(empresaId),
        this.prisma.empresa.findUnique({
          where: { id: empresaId },
          select: { iaVentasContexto: true },
        }),
      ]);
      const titular =
        extraerTitular(cfg.mediosPago) ??
        extraerTitular(empresa?.iaVentasContexto);
      let pendiente: number | null = null;
      if (comprobanteId) {
        const [nota, despacho] = await Promise.all([
          this.prisma.comprobante.findUnique({
            where: { id: comprobanteId },
            select: { saldo: true },
          }),
          this.prisma.envioDespacho.findUnique({
            where: { comprobanteId },
            select: { montoCOD: true },
          }),
        ]);
        pendiente =
          despacho?.montoCOD != null
            ? Number(despacho.montoCOD)
            : nota?.saldo != null
              ? Number(nota.saldo)
              : null;
      }
      return avisoVoucher({
        monto: leido.monto,
        nombre: leido.pagador,
        referenciaTitular: titular,
        pendiente,
      });
    } catch {
      return null;
    }
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

  /**
   * ¿El que escribe es el propio negocio probando su bot?
   *
   * Son dos fuentes: los celulares de los administradores —que ya están
   * cargados y son los que prueban— y los que la empresa agregue a su
   * configuración, para el resto del equipo o para un número de pruebas que
   * no pertenece a ningún usuario del sistema.
   */
  private async esDeLaEmpresa(
    empresaId: number,
    telefono: string,
  ): Promise<boolean> {
    try {
      const [admins, cfg] = await Promise.all([
        this.prisma.usuario.findMany({
          where: { empresaId, rol: 'ADMIN_EMPRESA' },
          select: { celular: true },
        }),
        this.pedido.configDe(empresaId),
      ]);
      const internos = numerosInternos(
        admins.map((a) => a.celular),
        cfg.numerosInternos ?? [],
      );
      return esNumeroInterno(telefono, internos);
    } catch (e: any) {
      // Ante la duda, es un cliente: perder un lead real es mucho peor que
      // dejar entrar una prueba al embudo.
      this.logger.warn(
        `No se pudo saber si ${telefono} es interno de la empresa ${empresaId}: ${e?.message}`,
      );
      return false;
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

  // Palabras conversacionales/de consulta que NO son nombres de producto; se
  // descartan para que la búsqueda se quede solo con los términos del producto.
  private static readonly STOPWORDS_PRODUCTO = new Set([
    'hola',
    'buenas',
    'buenos',
    'dias',
    'días',
    'tardes',
    'noches',
    'quiero',
    'quisiera',
    'necesito',
    'busco',
    'tienes',
    'tienen',
    'tiene',
    'hay',
    'habra',
    'habrá',
    'me',
    'puedes',
    'podrias',
    'podrías',
    'porfa',
    'porfavor',
    'favor',
    'cuanto',
    'cuánto',
    'cuestan',
    'cuesta',
    'precio',
    'precios',
    'vale',
    'valen',
    'costo',
    'stock',
    'disponible',
    'disponibles',
    'disponibilidad',
    'info',
    'informacion',
    'información',
    'sobre',
    'del',
    'de',
    'la',
    'el',
    'los',
    'las',
    'un',
    'una',
    'unos',
    'unas',
    'y',
    'o',
    'a',
    'en',
    'para',
    'con',
    'que',
    'qué',
    'es',
    'son',
    'tu',
    'tus',
    'su',
    'sus',
    'mi',
    'mis',
    'gustaria',
    'gustaría',
    'saber',
    'ver',
    'comprar',
    'producto',
    'productos',
    'venden',
    'vende',
    'cual',
    'cuales',
    'cuál',
    'cuáles',
    'ok',
    'gracias',
    'si',
    'sí',
    'no',
    'al',
    'lo',
    'le',
    'tienes',
    'algun',
    'algún',
    'alguna',
  ]);

  /**
   * Busca en el catálogo REAL del negocio los productos que coinciden con lo que
   * escribe el cliente y devuelve un bloque de texto con precio + stock en vivo,
   * para que la IA responda con datos reales (no inventados). Devuelve '' si el
   * mensaje no menciona ningún producto o no hay coincidencias.
   */
  /**
   * Ejecuta las herramientas que pide el modelo durante un turno.
   *
   * Cada herramienta devuelve datos, nunca texto para el cliente: lo que el
   * cliente lee lo redacta el modelo con esos datos.
   */
  private crearEjecutor(
    empresaId: number,
    conversacionId: number,
    telefono: string,
    fotosEnviadas: Set<number>,
  ): EjecutorHerramienta {
    // Si una herramienta falla en este turno, el modelo casi siempre deriva a
    // un asesor. Esa derivación NO es la misma que cuando el cliente pide
    // hablar con alguien, y hay que distinguirlas: ver `derivar` más abajo.
    let huboFalloTecnico = false;

    return async (nombre, argumentos) => {
      switch (nombre) {
        case HERRAMIENTA_BUSCAR_PRODUCTOS: {
          const consulta = String(argumentos.consulta ?? '').trim();
          if (!consulta) {
            return { error: 'Falta la consulta de búsqueda.' };
          }
          const categoria =
            typeof argumentos.categoria === 'string' &&
            argumentos.categoria.trim()
              ? argumentos.categoria.trim()
              : undefined;
          const inicio = Date.now();
          let productos = await this.consultarCatalogo(
            empresaId,
            consulta,
            categoria,
          );
          let via = 'catálogo';
          // Una dolencia ("dolor de rodillas") no se parece al nombre de
          // ningún producto, así que ni las palabras ni los trigramas la
          // encuentran. Las fichas del RAG sí saben a qué órgano y sistema
          // apunta cada producto. Va en último lugar porque cuesta un
          // embedding; las dos primeras son SQL.
          if (productos.length === 0) {
            productos = await this.buscarPorFichas(empresaId, consulta);
            via = 'fichas';
          }
          const ms = Date.now() - inicio;
          this.logger.log(
            `IA buscó "${consulta}"${categoria ? ` [${categoria}]` : ''} en empresa ${empresaId}: ${productos.length} resultado(s) por ${via} en ${ms} ms.`,
          );
          if (productos.length === 0) {
            // "No habido": lo que el cliente pidió y el negocio no tiene. Es
            // la lista con la que se decide qué reponer, y uno de los
            // reportes que pide el anexo.
            await this.consultas.registrar(empresaId, conversacionId, telefono, [
              { texto: consulta, hubo: false },
            ]);
            await this.marcarEtapa(
              empresaId,
              conversacionId,
              EtapaCrm.CONSULTADO_NO_HABIDO,
              `Pidió "${consulta}" y no lo tenemos`,
            );
            return {
              productos: [],
              mensaje:
                'Sin coincidencias. Intenta otra vez con un término distinto: el ingrediente, el órgano o sistema, o la acción que busca el cliente.',
            };
          }

          // Hubo resultados: queda registrado qué se consultó, con qué
          // disponibilidad vio el cliente el primer producto ofrecido.
          await this.consultas.registrar(empresaId, conversacionId, telefono, [
            {
              texto: consulta,
              // Por fichas no se encontró lo pedido, sino algo parecido: para
              // el reporte de "no habidos" eso sigue siendo un no habido.
              hubo: via !== 'fichas',
              productoId: productos[0]?.id ?? null,
              disponibilidad: productos[0]?.disponibilidad ?? null,
            },
          ]);
          // Preguntar por un malestar es el diagnóstico: el embudo avanza.
          await this.marcarEtapa(
            empresaId,
            conversacionId,
            EtapaCrm.DIAGNOSTICADO,
            `Consultó "${consulta}"`,
          );
          return {
            // Las fichas aciertan por significado, no por nombre: si el
            // cliente pidió algo que no existe, esto trae lo parecido. El
            // modelo tiene que saberlo o se lo vendería como si fuera lo
            // pedido.
            ...(via === 'fichas'
              ? {
                  nota: 'Estos NO son el producto exacto que pidió: son productos relacionados con lo que necesita. Ofrécelos como alternativa y dile con honestidad que lo que nombró no lo tenemos.',
                }
              : {}),
            productos: productos.map((p) => ({
              id: p.id,
              nombre: p.descripcion,
              precio: `${p.moneda === 'USD' ? 'US$' : 'S/'} ${Number(p.precioUnitario).toFixed(2)}`,
              disponibilidad: this.textoDisponibilidad(p),
              // Solo se menciona cuando el negocio marcó el producto para
              // empujarlo; sin esto el modelo no tiene por qué preferirlo.
              ...(Number(p.prioridadVenta) >= 2
                ? {
                    prioridadDeVenta:
                      Number(p.prioridadVenta) === 3 ? 'muy alta' : 'alta',
                  }
                : {}),
              tieneFoto: !!p.imagenUrl,
            })),
          };
        }

        case HERRAMIENTA_ENVIAR_FOTO: {
          const productoId = Number(argumentos.productoId);
          if (!Number.isInteger(productoId)) {
            return { error: 'productoId inválido.' };
          }
          if (fotosEnviadas.has(productoId)) {
            return { enviada: true, nota: 'Ya se envió en este mismo turno.' };
          }
          const producto = await this.prisma.producto.findFirst({
            where: { id: productoId, empresaId },
            select: {
              descripcion: true,
              imagenUrl: true,
              precioUnitario: true,
              moneda: true,
            },
          });
          if (!producto)
            return { error: 'Ese producto no es de este negocio.' };
          if (!producto.imagenUrl) {
            return {
              enviada: false,
              motivo:
                'Este producto no tiene foto en el catálogo. No le prometas una al cliente.',
            };
          }
          const simbolo = producto.moneda === 'USD' ? 'US$' : 'S/';
          const caption = `${producto.descripcion} — ${simbolo}${Number(
            producto.precioUnitario,
          ).toFixed(2)}`;
          const envio = await this.whatsapp
            .enviarImagenUrl(telefono, producto.imagenUrl, caption, empresaId)
            .catch((e: unknown) => ({
              success: false,
              error: e instanceof Error ? e.message : String(e),
            }));
          if (envio.success) fotosEnviadas.add(productoId);
          return envio.success
            ? { enviada: true }
            : { enviada: false, motivo: 'No se pudo enviar la imagen.' };
        }

        case HERRAMIENTA_GUARDAR_DATOS: {
          const res = await this.pedido.guardarDatos(
            empresaId,
            conversacionId,
            argumentos as DatosDelCliente,
          );
          // El embudo avanza solo cuando YA no falta nada. Marcar
          // "datos completos" a medio camino le haría creer al encargado que
          // puede despachar, y el paquete saldría sin dirección.
          if (res?.guardado && !res?.faltan?.length) {
            await this.marcarEtapa(
              empresaId,
              conversacionId,
              EtapaCrm.DATOS_COMPLETOS,
              'Datos de entrega completos',
            );
          }
          return res;
        }

        case HERRAMIENTA_COTIZAR: {
          const items = Array.isArray(argumentos.items)
            ? (argumentos.items as ItemPedido[])
            : [];
          const res = await this.pedido.cotizar(
            empresaId,
            conversacionId,
            items.map((i) => ({
              productoId: Number(i.productoId),
              cantidad: Number(i.cantidad),
              ...(typeof i.nombre === 'string' ? { nombre: i.nombre } : {}),
            })),
            typeof argumentos.nombrePack === 'string'
              ? argumentos.nombrePack
              : undefined,
          );
          if (res?.texto) {
            await this.marcarEtapa(
              empresaId,
              conversacionId,
              EtapaCrm.COTIZADO,
              'Cotización enviada por el chat',
            );
            // 33.2 — si no concreta, se le recuerda en 3 horas. Se cancela
            // solo en cuanto el cliente conteste.
            await this.disparadores
              .programar({
                empresaId,
                tipo: TipoDisparo.RECUPERAR_COTIZACION,
                telefono,
                referencia: `conversacion:${conversacionId}`,
                conversacionId,
              })
              .catch(() => undefined);
          }
          return res;
        }

        case HERRAMIENTA_DERIVAR: {
          const motivoCrudo = String(argumentos.motivo ?? '');
          const detalle =
            typeof argumentos.detalle === 'string' ? argumentos.detalle : '';

          // La lista de motivos es cerrada, y acá se hace cumplir: derivar
          // apaga el bot sin vencimiento, así que una derivación inventada
          // deja al cliente esperando a una persona que no sabe que lo
          // espera. Pasó con las preguntas por el registro sanitario: el
          // modelo las mandaba al supervisor en vez de contestarlas con la
          // respuesta oficial que ya tenía en el contexto.
          //
          // Un fallo técnico es la excepción: ahí el modelo no puede seguir
          // aunque el motivo no encaje en ninguna etiqueta, y la pausa vence
          // sola (ver más abajo).
          const motivoValido = motivoDerivacionValido(motivoCrudo);
          // El comprobante de pago ya no se deriva: la IA lo lee y se lo
          // confirma al cliente. Y derivar ahí es lo peor que puede pasar,
          // porque en provincia el pago llega ANTES de los datos de envío:
          // apagar el bot deja el pedido sin dirección y sin quién la pida.
          // Por eso lleva instrucción propia y no el rechazo genérico, que
          // ante una captura de Yape no le dice al modelo qué hacer.
          if (
            !motivoValido &&
            !huboFalloTecnico &&
            esMotivoDeComprobante(motivoCrudo)
          ) {
            this.logger.log(
              `Lead: conv ${conversacionId} NO derivada por comprobante de pago; sigue atendiendo.`,
            );
            return {
              derivado: false,
              instruccion:
                'El comprobante de pago no se deriva: ya lo recibiste y lo tienes leído en el mensaje del cliente. ' +
                'Confírmale lo que llegó (monto y número de operación) y SIGUE con el pedido: lo que falta son los datos de envío. ' +
                'Pídeselos tú, de uno en uno, y no los completes por tu cuenta. No le digas que lo pasaste con nadie.',
            };
          }
          if (!motivoValido && !huboFalloTecnico) {
            this.logger.log(
              `Lead: conv ${conversacionId} NO derivada, motivo fuera de lista ("${motivoCrudo}").`,
            );
            return {
              derivado: false,
              instruccion:
                'Eso no se deriva: respóndelo tú con la información del negocio que ya tienes. ' +
                'Si te falta un dato puntual, di lo que sí puedes confirmar, ofrece conseguir el resto y sigue atendiendo. ' +
                'No le digas al cliente que lo pasaste con nadie.',
            };
          }
          const motivo =
            motivoValido ?? (motivoCrudo.trim() || 'sin motivo');
          // Dos derivaciones distintas, dos pausas distintas:
          //
          // - El cliente necesita a una persona (mayorista, reclamo, "quiero
          //   hablar con alguien"): pausa SIN vencimiento. Hay alguien a
          //   cargo y la IA no puede volver sola a meterse en medio.
          // - Algo se rompió y el modelo derivó por eso: pausa que VENCE. El
          //   cliente no pidió un humano, y dejar el bot apagado para siempre
          //   por un error pasajero deja a esa persona sin atención. Pasó de
          //   verdad: un fallo al registrar el pedido mató la conversación.
          const pausadoHasta = huboFalloTecnico ? venceEn() : null;
          const pausa = {
            botActivo: false,
            pausadoHasta,
            motivoPausa: huboFalloTecnico
              ? `fallo del sistema (${motivo})`
              : motivo,
          };
          // La pausa que manda es la de la conversación —es la que mira el
          // processor—; la del prospecto se mantiene al día porque es la que
          // pinta "IA en pausa" en el embudo.
          await this.prisma.$transaction([
            this.prisma.leadConversacion.update({
              where: { id: conversacionId },
              data: pausa,
            }),
            this.prisma.leadProspecto.updateMany({
              where: { conversacionId },
              data: pausa,
            }),
          ]);
          await this.notificaciones
            .notificarAdminsEmpresa({
              empresaId,
              tipo: 'WARNING',
              titulo: `🙋 Un cliente necesita a una persona (${motivo})`,
              mensaje: `${detalle || 'Sin detalle.'}\n\nWhatsApp: ${telefono}`,
              metaData: { origen: 'ia-ventas-derivacion', motivo, telefono },
            })
            .catch(() => undefined);
          // Aviso por WhatsApp a quien atiende. La notificación in-app sola
          // no alcanza: desde acá la IA deja de responder, y si nadie mira el
          // panel el cliente se queda esperando a alguien que no sabe que lo
          // espera.
          const conv = await this.prisma.leadConversacion.findUnique({
            where: { id: conversacionId },
            select: { nombreProspecto: true },
          });
          const cfg = await this.pedido.configDe(empresaId);
          await this.alerta
            .avisarDerivacion({
              empresaId,
              telefonoProspecto: telefono,
              nombreProspecto: conv?.nombreProspecto ?? null,
              motivo,
              detalle,
              supervisorTelefono: cfg.supervisorTelefono ?? null,
            })
            .catch((e) =>
              this.logger.warn(
                `Aviso de derivación de la conv ${conversacionId} falló: ${e?.message}`,
              ),
            );
          this.logger.log(
            `Lead: conv ${conversacionId} derivada a un humano (${motivo}).`,
          );
          return {
            derivado: true,
            instruccion:
              'Avísale al cliente que ya informaste a un asesor y que se comunicará con él. Sin preguntas y una sola vez: a partir de aquí no vuelvas a responder.',
          };
        }

        case HERRAMIENTA_AVISAR_RIESGO: {
          const riesgo = String(argumentos.riesgo ?? '').trim();
          const recomendado =
            typeof argumentos.recomendado === 'string'
              ? argumentos.recomendado
              : '';
          const instruccion =
            'Sigue atendiendo normal. Después de recomendar, dile con naturalidad que lo consulte con su médico y que no deje su tratamiento actual hasta que su médico lo indique. No le digas que avisaste a nadie.';
          // Una vez por conversación: el aviso es para que alguien lo siga, y
          // repetirlo en cada mensaje solo llena el celular del supervisor.
          const previos = await this.prisma.leadMensaje.findMany({
            where: {
              conversacionId,
              rol: 'ASISTENTE',
              herramientasJson: { not: Prisma.DbNull },
            },
            select: { herramientasJson: true },
          });
          const yaAvisado = previos.some((m) =>
            (Array.isArray(m.herramientasJson) ? m.herramientasJson : []).some(
              (ll: any) =>
                ll?.nombre === HERRAMIENTA_AVISAR_RIESGO &&
                (ll?.resultado as { avisado?: boolean })?.avisado,
            ),
          );
          if (yaAvisado) return { avisado: true, yaEstaba: true, instruccion };

          await this.notificaciones
            .notificarAdminsEmpresa({
              empresaId,
              tipo: 'WARNING',
              titulo: '⚠️ Cliente de alto riesgo: hacer seguimiento',
              mensaje: `${riesgo || 'Sin detalle.'}${recomendado ? `\nSe le recomendó: ${recomendado}` : ''}\n\nWhatsApp: ${telefono}`,
              metaData: { origen: 'ia-ventas-alto-riesgo', telefono },
            })
            .catch(() => undefined);
          const conv = await this.prisma.leadConversacion.findUnique({
            where: { id: conversacionId },
            select: { nombreProspecto: true },
          });
          const cfg = await this.pedido.configDe(empresaId);
          await this.alerta
            .avisarAltoRiesgo({
              empresaId,
              telefonoProspecto: telefono,
              nombreProspecto: conv?.nombreProspecto ?? null,
              motivo: riesgo || 'sin detalle',
              detalle: recomendado,
              supervisorTelefono: cfg.supervisorTelefono ?? null,
            })
            .catch((e) =>
              this.logger.warn(
                `Aviso de alto riesgo de la conv ${conversacionId} falló: ${e?.message}`,
              ),
            );
          this.logger.log(
            `Lead: conv ${conversacionId} marcada de alto riesgo; la IA sigue atendiendo.`,
          );
          return { avisado: true, instruccion };
        }

        case HERRAMIENTA_AGENDAR_RECORDATORIO: {
          // "En una semana", "a fin de mes": se le escribe ese día a las 10
          // de la mañana de Lima. Pedido de Hierba Sana (19-10).
          const fecha = String(argumentos.fecha ?? '').trim();
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
          if (!m) {
            return { agendado: false, error: 'La fecha tiene que ir como AAAA-MM-DD.' };
          }
          const mediodia = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 17));
          const cuando = aLaHoraEnLima(mediodia, 10);
          const ahora = Date.now();
          if (cuando.getTime() < ahora + 3600_000 || cuando.getTime() > ahora + 125 * 864e5) {
            return {
              agendado: false,
              error: 'La fecha tiene que estar entre mañana y 4 meses desde hoy.',
            };
          }
          const r = await this.disparadores.programar({
            empresaId,
            tipo: TipoDisparo.RECORDATORIO_ACORDADO,
            telefono,
            referencia: `conversacion:${conversacionId}:${fecha}`,
            programadoPara: cuando,
            conversacionId,
          });
          if (!r.programado) {
            return {
              agendado: false,
              motivo: r.motivo,
              instruccion:
                'No le prometas que le escribirás en esa fecha: dile que puede escribirnos cuando quiera y aquí lo atendemos.',
            };
          }
          // Dio una fecha: el "carrito en espera" de mañana ya no va (Edwing:
          // se le escribe en la fecha que dijo, no al día siguiente).
          await this.disparadores
            .cancelar(
              empresaId,
              telefono,
              [TipoDisparo.CARRITO_EN_ESPERA],
              'El cliente dio una fecha para retomar',
            )
            .catch(() => undefined);
          return { agendado: true, fecha };
        }

        case HERRAMIENTA_REGISTRAR_PEDIDO: {
          const res = await this.pedido.registrarPedido(
            empresaId,
            conversacionId,
            telefono,
          );
          // Un "ya estaba registrado" no es un fallo del sistema: es la
          // idempotencia haciendo su trabajo.
          if (res?.error && !/ya estaba registrado/i.test(res.error)) {
            huboFalloTecnico = true;
          }
          // Compró antes de la fecha que había dicho: el recordatorio ya no va.
          if (res && 'pedido' in res && (res as { pedido?: string }).pedido) {
            await this.disparadores
              .cancelar(
                empresaId,
                telefono,
                [TipoDisparo.RECORDATORIO_ACORDADO],
                'El cliente ya hizo su pedido',
              )
              .catch(() => undefined);
          }
          return res;
        }

        case HERRAMIENTA_AVISAR_VISITA: {
          const res = await this.pedido.avisarVisitaTienda(
            empresaId,
            conversacionId,
            telefono,
            String(argumentos.cuando ?? ''),
          );
          // Avisar la visita no es una venta cerrada, pero sí es el final del
          // camino de un recojo: el cliente ya decidió. Se marca la etapa
          // para que el embudo no lo deje como una cotización olvidada.
          if (res?.pedido) {
            await this.disparadores
              .cancelar(
                empresaId,
                telefono,
                [TipoDisparo.RECORDATORIO_ACORDADO],
                'El cliente ya hizo su pedido',
              )
              .catch(() => undefined);
          }
          if (res?.avisado && !res.yaAvisado) {
            await this.marcarEtapa(
              empresaId,
              conversacionId,
              EtapaCrm.DATOS_COMPLETOS,
              'Pasa por la tienda a recoger',
            );
          }
          // Un fallo acá NO deriva: el cliente igual va a ir a la tienda, y
          // apagar el bot lo dejaría sin a quién preguntarle.
          return res;
        }

        case HERRAMIENTA_CANCELAR_PEDIDO:
          return this.pedido.cancelarPedido(
            empresaId,
            conversacionId,
            String(argumentos.motivo ?? ''),
          );

        default:
          return { error: `Herramienta desconocida: ${nombre}` };
      }
    };
  }

  /**
   * Cómo se le describe la disponibilidad al modelo: nunca con un número de
   * stock. Para un negocio que no lleva inventario ese número es ficticio, y
   * decirle al cliente "quedan 50" es prometer algo que no se sabe.
   */
  private textoDisponibilidad(producto: {
    disponibilidad?: DisponibilidadProducto | null;
    stock?: unknown;
  }): string {
    return textoParaElCliente(disponibilidadEfectiva(producto));
  }

  /**
   * Si lo que el cliente pidió está agotado, queda anotado para avisarle
   * cuando vuelva (la lista de espera sale de LeadConsulta).
   *
   * Antes solo se anotaba dentro de `buscar_productos`. El 19-10 el modelo
   * contestó "Purificador de sangre: agotado... te aviso apenas llegue" con
   * el adelanto de productos del prompt, sin llamar a la herramienta, y nadie
   * quedó anotado: la promesa no tenía respaldo. Una vez por producto y
   * conversación, para no inflar el reporte de no habidos.
   */
  /** El pedido en curso para este turno; si no se puede leer, se sigue sin él. */
  private async estadoDelPedido(conversacionId: number) {
    try {
      return (await this.pedido.estadoParaElTurno(conversacionId)) ?? null;
    } catch {
      return null;
    }
  }

  private async anotarEnListaDeEspera(
    empresaId: number,
    conversacionId: number,
    telefono: string,
    texto: string,
    producto:
      | { id: number; disponibilidad?: DisponibilidadProducto | null; stock?: unknown }
      | undefined,
  ): Promise<void> {
    if (!producto) return;
    const disponibilidad = disponibilidadEfectiva(producto);
    if (disponibilidad === 'INMEDIATA') return;
    try {
      const ya = await this.prisma.leadConsulta.count({
        where: { empresaId, conversacionId, productoId: producto.id },
      });
      if (ya) return;
    } catch {
      // Sin poder comprobarlo, se anota igual: una fila de más en el reporte
      // cuesta menos que un cliente al que nadie le avisa.
    }
    await this.consultas.registrar(empresaId, conversacionId, telefono, [
      {
        texto: texto.slice(0, 120),
        hubo: false,
        productoId: producto.id,
        disponibilidad,
      },
    ]);
  }

  private async buscarProductosRelevantes(
    empresaId: number,
    texto: string,
  ): Promise<{
    contexto: string;
    productos: {
      id: number;
      descripcion: string;
      precioUnitario: any;
      stock: any;
      disponibilidad?: DisponibilidadProducto | null;
      moneda: string;
      imagenUrl: string | null;
    }[];
  }> {
    const productos = await this.consultarCatalogo(empresaId, texto);
    if (productos.length === 0) return { contexto: '', productos: [] };

    const lineas = productos.map((p) => {
      const simbolo = p.moneda === 'USD' ? 'US$' : 'S/';
      const precio = `${simbolo}${Number(p.precioUnitario).toFixed(2)}`;
      return `- ${p.descripcion}: ${precio} (${this.textoDisponibilidad(p)})`;
    });
    const contexto =
      'PRODUCTOS QUE COINCIDEN A PRIMERA VISTA con el último mensaje (precio y ' +
      'disponibilidad reales del negocio). Son un adelanto, no el catálogo entero: ' +
      `si necesitas otros, o el cliente pregunta por algo que no está aquí, llama a ${HERRAMIENTA_BUSCAR_PRODUCTOS}. ` +
      'Nunca inventes productos ni precios:\n' +
      lineas.join('\n');
    return { contexto, productos };
  }

  /**
   * Consulta el catálogo real del negocio por tokens del texto. Es la fuente
   * única de productos: la usan tanto el adelanto que se inyecta al prompt como
   * la herramienta `buscar_productos`.
   *
   * B4 la convierte en cascada (tokens → trigram → RAG); por ahora es el
   * AND de palabras de siempre.
   */
  private async consultarCatalogo(
    empresaId: number,
    texto: string,
    categoria?: string,
  ): Promise<
    {
      id: number;
      descripcion: string;
      precioUnitario: any;
      stock: any;
      moneda: string;
      imagenUrl: string | null;
      disponibilidad: DisponibilidadProducto | null;
      prioridadVenta: number | null;
    }[]
  > {
    const tokens = (texto || '')
      .toLowerCase()
      .replace(/[¿?¡!.,;:()]/g, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 3 && !LeadsMessageProcessor.STOPWORDS_PRODUCTO.has(w),
      )
      .slice(0, 5);
    if (tokens.length === 0) return [];

    let productos = await this.prisma.producto.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO' as any,
        ...(categoria
          ? {
              categoria: {
                nombre: { contains: categoria, mode: 'insensitive' as any },
              },
            }
          : {}),
        AND: tokens.map((tk) => ({
          OR: [
            { descripcion: { contains: tk, mode: 'insensitive' as any } },
            { codigo: { contains: tk, mode: 'insensitive' as any } },
            { codigoBarras: { contains: tk, mode: 'insensitive' as any } },
            {
              categoria: {
                nombre: { contains: tk, mode: 'insensitive' as any },
              },
            },
            { marca: { nombre: { contains: tk, mode: 'insensitive' as any } } },
          ],
        })),
      },
      select: {
        id: true,
        descripcion: true,
        precioUnitario: true,
        stock: true,
        moneda: true,
        imagenUrl: true,
        disponibilidad: true,
        prioridadVenta: true,
      },
      // Primero lo que el negocio quiere empujar; entre iguales, lo que tiene
      // más stock.
      orderBy: [
        { prioridadVenta: { sort: 'desc', nulls: 'last' } },
        { stock: 'desc' },
      ],
      take: 8,
    });

    // Nada por palabras: puede ser una falta de ortografía ("fenocreco" por
    // "Fenogreco"). El cliente no va a reescribirlo — se va. Los trigramas sí
    // lo encuentran, y siguen siendo SQL: no cuestan una llamada a la IA.
    if (productos.length === 0) {
      productos = await this.buscarPorParecido(empresaId, texto, categoria);
    }

    // Y entre todos, lo que se puede entregar ya va antes de lo que hay que
    // encargar. Se ordena aquí y no en la consulta porque la disponibilidad
    // puede venir del stock cuando nadie la fijó.
    const rango: Record<DisponibilidadProducto, number> = {
      INMEDIATA: 0,
      BAJO_PEDIDO: 1,
      NO_DISPONIBLE: 2,
      // Lo descontinuado va último: no va a volver, así que es lo que menos
      // sentido tiene mostrarle a alguien que quiere comprar hoy.
      NO_COMERCIAL: 3,
    };
    return productos.sort(
      (a, b) =>
        rango[disponibilidadEfectiva(a)] - rango[disponibilidadEfectiva(b)],
    );
  }

  // ¿El mensaje pide el brochure/catálogo o más información?
  private quiereBrochure(texto: string): boolean {
    return /\b(brochure|folleto|cat[aá]logo|pdf|presentaci[oó]n|m[aá]s info|mas info|m[aá]s informaci[oó]n|mas informaci[oó]n|m[aá]s detalles|mas detalles|inform[aá]ci[oó]n completa|mandame info|m[aá]ndame info|env[ií]ame|cu[eé]ntame m[aá]s)\b/i.test(
      texto || '',
    );
  }

  /** Crea/actualiza el LeadProspecto con la calificación y alerta si es caliente. */
  private async aplicarCalificacion(
    empresa: {
      id: number;
      nombreComercial: string | null;
      razonSocial: string;
      iaVentasCotizacion?: boolean;
    },
    conversacionId: number,
    quien: { telefono: string; nombre: string | null },
    cal: CalificacionBant,
    historial: MensajeConversacion[],
  ): Promise<void> {
    // El propio negocio probando su bot no se califica ni se alerta. Sin esto
    // el upsert de abajo volvería a crear el prospecto que `ingresar` no creó
    // —la guarda del embudo duraría hasta la primera calificación— y además
    // el dueño recibiría una alerta de "lead caliente" por sí mismo.
    if (await this.esDeLaEmpresa(empresa.id, quien.telefono)) {
      this.logger.log(
        `Lead: conv ${conversacionId} es del propio negocio; no se califica ni entra al embudo.`,
      );
      return;
    }

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
        telefonoProspecto: quien.telefono,
        nombreProspecto: quien.nombre,
        conversacionId,
        ...data,
      },
      update: data,
      select: { id: true, notificadoEn: true },
    });

    // Alerta de lead CALIENTE al vendedor (una sola vez, reusa notificaciones de MYPE).
    if (cal.debeTransferir && !prospecto.notificadoEn) {
      const nombre = quien.nombre || quien.telefono;

      // Cotización automática (opt-in): si el prospecto confirmó productos +
      // cantidades, la IA arma un borrador COT (sin stock/caja/SUNAT). Best-effort.
      let cotizacion: {
        serie: string;
        correlativo: number;
        id: number;
      } | null = null;
      if (empresa.iaVentasCotizacion) {
        cotizacion = await this.intentarCrearCotizacion(
          empresa.id,
          nombre,
          quien.telefono,
          historial,
        );
        if (cotizacion) {
          await this.prisma.leadProspecto.update({
            where: { id: prospecto.id },
            data: { cotizacionId: cotizacion.id },
          });
        }
      }

      await this.notificaciones.notificarAdminsEmpresa({
        empresaId: empresa.id,
        tipo: 'INFO',
        titulo: `🔥 Lead caliente: ${nombre}`,
        mensaje: `${cal.resumen}\n\nAcción sugerida: ${cal.proximaAccion}`,
        metaData: {
          origen: 'ia-ventas',
          prospectoId: prospecto.id,
          telefono: quien.telefono,
          puntaje: cal.score.total,
        },
      });
      // Alerta multicanal (correo + WhatsApp al vendedor), best-effort.
      await this.alerta.alertarLeadCaliente({
        empresaId: empresa.id,
        empresaNombre: empresa.nombreComercial || empresa.razonSocial,
        prospectoId: prospecto.id,
        nombreProspecto: nombre,
        telefonoProspecto: quien.telefono,
        cal,
        cotizacion: cotizacion
          ? {
              codigo: `${cotizacion.serie}-${String(cotizacion.correlativo).padStart(8, '0')}`,
            }
          : null,
      });

      await this.prisma.leadProspecto.update({
        where: { id: prospecto.id },
        data: { notificadoEn: new Date() },
      });
    }
  }

  /**
   * Arma un borrador de cotización (COT) desde el chat: extrae los productos +
   * cantidades que el prospecto confirmó y crea el comprobante COT (sin tocar
   * stock, caja ni SUNAT; el precio sale del catálogo en vivo). Best-effort:
   * ante cualquier fallo devuelve null y no interrumpe el flujo del mensaje.
   */
  private async intentarCrearCotizacion(
    empresaId: number,
    nombreProspecto: string,
    telefono: string,
    historial: MensajeConversacion[],
  ): Promise<{ serie: string; correlativo: number; id: number } | null> {
    try {
      // Candidatos: productos mencionados a lo largo de todo el chat.
      const textoUsuario = historial
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join(' ');
      const relevantes = await this.buscarProductosRelevantes(
        empresaId,
        textoUsuario,
      );
      if (relevantes.productos.length === 0) return null;

      const catalogo = relevantes.productos.map((p) => ({
        id: p.id,
        descripcion: p.descripcion,
        precioUnitario: Number(p.precioUnitario),
      }));
      const items = await this.ia.extraerItemsPedido(historial, catalogo);
      if (items.length === 0) return null;

      // Solo { productoId, cantidad }: el precio lo toma crearInformal del
      // catálogo en vivo (prod.precioUnitario), evitando desalineaciones.
      const detalles = items.map((it) => ({
        productoId: it.id,
        cantidad: it.cantidad,
      }));

      const infoCliente = `${nombreProspecto} (WhatsApp ${telefono})`;
      const input = {
        tipoDoc: 'COT',
        fechaEmision: new Date().toISOString(),
        formaPagoTipo: 'CONTADO',
        formaPagoMoneda: 'PEN',
        tipoMoneda: 'PEN',
        clienteName: 'CLIENTES VARIOS',
        leyenda: `Cotización generada por IA de Ventas para ${infoCliente}`,
        observaciones: `Prospecto: ${infoCliente}. Borrador automático desde WhatsApp; revísalo y ajústalo antes de enviarlo.`,
        detalles,
      };

      const comp = (await this.comprobante.crearInformal(input, empresaId)) as {
        id?: number;
        serie?: string;
        correlativo?: number;
      };
      if (comp?.id && comp.serie != null && comp.correlativo != null) {
        this.logger.log(
          `IA cotización COT ${comp.serie}-${comp.correlativo} creada (empresa ${empresaId}, ${items.length} ítems).`,
        );
        return {
          serie: comp.serie,
          correlativo: comp.correlativo,
          id: comp.id,
        };
      }
      return null;
    } catch (e) {
      this.logger.warn(
        `IA cotización: no se pudo crear (${e instanceof Error ? e.message : String(e)}).`,
      );
      return null;
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
