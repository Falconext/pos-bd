import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { RagVentasService } from './leads-rag.service';
import { LeadsAlertaService } from './leads-alerta.service';
import { ComprobanteService } from '../comprobante/comprobante.service';
import {
  DEBOUNCE_RESPUESTA_MS,
  JOB_RESPONDER,
  LEADS_MESSAGES_QUEUE,
} from './leads.constants';
import { Prisma } from '@prisma/client';
import { EjecutorHerramienta } from '../gemini/gemini.service';
import {
  HERRAMIENTA_BUSCAR_PRODUCTOS,
  HERRAMIENTA_ENVIAR_FOTO,
} from './leads-herramientas';
import {
  IaVentasService,
  MensajeConversacion,
  RespuestaVenta,
  CalificacionBant,
  estadoProspectoDesde,
} from './leads-ia.service';

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
    @InjectQueue(LEADS_MESSAGES_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<MensajeEntrante | TareaRespuesta>): Promise<void> {
    if (job.name === JOB_RESPONDER) {
      return this.responder(job.data as TareaRespuesta);
    }
    return this.ingresar(job.data as MensajeEntrante);
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
      select: { id: true },
    });

    // 2b) Asegura el prospecto desde el PRIMER contacto (estado FRIO, puntaje 0),
    // así el lead aparece en el panel aunque aún no haya calificación BANT. La
    // calificación posterior (aplicarCalificacion) solo actualiza su score.
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
  private async responder(t: TareaRespuesta): Promise<void> {
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
    if (!empresa?.iaVentasActiva) return;
    if (!this.ia.disponible()) {
      this.logger.warn('IA de ventas sin GEMINI_API_KEY; no se responde.');
      return;
    }

    const conv = await this.prisma.leadConversacion.findUnique({
      where: { id: t.conversacionId },
      select: {
        id: true,
        creadoEn: true,
        telefonoProspecto: true,
        nombreProspecto: true,
      },
    });
    if (!conv) return;

    // Bot pausado en este prospecto (un humano tomó el chat).
    const prospecto = await this.prisma.leadProspecto.findUnique({
      where: { conversacionId: conv.id },
      select: { botActivo: true },
    });
    if (prospecto && !prospecto.botActivo) return;

    // Tope mensual de leads del plan (soft-block): el lead se captura igual, pero
    // si esta conversación supera el tope, la IA no responde y se avisa al admin.
    if (
      await this.superaTopeLeads(
        empresa.id,
        empresa.plan?.maxLeadsMes ?? null,
        conv.creadoEn,
      )
    ) {
      return;
    }

    const mensajes = await this.prisma.leadMensaje.findMany({
      where: { conversacionId: conv.id },
      orderBy: { id: 'asc' },
      select: { rol: true, contenido: true },
    });
    // Si lo último que hay es nuestro, este lote ya fue contestado (reintento
    // de BullMQ, o una respuesta manual desde el panel mientras esperábamos).
    if (mensajes.at(-1)?.rol !== 'USUARIO') return;

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
    // Productos REALES del ERP que coinciden con lo que pregunta el cliente
    // (precio + stock en vivo). Lo que diferencia a la IA de un bot "ciego".
    const relevantes = await this.buscarProductosRelevantes(
      empresa.id,
      contenido,
    );
    const contextoRag = await this.rag.buscarContexto(empresa.id, contenido, 5);
    const businessContext = [contextoEmpresa, relevantes.contexto, contextoRag]
      .filter((s) => s && s.trim())
      .join('\n\n');

    // El modelo puede pedir herramientas (buscar en el catálogo, enviar una
    // foto). `fotosEnviadas` evita repetir la misma imagen en un turno.
    const fotosEnviadas = new Set<number>();
    const ejecutor = this.crearEjecutor(
      empresa.id,
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
        herramientasJson: resultado.llamadas.length
          ? (resultado.llamadas as unknown as Prisma.InputJsonValue)
          : undefined,
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
    telefono: string,
    fotosEnviadas: Set<number>,
  ): EjecutorHerramienta {
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
          const productos = await this.consultarCatalogo(
            empresaId,
            consulta,
            categoria,
          );
          const ms = Date.now() - inicio;
          this.logger.log(
            `IA buscó "${consulta}"${categoria ? ` [${categoria}]` : ''} en empresa ${empresaId}: ${productos.length} resultado(s) en ${ms} ms.`,
          );
          if (productos.length === 0) {
            return {
              productos: [],
              mensaje:
                'Sin coincidencias. Intenta otra vez con un término distinto: el ingrediente, el órgano o sistema, o la acción que busca el cliente.',
            };
          }
          return {
            productos: productos.map((p) => ({
              id: p.id,
              nombre: p.descripcion,
              precio: `${p.moneda === 'USD' ? 'US$' : 'S/'} ${Number(p.precioUnitario).toFixed(2)}`,
              disponibilidad: this.textoDisponibilidad(p.stock),
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

        default:
          return { error: `Herramienta desconocida: ${nombre}` };
      }
    };
  }

  /**
   * Cómo se le describe la disponibilidad al modelo. Hoy sale del stock; B1 lo
   * cambia por el campo de disponibilidad real (INMEDIATA / BAJO PEDIDO / NO
   * DISPONIBLE), y este es el único sitio que hay que tocar.
   */
  private textoDisponibilidad(stock: unknown): string {
    return Number(stock) > 0 ? 'disponible' : 'sin stock';
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
      moneda: string;
      imagenUrl: string | null;
    }[];
  }> {
    const productos = await this.consultarCatalogo(empresaId, texto);
    if (productos.length === 0) return { contexto: '', productos: [] };

    const lineas = productos.map((p) => {
      const simbolo = p.moneda === 'USD' ? 'US$' : 'S/';
      const precio = `${simbolo}${Number(p.precioUnitario).toFixed(2)}`;
      return `- ${p.descripcion}: ${precio} (${this.textoDisponibilidad(p.stock)})`;
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

    return this.prisma.producto.findMany({
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
      },
      orderBy: { stock: 'desc' },
      take: 8,
    });
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
