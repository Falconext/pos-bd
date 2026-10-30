import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { comentarioCalza } from '../instagram/instagram-webhook';
import { MensajeriaService } from './mensajeria.service';
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
import { LeadsPagoLinkService } from './leads-pago-link.service';
import { LeadsVisitaService } from './leads-visita.service';
import { EjecutorHerramienta } from '../gemini/gemini.service';
import {
  HERRAMIENTA_AVISAR_VISITA,
  HERRAMIENTA_AGENDAR_VISITA,
  HERRAMIENTA_CANCELAR_PEDIDO,
  HERRAMIENTA_DAR_DEMO,
  HERRAMIENTA_LINK_PAGO,
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
import { WEB_CUENTA_COMO_LEAD } from './chat-web';
import { conDescargoLegal } from './prompt-asesor';
import { JOB_ECO_VENDEDOR, type EcoVendedor } from './eco-vendedor';
import { origenDeAnuncio, type ReferralWhatsapp } from './anuncio-origen';
import {
  afirmaCancelacion,
  afirmaDerivacion,
  sinAvisoInventado,
  sinConfirmacionFalsa,
  sinProductosListosInventado,
  sinPagoInventado,
} from './confirmacion-falsa';
import { conRegistroDirecto, yaAceptoAntes } from './registro-directo';
import { bloqueDerivacion, conMotivosDelNegocio } from './derivar-en';
import {
  HERRAMIENTA_MENU,
  type ConfigMenuInicial,
  bloqueRespuestasMenu,
  detalleParaElAsesor,
  estadoDelMenu,
  mensajeDelPaso,
  menuValido,
  opcionElegida,
  pasoDelMensaje,
  respuestasDelMenu,
  textoConOpciones,
} from './menu-inicial';
import {
  BLOQUE_DATOS_DEMO,
  conAccesosDemo,
  consultarRuc,
  elegirDemo,
  faltanParaDemo,
  leerRuc,
  type DatosDemo,
} from './demos';
import { conCotizacionExacta } from './cotizacion-exacta';
import { precioNoPedido, sinPrecioNoPedido, tieneMonto } from './precio-no-pedido';
import { conBloqueDeDatosExacto } from './datos-en-bloque';
import { conIndicacionMedica, esAltoRiesgo, PROHIBIDO_AVISOS_MEDICOS, sinMencionesMedicas } from './alto-riesgo';
import { avisoVoucher, extraerTitular } from './voucher-verificacion';
import {
  ArchivoDelCliente,
  MAX_ARCHIVO_IA_BYTES,
  contenidoConLectura,
  esArchivoLegible,
  textoDelCliente,
} from './archivo-del-cliente';
import { conNombreBienEscrito } from './nombre-negocio';
import { enFormatoWhatsapp } from './formato-whatsapp';
import { fechaMencionada } from './fecha-mencionada';
import { ajustarPuntaje, rangoTemperatura, type HechosLead } from './temperatura-por-hechos';
import { pistaDireccion } from './pregunta-direccion';
import { contextoHistorialCliente, contextoPedidosDelCliente, esLineaDeEnvio } from './pedidos-del-cliente';
import { conversacionDelMismoCliente, esTelefono } from './unir-usuario-whatsapp';
import { quienReparte, saldoParaRetirar } from '../envio-despacho/recojo-agencia';
import { formasDePagoParaElAviso } from '../envio-despacho/pago-repartidor';

/** Frases de "retomo después" que acompañan a una fecha. */
const POSPONE =
  /\b(te escribo|te aviso|te confirmo|te hablo|cobro|cobre|me pagan|regreso|vuelvo|lo compro|lo pido|ahi compro|ahi te)\b/i;
import { esNumeroInterno, numerosInternos } from './numeros-internos';
import { bloqueComercial } from './tarifas-y-descuentos';
import { bloqueTienda } from './visita-tienda';
import {
  type ConfigComercial,
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
import { pideBrochure } from './brochure';
import {
  disponibilidadEfectiva,
  nivelDeRecomendacion,
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
  estadoDesdeScore,
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
  /** Por qué red llegó. Sin valor es WhatsApp (los jobs de antes no lo traen). */
  canal?: 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER' | 'WEB';
  /** Chat de la tienda online: la empresa ya viene resuelta por el slug. */
  empresaId?: number;
  /** Chat de la tienda: qué estaba mirando el cliente al escribir. */
  contexto?: string;
  /** WhatsApp: el número de la empresa que recibió el mensaje. */
  phoneNumberId?: string;
  /** Instagram: la cuenta profesional que recibió el mensaje. */
  instagramAccountId?: string;
  /** Messenger: la página de Facebook que recibió el mensaje. */
  facebookPageId?: string;
  /** Instagram: vino de un comentario en una publicación (ver instagram-webhook.ts). */
  comentarioId?: string;
  comentarioTexto?: string;
  from: string;
  /** BSUID del remitente ("PE.…"), si Meta lo manda. */
  bsuid?: string;
  messageId: string;
  text: string;
  esAudio: boolean;
  esImagen?: boolean;
  esDocumento?: boolean;
  mediaId?: string;
  nombre?: string;
  timestamp?: string;
  referral?: ReferralWhatsapp;
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
    private readonly whatsapp: MensajeriaService,
    private readonly notificaciones: NotificacionesService,
    private readonly alerta: LeadsAlertaService,
    private readonly comprobante: ComprobanteService,
    private readonly pedido: LeadsPedidoService,
    private readonly embudo: LeadsEmbudoService,
    private readonly consultas: LeadsConsultasService,
    private readonly disparadores: LeadsDisparadoresService,
    @InjectQueue(LEADS_MESSAGES_QUEUE) private readonly queue: Queue,
    // Al final y opcional: los specs arman el procesador con los argumentos
    // en orden, y sin esto el link de pago simplemente no está.
    @Optional() private readonly pagoLink?: LeadsPagoLinkService,
    @Optional() private readonly visitas?: LeadsVisitaService,
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
    if (job.name === JOB_ECO_VENDEDOR) {
      return this.registrarEcoVendedor(job.data as unknown as EcoVendedor);
    }
    return this.ingresar(job.data as MensajeEntrante);
  }

  /**
   * Empresa dueña de un número de WhatsApp. Primero entre sus números
   * (NumeroWhatsapp, varios por empresa) y, si no está ahí, el campo de siempre.
   */
  private async empresaDelNumero(phoneNumberId?: string) {
    if (!phoneNumberId) return null;
    const numero = await this.prisma.numeroWhatsapp.findUnique({
      where: { phoneNumberId },
      select: { iaActiva: true, empresa: { select: { id: true, iaVentasActiva: true } } },
    });
    if (numero) return { ...numero.empresa, iaActivaEnNumero: numero.iaActiva };
    return this.prisma.empresa.findFirst({
      where: { whatsappPhoneNumberId: phoneNumberId },
      select: { id: true, iaVentasActiva: true },
    });
  }

  /**
   * El dueño contestó desde la app WhatsApp Business de su celular
   * (coexistencia, ver eco-vendedor.ts): se guarda como respuesta del vendedor
   * y la IA se calla en ese chat, igual que cuando responde desde el panel.
   */
  private async registrarEcoVendedor(e: EcoVendedor): Promise<void> {
    const empresa = await this.empresaDelNumero(e.phoneNumberId);
    if (!empresa) return;

    const ya = await this.prisma.leadMensaje.findUnique({
      where: { whatsappMsgId: e.messageId },
      select: { id: true },
    });
    if (ya) return;

    // Si el dueño le escribe primero a alguien, la conversación nace acá y
    // nace pausada: cuando esa persona conteste, la IA no se mete en un chat
    // que empezó el dueño.
    const conv = await this.prisma.leadConversacion.upsert({
      where: { empresaId_telefonoProspecto: { empresaId: empresa.id, telefonoProspecto: e.to } },
      create: {
        empresaId: empresa.id,
        telefonoProspecto: e.to,
        numeroWhatsappId: e.phoneNumberId,
        canal: 'WHATSAPP',
        cantidadMensajes: 0,
      },
      update: {},
      select: {
        id: true,
        botActivo: true,
        pausadoHasta: true,
        prospecto: { select: { id: true } },
      },
    });

    // Red de seguridad: Meta dice que lo que mandamos por la API no vuelve
    // como eco, pero si alguna vez volviera, la IA se pausaría a sí misma.
    if (e.texto) {
      const propio = await this.prisma.leadMensaje.findFirst({
        where: {
          conversacionId: conv.id,
          rol: 'ASISTENTE',
          contenido: e.texto,
          creadoEn: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (propio) return;
    }

    try {
      await this.prisma.leadMensaje.create({
        data: {
          conversacionId: conv.id,
          rol: 'SISTEMA',
          contenido: e.texto || '[Mensaje]',
          whatsappMsgId: e.messageId,
        },
      });
    } catch (err) {
      if (esCodigoPrisma(err, 'P2002')) return; // otra entrega del mismo eco
      throw err;
    }

    // Pausa temporal, y se alarga mientras el dueño siga escribiendo. Una
    // pausa sin vencimiento (derivación o IA apagada a mano) no se toca.
    const pausaDefinitiva = !conv.botActivo && !conv.pausadoHasta;
    const data = pausaDefinitiva
      ? {}
      : { botActivo: false, pausadoHasta: venceEn(), motivoPausa: 'respondió desde el celular' };
    await this.prisma.$transaction([
      this.prisma.leadConversacion.update({
        where: { id: conv.id },
        data: { ...data, cantidadMensajes: { increment: 1 } },
      }),
      ...(conv.prospecto && !pausaDefinitiva
        ? [this.prisma.leadProspecto.update({ where: { id: conv.prospecto.id }, data })]
        : []),
    ]);
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
    const esInstagram = d.canal === 'INSTAGRAM';
    const esMessenger = d.canal === 'MESSENGER';
    const esWeb = d.canal === 'WEB';
    const canal = esInstagram ? 'INSTAGRAM' : esMessenger ? 'MESSENGER' : esWeb ? 'WEB' : 'WHATSAPP';
    // 1) ¿Qué empresa tiene conectado este número (o esta cuenta/página)?
    const empresa = esWeb
      ? await this.prisma.empresa.findUnique({
          where: { id: d.empresaId ?? 0 },
          select: { id: true, iaVentasActiva: true },
        })
      : esInstagram
      ? await this.prisma.empresa.findFirst({
          where: { instagramAccountId: d.instagramAccountId, instagramActivo: true },
          select: { id: true, iaVentasActiva: true, instagramComentarios: true, instagramComentariosClave: true },
        })
      : esMessenger
        ? await this.prisma.empresa.findFirst({
            where: { facebookPageId: d.facebookPageId, facebookActivo: true },
            select: { id: true, iaVentasActiva: true },
          })
        : await this.empresaDelNumero(d.phoneNumberId);
    if (!empresa) {
      this.logger.warn(
        esInstagram
          ? `Mensaje de Instagram de ${d.from} para la cuenta ${d.instagramAccountId} sin empresa conectada; se ignora.`
          : esMessenger
            ? `Mensaje de Messenger de ${d.from} para la página ${d.facebookPageId} sin empresa conectada; se ignora.`
            : `Mensaje entrante de ${d.from} para phoneNumberId ${d.phoneNumberId} sin empresa asociada; se ignora.`,
      );
      return;
    }

    // Comentario en una publicación: solo si la empresa lo activó y, si puso
    // palabras clave, solo los que las mencionan. Si no, ni se guarda: un
    // comentario suelto no es una conversación.
    if (d.comentarioId) {
      const e = empresa as { instagramComentarios?: boolean; instagramComentariosClave?: string | null };
      if (!e.instagramComentarios || !comentarioCalza(d.comentarioTexto ?? '', e.instagramComentariosClave)) return;
      // Si ya conversan por DM, la respuesta va por DM como siempre: el
      // comentario entra como un mensaje más.
      const ya = await this.prisma.leadConversacion.findUnique({
        where: { empresaId_telefonoProspecto: { empresaId: empresa.id, telefonoProspecto: d.from } },
        select: { id: true, igComentarioId: true },
      });
      const yaConversan = Boolean(ya && !ya.igComentarioId);
      if (yaConversan) {
        d.comentarioId = undefined;
        d.text = `[El cliente comentó en una publicación de Instagram: "${d.comentarioTexto ?? ''}"]`;
      }
    }

    if (esInstagram || esMessenger) {
      // Ni Instagram ni Messenger mandan el nombre en el webhook: se pide el
      // perfil la primera vez, para que la bandeja muestre un nombre y no un id.
      if (!d.nombre) {
        const ya = await this.prisma.leadConversacion.findUnique({
          where: { empresaId_telefonoProspecto: { empresaId: empresa.id, telefonoProspecto: d.from } },
          select: { nombreProspecto: true },
        });
        if (!ya?.nombreProspecto) {
          if (esInstagram) {
            const p = await this.whatsapp.perfilInstagram(d.from, empresa.id).catch(() => ({} as any));
            d.nombre = p?.nombre || (p?.usuario ? `@${p.usuario}` : undefined);
          } else {
            const p = await this.whatsapp.perfilMessenger(d.from, empresa.id).catch(() => ({} as any));
            d.nombre = p?.nombre || undefined;
          }
        }
      }
    } else if (!esWeb) {
      // 2) Si el cliente escribía con su @usuario y ahora llega con número, es
      // la misma conversación (ver unir-usuario-whatsapp.ts).
      await this.unirConversacionSinNumero(empresa.id, d).catch((e) =>
        this.logger.warn(`Lead: no se pudo unir la conversación de ${d.from}: ${e?.message}`),
      );
    }

    // Upsert de la conversación (una por prospecto/empresa).
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
        numeroWhatsappId: d.phoneNumberId ?? null,
        canal,
        cantidadMensajes: 0,
        igComentarioId: d.comentarioId ?? null,
      },
      // El cliente escribió → reinicia el contador de seguimientos (silencio nuevo).
      update: {
        seguimientos: 0,
        ...(d.nombre ? { nombreProspecto: d.nombre } : {}),
        // Con varios números, se le contesta por el último al que escribió.
        ...(d.phoneNumberId ? { numeroWhatsappId: d.phoneNumberId } : {}),
        // Un comentario nuevo abre una nueva respuesta privada; un DM cierra
        // el modo comentario: ya se le puede escribir normal.
        ...(d.comentarioId
          ? { igComentarioId: d.comentarioId, igComentarioRespondido: false }
          : esInstagram
            ? { igComentarioId: null, igComentarioRespondido: false }
            : {}),
      },
      select: { id: true, estado: true },
    });

    // De qué anuncio vino. Antes de todo lo demás y sin frenar nada: que no
    // se pueda guardar la etiqueta no es motivo para no atender al cliente.
    await this.guardarOrigenDeAnuncio(empresa.id, conv.id, d).catch((e) =>
      this.logger.warn(`Lead: no se guardó el anuncio de ${d.messageId}: ${e?.message}`),
    );

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
    // En la tienda, lo que estaba mirando va pegado al mensaje: la IA sabe de
    // qué producto habla ("¿tienen en rojo?") y el equipo lo ve en la bandeja.
    let contenido = d.contexto ? `${d.text}\n\n[${d.contexto}]` : d.text;
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
    //
    // Si no es un voucher, la imagen o el PDF se lee igual: el cliente manda
    // la captura de una publicación o la foto de un frasco esperando que le
    // digan el precio, y un PDF puede ser una receta o una lista de pedido.
    // Antes el modelo solo veía "[el cliente envió una imagen]" y tenía que
    // pedirle que escribiera el nombre.
    if (d.esImagen || d.esDocumento) {
      const archivo = await this.bajarArchivo(empresa.id, d);
      // Un PDF puede ser la constancia de una transferencia; un .docx no.
      const puedeSerVoucher =
        d.esImagen || (!!archivo && esArchivoLegible(archivo.mimeType));
      const esVoucher = puedeSerVoucher && await this.registrarVoucherSiCorresponde(
        empresa.id,
        conv.id,
        d,
        userMsgId,
        archivo,
      );
      if (!esVoucher) {
        await this.leerArchivoDelCliente(d, userMsgId, archivo);
      }
    }

    this.logger.log(
      `Lead: mensaje de ${d.from} guardado (empresa ${empresa.id}, conv ${conv.id}).`,
    );

    // Toggle multi-tenant: si la empresa no activó la IA, sólo capturamos el CRM.
    if (!empresa.iaVentasActiva) return;
    // Número donde la IA está apagada (p. ej. la línea que atiende una persona).
    if ((empresa as any).iaActivaEnNumero === false) return;
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
        canal: true,
        numeroWhatsappId: true,
      },
    });
    if (!conv) return false;
    if (conv.numeroWhatsappId) {
      const numero = await this.prisma.numeroWhatsapp.findUnique({
        where: { phoneNumberId: conv.numeroWhatsappId },
        select: { iaActiva: true },
      });
      if (numero && !numero.iaActiva) return false;
    }

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
        conv.id,
        conv.canal,
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
    // Menú de bienvenida: mientras el cliente va tocando opciones, contesta
    // el menú y no la IA (ver menu-inicial.ts).
    if (await this.atenderMenu(empresa.id, conv, mensajes, config)) return true;
    const bloqueMenu = bloqueRespuestasMenu(
      respuestasDelMenu(config.menu ?? menuValido(null), mensajes),
    );
    const comercial = bloqueComercial(config);
    const tiendaFisica = bloqueTienda(config.tienda);
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
      // El prompt base está escrito para WhatsApp. Por Instagram el formato no
      // se ve (los asteriscos quedan a la vista) y no tenemos el celular del
      // cliente: hay que pedírselo para el pedido o la entrega.
      conv.canal === 'INSTAGRAM'
        ? 'CANAL: esta conversación es por mensaje directo de INSTAGRAM, no por WhatsApp. Lo que dicen las reglas sobre WhatsApp vale igual, salvo: no uses asteriscos ni ningún formato (Instagram muestra el texto tal cual) y no tienes el celular del cliente, así que pídeselo cuando haga falta para el pedido o la entrega.'
        : conv.canal === 'MESSENGER'
          ? 'CANAL: esta conversación es por MESSENGER (página de Facebook), no por WhatsApp. Lo que dicen las reglas sobre WhatsApp vale igual, salvo: no uses asteriscos ni ningún formato (Messenger muestra el texto tal cual) y no tienes el celular del cliente, así que pídeselo cuando haga falta para el pedido o la entrega.'
          : conv.canal === 'WEB'
            ? 'CANAL: esta conversación es por el CHAT DE LA TIENDA ONLINE del negocio, no por WhatsApp. El cliente está navegando la tienda ahora mismo; a veces el mensaje trae entre corchetes el producto que está mirando. Lo que dicen las reglas sobre WhatsApp vale igual, salvo: no tienes su celular. Cuando quiera comprar, coordinar el envío o que lo atienda una persona, pídele su celular con WhatsApp para continuar por ahí. Las fotos que envíes le aparecen con un botón para agregar el producto a su carrito: si quiere comprarlo él mismo en la tienda, mándale la foto del producto.'
            : '',
      // Mientras un cliente siga teniendo los números copiados en su texto
      // libre, las dos versiones conviven en el prompt. Por eso el bloque
      // dice de sí mismo que es el que manda.
      comercial,
      tiendaFisica,
      bloqueDerivacion(config.derivarEn),
      config.sinAvisosMedicos ? PROHIBIDO_AVISOS_MEDICOS : '',
    ]
      .filter((s) => s && s.trim())
      .join('\n\n');
    const pedidoEnCurso = await this.estadoDelPedido(conv.id);
    const pedidosDelCliente = await this.pedidosDelCliente(empresa.id, conv.telefonoProspecto);
    const historialCliente = await this.historialDelCliente(empresa.id, conv.id, conv.telefonoProspecto);
    const contextoDelTurno = [
      // La fecha va acá y no en el prompt fijo: cambia cada día y rompería el
      // caché. La necesita la IA para convertir "en una semana" en una fecha.
      `HOY: ${new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} (${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())}).`,
      bloqueMenu,
      this.productosYaMostrados(mensajes),
      // 20-10: el cliente quitó y agregó productos y la cotización no cambió;
      // el modelo no sabía que tenía que volver a cotizar.
      pedidoEnCurso?.cotizado
        ? `PEDIDO YA COTIZADO: ${pedidoEnCurso.cotizado}. Si en este mensaje el cliente agrega, quita o cambia un producto o una cantidad, llama a cotizar con la lista COMPLETA ya actualizada y muéstrale la cotización nueva antes de seguir.`
        : '',
      // 21 y 23-10 (Hierba Sana): "Dirección" a secas se tomaba como que el
      // cliente iba a dar la suya y el bot le pedía sus datos para agendar.
      pistaDireccion(
        contenido,
        [...mensajes].reverse().find((m) => m.rol === 'ASISTENTE')?.contenido,
      ),
      pedidosDelCliente,
      historialCliente,
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
        // Lo que el modelo decide derivar respeta las casillas del negocio;
        // las derivaciones del propio sistema usan `ejecutor` tal cual.
        conMotivosDelNegocio(ejecutor, config.derivarEn),
        {
          nombre: empresa.nombreComercial || empresa.razonSocial,
          rubro: empresa.rubro?.nombre ?? null,
          asesor: config.asesor ?? null,
          perfil: config.vendedor ?? null,
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
    resultado.reply = config.sinAvisosMedicos
      ? resultado.reply
      : conDescargoLegal(
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

    // Una persona tomó el chat mientras la IA pensaba (desde el panel o desde
    // el celular): su respuesta manda y la de la IA ya no se envía.
    const pausaNueva = await this.prisma.leadConversacion.findUnique({
      where: { id: conv.id },
      select: { botActivo: true, pausadoHasta: true },
    });
    if (estaPausado(pausaNueva)) {
      this.logger.log(`Lead: conv ${conv.id} la tomó una persona mientras la IA respondía; no se envía.`);
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
    // Nunca "dejé avisada la tienda" sin el aviso.
    resultado.reply = sinAvisoInventado(
      resultado.reply,
      resultado.llamadas,
      // Si no se puede saber, no se toca la respuesta (como con el voucher).
      await Promise.resolve()
        .then(() => this.prisma.leadVisitaTienda.findUnique({ where: { conversacionId: conv.id }, select: { id: true } }))
        .then((v) => !!v)
        .catch(() => true),
    );
    // Nunca "tus productos ya están separados" sin nota de venta.
    resultado.reply = sinProductosListosInventado(
      resultado.reply,
      !!borradorTrasTurno?.comprobanteId,
    );
    // Nunca "verifiqué tu pago" sin un voucher leído.
    resultado.reply = sinPagoInventado(
      resultado.reply,
      // Si no se puede saber, no se toca la respuesta: el guardia es para lo
      // que se sabe falso, no para lo dudoso.
      await Promise.resolve()
        .then(() => this.pedido.hayVoucherLeido(conv.id))
        .catch(() => true),
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
    // Nunca "alguien del equipo te escribe" sin avisarle a nadie: si el modelo
    // lo prometió y no derivó, se deriva acá (ver `afirmaDerivacion`).
    if (
      !resultado.llamadas.some((ll) => ll.nombre === HERRAMIENTA_DERIVAR) &&
      afirmaDerivacion(resultado.reply, config.vendedor?.mensajeDerivacion)
    ) {
      const argumentos = {
        motivo: 'pide_hablar_con_persona',
        detalle: `La IA le dijo al cliente que una persona lo contactará. Lo último que escribió: "${contenido.slice(0, 300)}"`,
      };
      resultado.llamadas.push({
        nombre: HERRAMIENTA_DERIVAR,
        argumentos,
        resultado: await ejecutor(HERRAMIENTA_DERIVAR, argumentos),
      });
    }
    resultado.reply = conCotizacionExacta(resultado.reply, resultado.llamadas);
    // Nunca un precio que el cliente no pidió (opcional por empresa).
    const delCliente = historial.filter((m) => m.role === 'user').map((m) => m.content);
    if (config.precioSoloSiPregunta && precioNoPedido(resultado.reply, delCliente)) {
      const reescrita = await this.ia.reescribirSinPrecio(resultado.reply).catch(() => '');
      resultado.reply =
        reescrita && !tieneMonto(reescrita)
          ? reescrita
          : sinPrecioNoPedido(resultado.reply, delCliente);
    }
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

    // Los accesos a la demo van completos aunque el modelo los resuma.
    const demoEntregada = [...resultado.llamadas]
      .reverse()
      .find(
        (ll) =>
          ll.nombre === HERRAMIENTA_DAR_DEMO &&
          (ll.resultado as { acceso?: unknown } | null)?.acceso,
      );
    if (demoEntregada) {
      resultado.reply = conAccesosDemo(
        resultado.reply,
        (demoEntregada.resultado as { acceso: Parameters<typeof conAccesosDemo>[1] }).acceso,
      );
    }

    // Cliente de alto riesgo: la indicación médica y el aviso al equipo no
    // dependen de que el modelo se acuerde (ver alto-riesgo.ts). Va después
    // del control de mensajes nuevos: si este turno se descartara, el aviso
    // saldría dos veces.
    if (esAltoRiesgo(contenido)) {
      if (!config.sinAvisosMedicos) resultado.reply = conIndicacionMedica(resultado.reply);
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

    // Lo que el negocio prohibió no sale, aunque el modelo lo escriba.
    if (config.sinAvisosMedicos) resultado.reply = sinMencionesMedicas(resultado.reply);

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

    resultado.reply = enFormatoWhatsapp(
      conNombreBienEscrito(
        resultado.reply,
        empresa.nombreComercial || empresa.razonSocial,
      ),
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
        `Lead: envío por ${conv.canal ?? 'WHATSAPP'} falló a ${conv.telefonoProspecto}: ${envio.error}`,
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
  /**
   * El turno, si le toca al menú de bienvenida. Devuelve true si ya se le
   * contestó al cliente (un paso del menú o la derivación); false si sigue
   * la IA: menú apagado, ya terminado, o el cliente escribió otra cosa.
   */
  private async atenderMenu(
    empresaId: number,
    conv: { id: number; telefonoProspecto: string },
    mensajes: { rol: string; contenido: string; herramientasJson?: unknown }[],
    config: ConfigComercial,
  ): Promise<boolean> {
    const menu = config.menu;
    if (!menu?.activo) return false;
    const estado = estadoDelMenu(mensajes);
    if (estado.accion === 'empezar') {
      await this.enviarPasoMenu(empresaId, conv, menu, 0);
      return true;
    }
    if (estado.accion !== 'responder') return false;
    const paso = menu.pasos[estado.paso];
    // El dueño cambió el menú mientras el cliente estaba en él.
    if (!paso) return false;

    // Lo que el cliente mandó desde la pregunta, del último al primero: si
    // tocó el botón y después escribió "ok", vale el botón.
    const desdeLaPregunta = mensajes.slice(
      mensajes.map((m) => m.rol).lastIndexOf('ASISTENTE') + 1,
    );
    let elegida: number | null = null;
    for (const m of [...desdeLaPregunta].reverse()) {
      elegida = opcionElegida(paso, m.contenido);
      if (elegida !== null) break;
    }
    // Escribió otra cosa ("cuánto cuesta?"): la IA le contesta con lo que
    // ya eligió, y el menú termina ahí.
    if (elegida === null) return false;

    if (paso.opciones[elegida].derivar) {
      const respuestas = respuestasDelMenu(menu, mensajes);
      const argumentos = {
        motivo: 'pide_hablar_con_persona',
        detalle: detalleParaElAsesor(respuestas),
      };
      const ejecutor = this.crearEjecutor(
        empresaId,
        conv.id,
        conv.telefonoProspecto,
        new Set<number>(),
      );
      const resultado = await ejecutor(HERRAMIENTA_DERIVAR, argumentos);
      const texto =
        config.vendedor?.mensajeDerivacion?.trim() ||
        'Listo, te paso con una persona del equipo. Te escribe en un momento por aquí 🙌';
      await this.prisma.leadMensaje.create({
        data: {
          conversacionId: conv.id,
          rol: 'ASISTENTE',
          contenido: texto,
          herramientasJson: [
            { nombre: HERRAMIENTA_DERIVAR, argumentos, resultado },
          ] as unknown as Prisma.InputJsonValue,
        },
      });
      await this.whatsapp.enviarTexto(conv.telefonoProspecto, texto, empresaId);
      await this.prisma.leadConversacion.update({
        where: { id: conv.id },
        data: { cantidadMensajes: { increment: 1 } },
      });
      return true;
    }

    if (estado.paso + 1 < menu.pasos.length) {
      await this.enviarPasoMenu(empresaId, conv, menu, estado.paso + 1);
      return true;
    }
    // Respondió la última pregunta: ahora sí, la IA.
    return false;
  }

  private async enviarPasoMenu(
    empresaId: number,
    conv: { id: number; telefonoProspecto: string },
    menu: ConfigMenuInicial,
    i: number,
  ): Promise<void> {
    const m = mensajeDelPaso(menu, i);
    // En el historial va con las opciones escritas: es lo que la IA y el
    // panel ven de este mensaje.
    await this.prisma.leadMensaje.create({
      data: {
        conversacionId: conv.id,
        rol: 'ASISTENTE',
        contenido: textoConOpciones(m),
        herramientasJson: [
          { nombre: HERRAMIENTA_MENU, argumentos: { paso: i }, resultado: {} },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    const envio = await this.whatsapp.enviarMenu(conv.telefonoProspecto, m, empresaId);
    if (!envio.success) {
      // Si Meta rechaza los botones, que al menos le llegue la pregunta: se
      // responde igual con el número de la opción.
      this.logger.warn(
        `Lead: menú (paso ${i + 1}) no salió con botones a ${conv.telefonoProspecto}: ${envio.error}. Va como texto.`,
      );
      await this.whatsapp.enviarTexto(conv.telefonoProspecto, textoConOpciones(m), empresaId);
    }
    await this.prisma.leadConversacion.update({
      where: { id: conv.id },
      data: { cantidadMensajes: { increment: 1 } },
    });
  }

  private async enviarVideoBienvenidaSiEsElPrimero(
    empresaId: number,
    conv: { id: number; telefonoProspecto: string },
    config: { videoBienvenidaUrl?: string },
  ): Promise<void> {
    if (!config.videoBienvenidaUrl) return;
    // Los pasos del menú de bienvenida no cuentan: el video va tras la
    // primera respuesta de la IA, haya menú o no.
    const nuestros = await this.prisma.leadMensaje.findMany({
      where: { conversacionId: conv.id, rol: 'ASISTENTE' },
      select: { rol: true, contenido: true, herramientasJson: true },
    });
    const respuestas = nuestros.filter((m) => pasoDelMensaje(m) === null).length;
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
   * Brochure/catálogo: si el prospecto lo pide (ver `pideBrochure`) y la
   * empresa tiene un enlace configurado, se envía UNA vez por conversación
   * (PDF o imagen).
   */
  private async enviarBrochureSiCorresponde(
    empresa: { id: number; iaVentasBrochureUrl: string | null },
    conv: { id: number; telefonoProspecto: string },
    contenido: string,
  ): Promise<void> {
    if (!empresa.iaVentasBrochureUrl) return;
    // Se llama después de guardar la respuesta: 1 = es el primer turno.
    const respuestas = await this.prisma.leadMensaje.count({
      where: { conversacionId: conv.id, rol: 'ASISTENTE' },
    });
    if (!pideBrochure(contenido, respuestas <= 1)) return;

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
    conversacionId?: number,
    canal?: string | null,
  ): Promise<boolean> {
    if (!tope || tope <= 0) return false;
    // Un visitante de la tienda que solo saluda no gasta el cupo del plan:
    // cuenta recién cuando muestra interés (ver chat-web.ts). Mientras tanto
    // se le responde siempre.
    if (canal === 'WEB' && conversacionId) {
      const interesado = await this.prisma.leadConversacion.count({
        where: { id: conversacionId, ...WEB_CUENTA_COMO_LEAD },
      });
      if (!interesado) return false;
    }
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const rank = await this.prisma.leadConversacion.count({
      where: {
        empresaId,
        creadoEn: { gte: inicioMes, lte: convCreadoEn },
        OR: [{ canal: { not: 'WEB' } }, WEB_CUENTA_COMO_LEAD],
      },
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
    archivo?: ArchivoDelCliente | null,
  ): Promise<boolean> {
    try {
      const borrador = await this.prisma.leadPedidoBorrador.findUnique({
        where: { conversacionId },
        select: { cotizacionId: true, comprobanteId: true },
      });
      // Sin cotización ni pedido no hay nada que pagar todavía.
      if (!borrador?.cotizacionId && !borrador?.comprobanteId) return false;

      let buffer: Buffer | undefined = archivo?.buffer;
      let mimeType: string | undefined = archivo?.mimeType;
      if (!buffer && archivo === undefined && d.mediaId) {
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
        nota: textoDelCliente(d.text),
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
                  textoDelCliente(d.text) ? ` ${textoDelCliente(d.text)}` : ''
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
      return !!leido?.esComprobante;
    } catch (e: any) {
      this.logger.warn(
        `Lead: no se pudo registrar el comprobante de pago: ${e?.message}`,
      );
      return false;
    }
  }

  /**
   * Baja una sola vez la imagen o el PDF que mandó el cliente: lo usan la
   * lectura del voucher y la del contenido. null si no se pudo o si pesa
   * demasiado para mandárselo a la IA.
   */
  private async bajarArchivo(
    empresaId: number,
    d: MensajeEntrante,
  ): Promise<ArchivoDelCliente | null> {
    if (!d.mediaId) return null;
    try {
      const media = await this.whatsapp.descargarMedia(d.mediaId, empresaId);
      if (media.buffer.length > MAX_ARCHIVO_IA_BYTES) return null;
      return media;
    } catch (e: any) {
      this.logger.warn(
        `Lead: no se pudo bajar el archivo de ${d.from}: ${e?.message}`,
      );
      return null;
    }
  }

  /**
   * Le cuenta al modelo qué hay en la imagen o el PDF, escribiéndolo en el
   * propio mensaje del cliente, igual que con el voucher. Best-effort: si la
   * IA no lo lee, el mensaje queda como estaba y el agente le pide el nombre.
   */
  private async leerArchivoDelCliente(
    d: MensajeEntrante,
    mensajeId: number,
    archivo: ArchivoDelCliente | null,
  ) {
    if (!archivo || !this.ia.disponible()) return;
    if (!esArchivoLegible(archivo.mimeType)) return;
    const lectura = await this.ia
      .leerArchivoDelCliente(archivo.buffer, archivo.mimeType)
      .catch(() => null);
    const contenido = contenidoConLectura(d.text, lectura);
    if (!contenido) return;
    await this.prisma.leadMensaje
      .update({ where: { id: mensajeId }, data: { contenido } })
      .catch(() => undefined);
    this.logger.log(
      `Lead: ${lectura?.tipo} de ${d.from} leído (${lectura?.productos.length ?? 0} productos).`,
    );
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

  /**
   * Guarda la etiqueta del anuncio que trae el mensaje, si la trae. Una
   * reentrega de Meta no la duplica: el id del mensaje es único.
   */
  private async guardarOrigenDeAnuncio(
    empresaId: number,
    conversacionId: number,
    d: MensajeEntrante,
  ): Promise<void> {
    const origen = origenDeAnuncio(d.referral);
    if (!origen) return;
    await this.prisma.leadAnuncioOrigen.createMany({
      data: [{ empresaId, conversacionId, whatsappMsgId: d.messageId, ...origen }],
      skipDuplicates: true,
    });
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
   * Avisa al negocio que un cliente pidió la foto de un producto que no la
   * tiene cargada, para que se la mande desde el chat. Una vez por producto y
   * conversación: el cliente suele pedirla dos o tres veces seguidas. `false`
   * si no se pudo avisar; entonces el bot no promete nada.
   */
  private async pedirFotoAlNegocio(
    empresaId: number,
    conversacionId: number,
    telefono: string,
    productoId: number,
    descripcion: string,
  ): Promise<boolean> {
    const previos = await this.prisma.leadMensaje.findMany({
      where: {
        conversacionId,
        rol: 'ASISTENTE',
        herramientasJson: { not: Prisma.DbNull },
      },
      select: { herramientasJson: true },
    });
    const yaPedida = previos.some((m) =>
      (Array.isArray(m.herramientasJson) ? m.herramientasJson : []).some(
        (ll: any) =>
          ll?.nombre === HERRAMIENTA_ENVIAR_FOTO &&
          Number(ll?.argumentos?.productoId) === productoId &&
          ll?.resultado?.fotoPedidaAlEquipo,
      ),
    );
    if (yaPedida) return true;
    try {
      await this.notificaciones.notificarAdminsEmpresa({
        empresaId,
        // WARNING: el cliente está esperando la foto en el chat.
        tipo: 'WARNING',
        titulo: `📷 Piden foto: ${descripcion}`,
        mensaje: [
          `Un cliente quiere ver ${descripcion} y no tiene foto en el catálogo.`,
          'Entra a IA de Ventas, abre su chat y mándale la foto con el botón de imagen. La IA sigue atendiendo.',
          'Si cargas la foto en el producto, la próxima vez la manda sola.',
          '',
          `WhatsApp: ${telefono}`,
        ].join('\n'),
        metaData: {
          origen: 'ia-ventas-foto',
          telefono,
          conversacionId,
          productoId,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

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
          // Cómo se toma, si el negocio lo escribió. Una consulta aparte y no
          // en las tres búsquedas: solo hace falta de lo que se va a mostrar.
          const modos = new Map(
            (
              await this.prisma.producto.findMany({
                where: { id: { in: productos.map((p) => p.id) }, modoDeUso: { not: null } },
                select: { id: true, modoDeUso: true },
              })
            ).map((p) => [p.id, p.modoDeUso as string]),
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
              // El grado en que el negocio lo recomienda (muy alta, alta,
              // media, baja). Va en todos los que lo tienen: sin la escala
              // completa el modelo no puede comparar dos que sirven para lo
              // mismo.
              ...(nivelDeRecomendacion(p.prioridadVenta)
                ? { recomendacion: nivelDeRecomendacion(p.prioridadVenta) }
                : {}),
              tieneFoto: !!p.imagenUrl,
              ...(modos.get(p.id) ? { modoDeUso: modos.get(p.id) } : {}),
            })),
            // Sin esto el modelo "completa" con una dosis de memoria (QA 30-10:
            // "1 cucharada tres veces al día" para un jarabe sin modo de uso).
            ...(productos.some((p) => !modos.get(p.id))
              ? {
                  indicacionUso:
                    'Los productos sin modoDeUso NO tienen dosis registrada por el negocio. Si el cliente pregunta cómo se toman o se usan, no des dosis, cantidad, frecuencia ni horario, ni "generales" ni "habituales": dile que el equipo se lo indica con su pedido.',
                }
              : {}),
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
            // El cliente quiere ver lo que va a recibir y el bot no tenía qué
            // mostrarle: contestaba "no contamos con imagen" y ahí quedaba
            // (Hierba Sana, 20-10). Ahora se le pide la foto al negocio, que
            // la manda desde el chat del panel, y el bot sigue atendiendo.
            const avisado = await this.pedirFotoAlNegocio(
              empresaId,
              conversacionId,
              telefono,
              productoId,
              producto.descripcion,
            );
            return {
              enviada: false,
              ...(avisado ? { fotoPedidaAlEquipo: true } : {}),
              motivo: avisado
                ? 'Este producto no tiene foto en el catálogo, pero ya se le pidió al equipo: dile al cliente que le compartimos la foto por aquí en un momento, y sigue con la venta. No digas que el sistema no tiene la imagen ni prometas una hora.'
                : 'Este producto no tiene foto en el catálogo. No le prometas una al cliente.',
            };
          }
          const simbolo = producto.moneda === 'USD' ? 'US$' : 'S/';
          const caption = `${producto.descripcion} — ${simbolo}${Number(
            producto.precioUnitario,
          ).toFixed(2)}`;
          const envio = await this.whatsapp
            .enviarImagenUrl(telefono, producto.imagenUrl, caption, empresaId, { productoId })
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
          await this.pedido.separarPedidoSiCorresponde(
            empresaId,
            conversacionId,
            argumentos.pedidoAparte,
          );
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
          await this.pedido.separarPedidoSiCorresponde(
            empresaId,
            conversacionId,
            argumentos.pedidoAparte,
          );
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
            if (await this.pagoLink?.activo(empresaId).catch(() => false)) {
              return {
                ...res,
                pagoConLink: `Este negocio cobra con link de Mercado Pago. Cuando el cliente acepte, ofrécele pagar con el link (${HERRAMIENTA_LINK_PAGO}), con tarjeta o su cuenta de Mercado Pago, además de los medios de pago del contexto.`,
              };
            }
          }
          return res;
        }

        case HERRAMIENTA_LINK_PAGO: {
          if (!this.pagoLink) {
            return { noDisponible: 'Pídele el pago con los medios de pago del contexto.' };
          }
          const monto = Number(argumentos.monto);
          return this.pagoLink.generarLink(
            empresaId,
            conversacionId,
            Number.isFinite(monto) && monto > 0 ? monto : undefined,
          );
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
              metaData: { origen: 'ia-ventas-derivacion', motivo, telefono, conversacionId },
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
          const instruccion = (await this.pedido.configDe(empresaId)).sinAvisosMedicos
            ? 'Sigue atendiendo normal. No le digas que avisaste a nadie.'
            : 'Sigue atendiendo normal. Después de recomendar, dile con naturalidad que lo consulte con su médico y que no deje su tratamiento actual hasta que su médico lo indique. No le digas que avisaste a nadie.';
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
              metaData: { origen: 'ia-ventas-alto-riesgo', telefono, conversacionId },
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
          const { notificacion, ...res } = await this.pedido.avisarVisitaTienda(
            empresaId,
            conversacionId,
            telefono,
            String(argumentos.cuando ?? ''),
            typeof argumentos.nombre === 'string' ? argumentos.nombre : undefined,
          );
          if (notificacion) {
            await this.avisarVisitaPorWhatsapp(empresaId, conversacionId, telefono, notificacion);
          }
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
          // A la lista de visitas, con la ubicación y la foto la primera vez.
          if (res?.avisado && this.visitas) {
            const v = await this.visitas
              .registrar(empresaId, conversacionId, telefono, {
                cuando: String(argumentos.cuando ?? ''),
                fecha: argumentos.fecha,
                conPedido: true,
              })
              .catch(() => null);
            if (v?.indicacionesEnviadas) return { ...res, indicacionesEnviadas: true };
          }
          // QA 27-10: "voy mañana a comprar" sin cotización armada → el aviso
          // fallaba con "cotiza primero" y el cliente se quedaba sin el mapa
          // (y el modelo igual decía que se lo mandó). La visita se registra
          // igual, sin pedido, para que le llegue cómo llegar. Lo mismo si
          // falta un dato (el nombre): el mapa no espera al nombre.
          if ((res?.error || res?.falta?.length) && this.visitas) {
            const v = await this.visitas
              .registrar(empresaId, conversacionId, telefono, {
                cuando: String(argumentos.cuando ?? ''),
                fecha: argumentos.fecha,
                conPedido: false,
              })
              .catch(() => null);
            if (v?.registrada) {
              const { notificacion: aviso, ...visita } = v;
              if (aviso) {
                await this.avisarVisitaPorWhatsapp(empresaId, conversacionId, telefono, aviso);
              }
              const sinPedido = res.error
                ? `La visita quedó registrada, pero NO hay pedido: ${res.error}`
                : `La visita quedó registrada, pero el pedido NO: para dejarle sus productos separados falta ${res.falta!.join(', ')}. Pídeselo y vuelve a llamar avisar_visita_tienda.`;
              return {
                ...visita,
                ...(res.cambio ? { cambio: res.cambio } : {}),
                pedido: undefined,
                aviso: [
                  `${sinPedido} No le digas que su pedido quedó registrado ni que sus productos están separados o listos.`,
                  visita.aviso,
                ]
                  .filter(Boolean)
                  .join(' '),
              };
            }
          }
          // Un fallo acá NO deriva: el cliente igual va a ir a la tienda, y
          // apagar el bot lo dejaría sin a quién preguntarle.
          return res;
        }

        case HERRAMIENTA_AGENDAR_VISITA: {
          if (!this.visitas) return { error: 'No disponible.' };
          const { notificacion, ...visita } = await this.visitas.registrar(
            empresaId,
            conversacionId,
            telefono,
            {
              cuando: String(argumentos.cuando ?? ''),
              fecha: argumentos.fecha,
              conPedido: false,
            },
          );
          if (notificacion) {
            await this.avisarVisitaPorWhatsapp(empresaId, conversacionId, telefono, notificacion);
          }
          return visita;
        }

        case HERRAMIENTA_CANCELAR_PEDIDO:
          return this.pedido.cancelarPedido(
            empresaId,
            conversacionId,
            String(argumentos.motivo ?? ''),
          );

        case HERRAMIENTA_DAR_DEMO:
          return this.darDemo(empresaId, conversacionId, telefono, argumentos);

        default:
          return { error: `Herramienta desconocida: ${nombre}` };
      }
    };
  }

  /**
   * La visita también llega por WhatsApp a quien atiende, no solo a la
   * campana. Best-effort: un WhatsApp caído no frena la respuesta al cliente.
   */
  private async avisarVisitaPorWhatsapp(
    empresaId: number,
    conversacionId: number,
    telefono: string,
    notificacion: { titulo: string; mensaje: string },
  ): Promise<void> {
    try {
      const [conv, cfg] = await Promise.all([
        this.prisma.leadConversacion.findUnique({
          where: { id: conversacionId },
          select: { nombreProspecto: true },
        }),
        this.pedido.configDe(empresaId),
      ]);
      await this.alerta.avisarVisitaTienda({
        empresaId,
        telefonoProspecto: telefono,
        nombreProspecto: conv?.nombreProspecto ?? null,
        supervisorTelefono: cfg.supervisorTelefono ?? null,
        ...notificacion,
      });
    } catch (e) {
      this.logger.warn(
        `Aviso de visita de la conv ${conversacionId} por WhatsApp falló: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Los accesos a la demo del rubro del prospecto. Valida el RUC en SUNAT
   * (un número mal escrito se le devuelve para que lo revise) y le avisa a
   * ventas una sola vez por conversación.
   */
  private async darDemo(
    empresaId: number,
    conversacionId: number,
    telefono: string,
    argumentos: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const cfg = await this.pedido.configDe(empresaId);
    if (!cfg.demos?.cuentas.length) {
      return {
        error:
          'Este negocio no entrega demos por aquí. No inventes accesos: ofrécele coordinarla con el equipo.',
      };
    }
    const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const datos: DatosDemo = {
      rubro: texto(argumentos.rubro),
      demo: texto(argumentos.demo),
      nombre: texto(argumentos.nombre),
      celular: texto(argumentos.celular),
      correo: texto(argumentos.correo),
      ruc: texto(argumentos.ruc),
      nombreComercial: texto(argumentos.nombreComercial),
    };
    const faltan = faltanParaDemo(datos);
    if (faltan.length) return { faltan, bloque: BLOQUE_DATOS_DEMO };

    const ruc = leerRuc(datos.ruc);
    if ('invalido' in ruc) {
      return {
        faltan: ['RUC válido'],
        instruccion:
          'El RUC debe tener 11 dígitos y empezar con 10 o 20. Pídele que lo revise, o que te diga si aún no tiene RUC.',
      };
    }
    let razonSocial: string | undefined;
    let estadoRuc: string | undefined;
    if ('ruc' in ruc) {
      const sunat = await consultarRuc(ruc.ruc);
      if (sunat === null) {
        return {
          faltan: ['RUC válido'],
          instruccion: `SUNAT no encuentra el RUC ${ruc.ruc}. Pídele que lo revise, o que te diga si aún no tiene RUC.`,
        };
      }
      if (sunat) {
        razonSocial = sunat.razonSocial;
        estadoRuc = `${sunat.estado} ${sunat.condicion}`.trim();
      }
    }

    const elegida = elegirDemo(cfg.demos.cuentas, { ...datos, razonSocial });
    if (!elegida) {
      return {
        opciones: cfg.demos.cuentas.map((c) => c.rubro),
        instruccion:
          'Ninguna demo es de su rubro. Vuelve a llamar a dar_demo con los mismos datos y `demo` = la opción más parecida a su negocio. No le digas que no hay demo de su rubro.',
      };
    }
    const { cuenta, aproximada } = elegida;
    const acceso = {
      rubro: cuenta.rubro,
      enlace: cfg.demos.enlace,
      usuario: cuenta.usuario,
      clave: cuenta.clave,
    };

    // Una vez por conversación: si vuelve a pedirla, se le repiten los
    // accesos sin llenar otra vez el celular de ventas.
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
          ll?.nombre === HERRAMIENTA_DAR_DEMO && ll?.resultado?.acceso,
      ),
    );
    // El banco de prospectos: se guarda siempre, con lo último que dijo.
    const rucFinal = 'ruc' in ruc ? ruc.ruc : null;
    const registro = {
      conversacionId,
      nombre: datos.nombre!,
      celular: datos.celular || null,
      correo: datos.correo || null,
      ruc: rucFinal,
      razonSocial: razonSocial ?? null,
      nombreComercial: datos.nombreComercial || null,
      rubro: datos.rubro || null,
      demo: cuenta.rubro,
      aproximada,
    };
    const demo = await this.prisma.leadDemo
      .upsert({
        where: { empresaId_telefono: { empresaId, telefono } },
        create: { empresaId, telefono, ...registro },
        update: registro,
        select: { id: true },
      })
      .catch((e) => {
        this.logger.warn(
          `No se pudo guardar la demo de la conv ${conversacionId}: ${e?.message}`,
        );
        return null;
      });

    if (!yaAvisado) {
      // A las 3 horas, "¿qué tal te pareció?". Si contesta, la IA sigue.
      if (demo) {
        await this.disparadores
          .programar({
            empresaId,
            tipo: TipoDisparo.SEGUIMIENTO_DEMO,
            telefono,
            referencia: `demo:${demo.id}`,
            conversacionId,
          })
          .catch(() => undefined);
      }
      await this.prisma.leadConversacion
        .update({
          where: { id: conversacionId },
          data: { nombreProspecto: datos.nombre },
        })
        .catch(() => undefined);
      await this.notificaciones
        .notificarAdminsEmpresa({
          empresaId,
          tipo: 'INFO',
          titulo: `🎯 Demo entregada: ${datos.nombre}`,
          mensaje: `Demo de ${cuenta.rubro}${aproximada ? ' (la más parecida)' : ''}. Rubro: ${datos.rubro}. Correo: ${datos.correo}. ${'ruc' in ruc ? `RUC ${ruc.ruc}${razonSocial ? ` · ${razonSocial}` : ''}` : 'Sin RUC'}.\n\nWhatsApp: ${telefono}`,
          metaData: { origen: 'ia-ventas-demo', telefono, conversacionId, demo: cuenta.rubro },
        })
        .catch(() => undefined);
      await this.alerta
        .avisarDemo({
          empresaId,
          telefonoProspecto: telefono,
          nombreProspecto: datos.nombre,
          motivo: 'demo',
          supervisorTelefono: cfg.demos.avisarA ?? cfg.supervisorTelefono ?? null,
          datos: {
            ...datos,
            ruc: 'ruc' in ruc ? ruc.ruc : undefined,
            razonSocial: razonSocial
              ? `${razonSocial}${estadoRuc && estadoRuc !== 'ACTIVO HABIDO' ? ` (${estadoRuc})` : ''}`
              : undefined,
          },
          demo: cuenta.rubro,
          aproximada,
        })
        .catch((e) =>
          this.logger.warn(
            `Aviso de demo de la conv ${conversacionId} falló: ${e?.message}`,
          ),
        );
    }
    this.logger.log(
      `Lead: conv ${conversacionId} recibió la demo de ${cuenta.rubro}${aproximada ? ' (aproximada)' : ''}.`,
    );
    return {
      acceso,
      ...(razonSocial ? { razonSocial } : {}),
      instruccion:
        'Mándale el enlace, el usuario y la clave tal cual, dile en una línea que es una demo de un negocio de su rubro y que tiene 3 horas para revisarla, y que luego le escribes para saber qué le pareció. En este mensaje NO le ofrezcas la demo en vivo ni horarios, y no le hagas preguntas.',
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
  /**
   * Pedidos en curso de este celular registrados en el panel (ver
   * pedidos-del-cliente.ts): con envío sin entregar o con saldo pendiente,
   * de los últimos 60 días.
   */
  private async pedidosDelCliente(empresaId: number, telefono: string): Promise<string> {
    // Un @usuario de WhatsApp (BSUID) no es un celular: no se cruza con nada.
    if (!/^\+?\d{9,15}$/.test(telefono)) return '';
    const nueve = telefono.replace(/\D/g, '').slice(-9);
    try {
      const desde = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const filas = await this.prisma.comprobante.findMany({
        where: {
          empresaId,
          fechaEmision: { gte: desde },
          tipoDoc: { notIn: ['COT', '07', '08'] },
          NOT: [{ estadoPago: 'ANULADO' }, { estadoEnvioSunat: 'ANULADO' }],
          AND: [
            {
              OR: [
                { cliente: { telefono: { endsWith: nueve } } },
                { envioDespacho: { celularDest: { endsWith: nueve } } },
              ],
            },
            {
              OR: [
                { envioDespacho: { estado: { in: ['PREPARANDO', 'EN_CAMINO', 'EN_AGENCIA', 'EN_DESTINO'] } } },
                { saldo: { gt: 0.009 }, estadoPago: { in: ['PENDIENTE_PAGO', 'PAGO_PARCIAL'] } },
              ],
            },
          ],
        },
        select: {
          serie: true,
          correlativo: true,
          fechaEmision: true,
          mtoImpVenta: true,
          saldo: true,
          detalles: { select: { descripcion: true, cantidad: true }, take: 4 },
          envioDespacho: {
            select: {
              estado: true,
              transportista: true,
              agenciaDestino: true,
              codigoGuia: true,
              nroOrden: true,
              claveEnvio: true,
              celularDest: true,
              shalomEstado: true,
              olvaEstado: true,
              montoCOD: true,
              repartidor: { select: { nombre: true, celular: true, tipo: true } },
            },
          },
        },
        orderBy: { fechaEmision: 'desc' },
        take: 3,
      });
      const configDespacho = filas.some((f) => f.envioDespacho?.repartidor)
        ? await this.prisma.despachoMensajeTemplate.findUnique({
            where: { empresaId },
            select: { pagoRepartidorPropio: true, pagoRepartidorContratado: true },
          })
        : null;
      return contextoPedidosDelCliente(
        filas.map((f) => ({
          serie: f.serie,
          correlativo: f.correlativo,
          fechaEmision: f.fechaEmision,
          total: Number(f.mtoImpVenta ?? 0),
          // Lo mismo que le dice el aviso de la agencia: el saldo de la nota o,
          // si no hay, el contra entrega del envío. Si no, el aviso cobraba
          // S/ 10 y el bot decía "pagado".
          saldo: saldoParaRetirar(f.saldo, f.envioDespacho?.montoCOD),
          productos: f.detalles.map((d) => `${d.descripcion} x ${Number(d.cantidad)}`),
          despacho: f.envioDespacho
            ? {
                estado: String(f.envioDespacho.estado),
                transportista: f.envioDespacho.transportista,
                agenciaDestino: f.envioDespacho.agenciaDestino,
                codigoGuia: f.envioDespacho.codigoGuia,
                nroOrden: f.envioDespacho.nroOrden,
                etapaCourier: f.envioDespacho.shalomEstado || f.envioDespacho.olvaEstado,
                // Si el envío es para otro celular (un regalo), la clave es de quien recoge.
                claveRecojo: f.envioDespacho.celularDest?.replace(/\D/g, '').endsWith(nueve)
                  ? f.envioDespacho.claveEnvio
                  : null,
                repartidor: quienReparte(f.envioDespacho.repartidor),
                formasDePago: formasDePagoParaElAviso(f.envioDespacho.repartidor?.tipo, configDespacho),
              }
            : null,
        })),
      );
    } catch (e) {
      // Sin esto el bot responde igual que antes; no es motivo para no responder.
      this.logger.warn(`Lead: no se pudieron leer los pedidos del cliente: ${(e as Error).message}`);
      return '';
    }
  }

  /**
   * Compras ya terminadas del cliente (último año) y la guía de consumo que se
   * le envió. Ver contextoHistorialCliente. Por celular y por los pedidos que
   * cerró el bot en este chat (un @usuario sin número solo tiene esos).
   */
  private async historialDelCliente(
    empresaId: number,
    conversacionId: number,
    telefono: string,
  ): Promise<string> {
    try {
      const nueve = /^\+?\d{9,15}$/.test(telefono) ? telefono.replace(/\D/g, '').slice(-9) : null;
      const [delBot, prospecto] = await Promise.all([
        this.prisma.leadPedidoBorrador.findMany({
          where: { empresaId, conversacionId, comprobanteId: { not: null } },
          select: { comprobanteId: true },
        }),
        this.prisma.leadProspecto.findUnique({
          where: { conversacionId },
          select: { guiaConsumo: true, guiaConsumoEn: true },
        }),
      ]);
      const quien: Prisma.ComprobanteWhereInput[] = [];
      const ids = delBot.map((b) => b.comprobanteId as number);
      if (ids.length) quien.push({ id: { in: ids } });
      if (nueve) {
        quien.push({ cliente: { telefono: { endsWith: nueve } } });
        quien.push({ envioDespacho: { celularDest: { endsWith: nueve } } });
      }
      const filas = quien.length
        ? await this.prisma.comprobante.findMany({
            where: {
              empresaId,
              tipoDoc: { in: ['NV', '01', '03', 'TICKET', 'NP'] },
              fechaEmision: { gte: new Date(Date.now() - 365 * 86_400_000) },
              NOT: [{ estadoPago: 'ANULADO' }, { estadoEnvioSunat: 'ANULADO' }],
              AND: [
                { OR: quien },
                // Lo que sigue en camino o debe saldo ya va en PEDIDOS EN CURSO.
                { OR: [{ envioDespacho: { is: null } }, { envioDespacho: { estado: 'ENTREGADO' } }] },
                { OR: [{ saldo: null }, { saldo: { lte: 0.009 } }, { estadoPago: 'COMPLETADO' }] },
              ],
            },
            select: {
              fechaEmision: true,
              detalles: { select: { descripcion: true, cantidad: true }, take: 8 },
            },
            orderBy: { fechaEmision: 'desc' },
            take: 5,
          })
        : [];
      return contextoHistorialCliente(
        filas.map((f) => ({
          fechaEmision: f.fechaEmision,
          productos: f.detalles
            .filter((d) => !esLineaDeEnvio(d.descripcion))
            .map((d) => `${d.descripcion} x ${Number(d.cantidad)}`),
        })),
        prospecto?.guiaConsumo ? { texto: prospecto.guiaConsumo, en: prospecto.guiaConsumoEn } : null,
      );
    } catch (e) {
      // Sin esto el bot responde igual que antes; no es motivo para no responder.
      this.logger.warn(`Lead: no se pudo leer el historial del cliente: ${(e as Error).message}`);
      return '';
    }
  }

  private async unirConversacionSinNumero(empresaId: number, d: MensajeEntrante): Promise<void> {
    if (!esTelefono(d.from)) return;
    const ya = await this.prisma.leadConversacion.findUnique({
      where: { empresaId_telefonoProspecto: { empresaId, telefonoProspecto: d.from } },
      select: { id: true },
    });
    if (ya) return;
    const candidatas = await this.prisma.leadConversacion.findMany({
      where: {
        empresaId,
        OR: [
          ...(d.bsuid ? [{ telefonoProspecto: d.bsuid }] : []),
          // Sin número: los BSUID empiezan con el código del país en letras.
          { telefonoProspecto: { startsWith: 'PE.' }, actualizadoEn: { gte: new Date(Date.now() - 30 * 864e5) } },
        ],
      },
      select: { id: true, telefonoProspecto: true, borrador: { select: { celular: true } } },
      take: 200,
    });
    const id = conversacionDelMismoCliente(
      d.from,
      d.bsuid,
      candidatas.map((c) => ({ id: c.id, telefonoProspecto: c.telefonoProspecto, celularEntrega: c.borrador?.celular })),
    );
    if (!id) return;
    const anterior = candidatas.find((c) => c.id === id)!.telefonoProspecto;
    await this.prisma.$transaction([
      this.prisma.leadConversacion.update({ where: { id }, data: { telefonoProspecto: d.from } }),
      this.prisma.leadProspecto.updateMany({ where: { conversacionId: id }, data: { telefonoProspecto: d.from } }),
    ]);
    // Los avisos programados y las consultas siguen al cliente; si alguno
    // choca con uno que ya tenía el número, queda el que estaba.
    await this.prisma.leadDisparo
      .updateMany({ where: { empresaId, telefono: anterior }, data: { telefono: d.from } })
      .catch(() => undefined);
    await this.prisma.leadConsulta
      .updateMany({ where: { empresaId, telefono: anterior }, data: { telefono: d.from } })
      .catch(() => undefined);
    this.logger.log(`Lead: conversación ${id} (${anterior}) ahora con su número ${d.from}.`);
  }

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
      const nivel = nivelDeRecomendacion(p.prioridadVenta);
      return `- ${p.descripcion}: ${precio} (${this.textoDisponibilidad(p)}${nivel ? `; recomendación ${nivel}` : ''})`;
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

  /**
   * Lo que el cliente hizo, comprobado en la base. Si la consulta falla se
   * asume que no hizo nada: un lead que queda tibio de más se recupera
   * mirando el embudo, una alerta falsa de "caliente" es justo la queja.
   */
  private async hechosDelLead(
    empresaId: number,
    conversacionId: number,
    telefono: string,
    historial: MensajeConversacion[],
  ): Promise<HechosLead> {
    const mensajesCliente = historial.filter((m) => m.role === 'user').length;
    try {
      const [prospecto, borrador, retoma, visita] = await Promise.all([
        this.prisma.leadProspecto.findUnique({
          where: { conversacionId },
          select: { etapa: true },
        }),
        this.prisma.leadPedidoBorrador.findUnique({
          where: { conversacionId },
          select: { comprobanteId: true, tipoZona: true, horario: true },
        }),
        this.prisma.leadDisparo.count({
          where: {
            empresaId,
            telefono,
            tipo: 'RECORDATORIO_ACORDADO',
            estado: 'PROGRAMADO',
          },
        }),
        // La visita sin pedido ("primero quiero conocer la tienda") vive en
        // LeadVisitaTienda, no en el borrador (QA 26-10: Percy quedaba tibio).
        this.prisma.leadVisitaTienda.count({
          where: { conversacionId, estado: 'AGENDADA' },
        }),
      ]);
      return {
        etapa: prospecto?.etapa ?? 'NUEVO',
        pedidoRegistrado: borrador?.comprobanteId != null,
        visitaAgendada:
          visita > 0 || (borrador?.tipoZona === 'RECOJO' && !!borrador.horario?.trim()),
        retomaAgendado: retoma > 0,
        mensajesCliente,
      };
    } catch {
      return {
        etapa: 'NUEVO',
        pedidoRegistrado: false,
        visitaAgendada: false,
        retomaAgendado: false,
        mensajesCliente,
      };
    }
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

    // La temperatura la ponen los hechos (datos, pago o entrega agendados),
    // no solo la opinión de la IA. Ver temperatura-por-hechos.ts.
    const rango = rangoTemperatura(
      await this.hechosDelLead(empresa.id, conversacionId, quien.telefono, historial),
    );
    const puntaje = ajustarPuntaje(cal.score.total, rango);
    const estado = estadoDesdeScore(puntaje);
    const debeAvisar = rango.alertar && estado === 'CALIENTE';

    const data = {
      puntaje,
      estado: estadoProspectoDesde(estado),
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
    if (debeAvisar && !prospecto.notificadoEn) {
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
        titulo: `🔥 ${rango.motivo}: ${nombre}`,
        mensaje: `${cal.resumen}\n\nAcción sugerida: ${cal.proximaAccion}`,
        metaData: {
          origen: 'ia-ventas',
          prospectoId: prospecto.id,
          conversacionId,
          telefono: quien.telefono,
          puntaje,
          motivo: rango.motivo,
        },
      });
      // Alerta multicanal (correo + WhatsApp al vendedor), best-effort.
      await this.alerta.alertarLeadCaliente({
        empresaId: empresa.id,
        empresaNombre: empresa.nombreComercial || empresa.razonSocial,
        prospectoId: prospecto.id,
        nombreProspecto: nombre,
        telefonoProspecto: quien.telefono,
        cal: {
          ...cal,
          score: { ...cal.score, total: puntaje },
          status: estado,
          puntosClave: [rango.motivo ?? '', ...cal.puntosClave].filter(Boolean),
        },
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
