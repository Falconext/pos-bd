import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoLeadProspecto, TipoLeadDocumento } from '@prisma/client';
import { RagVentasService } from './leads-rag.service';
import { ClienteService } from '../cliente/cliente.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { S3Service } from '../s3/s3.service';
import { LIMITE_TEXTO_WHATSAPP } from './leads.constants';
import { venceEn } from './pausa-bot';

/**
 * Módulo IA de Ventas / Filtro de Leads (portado de salesfilter-ai).
 * Todo scoped por empresaId. Esta primera fase expone la lectura del CRM
 * (prospectos + conversaciones); el motor de IA y el webhook llegan después.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagVentasService,
    private readonly clientes: ClienteService,
    private readonly whatsapp: WhatsAppService,
    @Optional() private readonly s3?: S3Service,
  ) {}

  /**
   * Convierte un prospecto en Cliente de MYPE (el embudo completo, un clic).
   * Reusa ClienteService.crear (sin duplicar). Como un lead normalmente no tiene
   * documento, se crea como "OTRO" con nroDoc placeholder. Idempotente: si ya se
   * convirtió, devuelve el cliente existente.
   */
  async convertirACliente(empresaId: number, prospectoId: number) {
    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { id: prospectoId, empresaId },
      select: {
        id: true,
        nombreProspecto: true,
        telefonoProspecto: true,
        clienteId: true,
      },
    });
    if (!prospecto) throw new NotFoundException('Prospecto no encontrado');

    // Ya convertido → devolver el cliente existente (idempotente).
    if (prospecto.clienteId) {
      const cliente = await this.prisma.cliente.findUnique({
        where: { id: prospecto.clienteId },
      });
      if (cliente) return { cliente, yaExistia: true };
    }

    const cliente = await this.clientes.crear({
      nombre:
        prospecto.nombreProspecto?.trim() ||
        `Prospecto ${prospecto.telefonoProspecto}`,
      tipoDoc: 'OTRO',
      nroDoc: '00000000', // sin documento: no se deduplica
      telefono: prospecto.telefonoProspecto,
      empresaId,
      ubigeo: '',
      departamento: '',
      provincia: '',
      distrito: '',
    });

    await this.prisma.leadProspecto.update({
      where: { id: prospecto.id },
      data: { clienteId: cliente.id, estado: 'CONVERTIDO' },
    });

    return { cliente, yaExistia: false };
  }

  // ─── Entrenamiento de la IA (RAG) ──────────────────────────────────────────

  private readonly docSelect = {
    id: true,
    tipo: true,
    titulo: true,
    origen: true,
    estado: true,
    error: true,
    creadoEn: true,
    _count: { select: { fragmentos: true } },
  } as const;

  /** Documentos de entrenamiento de la empresa. */
  async listarDocumentos(empresaId: number) {
    return this.prisma.leadDocumento.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
      select: this.docSelect,
    });
  }

  /** Crea un documento (texto o URL), lo indexa (RAG) y devuelve su estado. */
  async crearDocumento(
    empresaId: number,
    dto: {
      tipo: TipoLeadDocumento;
      titulo?: string;
      contenido?: string;
      url?: string;
    },
  ) {
    let contenido = dto.contenido ?? '';
    let origen: string | null = null;

    if (dto.tipo === 'URL') {
      if (!dto.url) throw new BadRequestException('Falta la URL a entrenar');
      origen = dto.url;
      contenido = await this.extraerTextoUrl(dto.url);
    }
    if (!contenido.trim()) {
      throw new BadRequestException(
        'El documento no tiene contenido para entrenar',
      );
    }

    const doc = await this.prisma.leadDocumento.create({
      data: {
        empresaId,
        tipo: dto.tipo,
        titulo: dto.titulo?.trim() || origen || 'Documento',
        origen,
        contenido,
        estado: 'PENDIENTE',
      },
      select: { id: true },
    });

    await this.rag.indexarDocumento(doc.id, contenido);

    return this.prisma.leadDocumento.findUnique({
      where: { id: doc.id },
      select: this.docSelect,
    });
  }

  /**
   * Vuelve a indexar un documento que quedó en ERROR.
   *
   * Hasta ahora la única salida era borrarlo y volver a subirlo, y eso con un
   * PDF de 40 páginas o una URL larga es rehacer el trabajo. La mayoría de
   * los errores son pasajeros —la cuota de Gemini, un timeout— así que
   * reintentar suele bastar.
   *
   * El contenido ya está extraído y guardado: solo se rehacen los embeddings.
   */
  async reindexarDocumento(empresaId: number, id: number) {
    const doc = await this.prisma.leadDocumento.findFirst({
      where: { id, empresaId },
      select: { id: true, contenido: true, estado: true, titulo: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (!doc.contenido?.trim()) {
      // Sin texto no hay nada que indexar: el fallo fue al extraerlo y hay
      // que volver a subir el archivo.
      throw new BadRequestException(
        'Este documento no tiene texto extraído. Vuelve a subirlo.',
      );
    }

    // Los fragmentos viejos se borran: si quedó a medias, reindexar sin
    // limpiar dejaría el documento duplicado en las búsquedas.
    await this.prisma.leadFragmento.deleteMany({ where: { documentoId: id } });
    await this.prisma.leadDocumento.update({
      where: { id },
      data: { estado: 'PENDIENTE', error: null },
    });

    await this.rag.indexarDocumento(id, doc.contenido);

    return this.prisma.leadDocumento.findUnique({
      where: { id },
      select: this.docSelect,
    });
  }

  /** Elimina un documento y sus fragmentos (cascade). */
  async eliminarDocumento(empresaId: number, id: number) {
    const doc = await this.prisma.leadDocumento.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    await this.prisma.leadDocumento.delete({ where: { id } });
    return { ok: true };
  }

  /** Descarga una URL y extrae su texto plano (strip básico de HTML). */
  private async extraerTextoUrl(url: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new BadRequestException('No se pudo acceder a la URL');
    }
    if (!res.ok) {
      throw new BadRequestException(`La URL respondió ${res.status}`);
    }
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50000);
  }

  /** Lista de prospectos (leads) de la empresa, con filtros básicos. */
  async listarProspectos(
    empresaId: number,
    opts: { estado?: EstadoLeadProspecto; search?: string } = {},
  ) {
    const prospectos = await this.prisma.leadProspecto.findMany({
      where: {
        empresaId,
        ...(opts.estado ? { estado: opts.estado } : {}),
        ...(opts.search
          ? {
              OR: [
                {
                  nombreProspecto: {
                    contains: opts.search,
                    mode: 'insensitive',
                  },
                },
                { telefonoProspecto: { contains: opts.search } },
              ],
            }
          : {}),
      },
      orderBy: [{ puntaje: 'desc' }, { actualizadoEn: 'desc' }],
      take: 200,
    });

    // Adjunta el código de la cotización (COT que la IA generó desde el chat),
    // si existe, para mostrarla en el panel. cotizacionId es un Int suelto (sin
    // relación Prisma), así que se resuelve con una consulta secundaria.
    const cotizacionIds = prospectos
      .map((p) => p.cotizacionId)
      .filter((id): id is number => id != null);
    const cotizaciones = cotizacionIds.length
      ? await this.prisma.comprobante.findMany({
          where: { id: { in: cotizacionIds }, empresaId },
          select: { id: true, serie: true, correlativo: true },
        })
      : [];
    const codigoPorId = new Map(
      cotizaciones.map((c) => [
        c.id,
        `${c.serie}-${String(c.correlativo).padStart(8, '0')}`,
      ]),
    );

    return prospectos.map((p) => ({
      ...p,
      cotizacion:
        p.cotizacionId && codigoPorId.has(p.cotizacionId)
          ? { id: p.cotizacionId, codigo: codigoPorId.get(p.cotizacionId)! }
          : null,
    }));
  }

  /** Resumen por estado (para las tarjetas del dashboard). */
  async resumenProspectos(empresaId: number) {
    const grupos = await this.prisma.leadProspecto.groupBy({
      by: ['estado'],
      where: { empresaId },
      _count: { _all: true },
    });
    const base: Record<string, number> = {
      FRIO: 0,
      TIBIO: 0,
      CALIENTE: 0,
      CONVERTIDO: 0,
      PERDIDO: 0,
    };
    for (const g of grupos) base[g.estado] = g._count._all;
    return base;
  }

  /** Lista de conversaciones (chats) de la empresa. */
  async listarConversaciones(empresaId: number) {
    return this.prisma.leadConversacion.findMany({
      where: { empresaId },
      orderBy: { actualizadoEn: 'desc' },
      take: 200,
      include: { prospecto: { select: { puntaje: true, estado: true } } },
    });
  }

  /** Detalle de una conversación con sus mensajes. */
  async obtenerConversacion(empresaId: number, id: number) {
    const conv = await this.prisma.leadConversacion.findFirst({
      where: { id, empresaId },
      include: {
        mensajes: { orderBy: { creadoEn: 'asc' } },
        prospecto: true,
      },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    return conv;
  }

  /**
   * Borra una conversación entera: mensajes, prospecto, borrador y rastros.
   *
   * Existe para poder PROBAR. El empresario y su equipo prueban la IA
   * escribiéndole como clientes, y hasta ahora cada prueba quedaba pegada
   * para siempre: la siguiente arrancaba con el historial de la anterior, así
   * que no se podía volver a ver el primer saludo ni repetir un flujo desde
   * cero. Borrar el chat es lo que permite probar el mismo caso dos veces.
   *
   * Mensajes, prospecto, borrador y el historial de etapas se van solos por
   * las claves foráneas. Las otras tres NO: `LeadDisparo`,
   * `LeadComprobantePago` y `LeadConsulta` guardan el `conversacionId` sin
   * clave foránea, así que sin borrarlas a mano quedarían apuntando a una
   * conversación que ya no existe — y siguen saliendo en los reportes de
   * consultas no habidas, en los disparadores pendientes y en los
   * comprobantes por validar.
   */
  async eliminarConversacion(empresaId: number, id: number) {
    // El `empresaId` del token, no el del cuerpo: sin esto, cualquier empresa
    // podría borrarle las conversaciones a otra sabiendo un id.
    const conv = await this.prisma.leadConversacion.findFirst({
      where: { id, empresaId },
      select: { id: true, telefonoProspecto: true, cantidadMensajes: true },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');

    const [disparos, pagos, consultas] = await this.prisma.$transaction([
      this.prisma.leadDisparo.deleteMany({
        where: { empresaId, conversacionId: id },
      }),
      this.prisma.leadComprobantePago.deleteMany({
        where: { empresaId, conversacionId: id },
      }),
      this.prisma.leadConsulta.deleteMany({
        where: { empresaId, conversacionId: id },
      }),
      this.prisma.leadConversacion.delete({ where: { id } }),
    ]);

    this.logger.log(
      `Lead: conversación ${id} (${conv.telefonoProspecto}) borrada por la empresa ${empresaId}.`,
    );
    return {
      eliminada: true,
      telefono: conv.telefonoProspecto,
      mensajes: conv.cantidadMensajes,
      disparos: disparos.count,
      comprobantes: pagos.count,
      consultas: consultas.count,
    };
  }

  /**
   * Sube el video de bienvenida a S3 y lo deja configurado. WhatsApp solo
   * acepta MP4 de hasta 16 MB; se valida acá para no guardar un enlace que
   * después falla en cada conversación sin que nadie lo vea.
   */
  async subirVideoBienvenida(
    empresaId: number,
    archivo: { buffer: Buffer; mimetype: string; size: number },
  ) {
    if (!archivo?.buffer?.length) throw new BadRequestException('Falta el archivo de video.');
    if (archivo.mimetype !== 'video/mp4') {
      throw new BadRequestException('El video tiene que ser MP4.');
    }
    if (archivo.size > 16 * 1024 * 1024) {
      throw new BadRequestException('WhatsApp acepta videos de hasta 16 MB.');
    }
    if (!this.s3) throw new BadRequestException('El almacenamiento no está disponible.');
    const url = await this.s3.uploadPDF(
      archivo.buffer,
      `ia-ventas/empresa-${empresaId}/video-bienvenida-${Date.now()}.mp4`,
      'video/mp4',
    );
    await this.actualizarConfig(empresaId, { videoBienvenidaUrl: url });
    return { videoBienvenidaUrl: url };
  }

  /** Configuración de la IA de ventas de la empresa (toggle + contexto). */
  async obtenerConfig(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        iaVentasActiva: true,
        iaVentasContexto: true,
        iaVentasSeguimiento: true,
        iaVentasCotizacion: true,
        iaVentasBrochureUrl: true,
      },
    });
    return {
      iaVentasActiva: empresa?.iaVentasActiva ?? false,
      iaVentasContexto: empresa?.iaVentasContexto ?? '',
      iaVentasSeguimiento: empresa?.iaVentasSeguimiento ?? true,
      iaVentasCotizacion: empresa?.iaVentasCotizacion ?? false,
      iaVentasBrochureUrl: empresa?.iaVentasBrochureUrl ?? '',
    };
  }

  /** Actualiza el toggle y/o el contexto de negocio de la IA de ventas. */
  async actualizarConfig(
    empresaId: number,
    data: {
      iaVentasActiva?: boolean;
      iaVentasContexto?: string;
      iaVentasSeguimiento?: boolean;
      iaVentasCotizacion?: boolean;
      iaVentasBrochureUrl?: string;
      /** Nombre con el que se presenta el asesor ("Nicky"). Vacío = sin nombre. */
      asesor?: string;
      /** URL del video de bienvenida. Vacío = sin video. */
      videoBienvenidaUrl?: string;
    },
  ) {
    // El nombre del asesor vive en iaVentasConfigJson junto a zonas, descuentos
    // y avisos: se mezcla para no pisar lo demás. Antes no había forma de
    // cambiarlo sin tocar la base.
    if (data.asesor !== undefined || data.videoBienvenidaUrl !== undefined) {
      const actual = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { iaVentasConfigJson: true },
      });
      const json = { ...((actual?.iaVentasConfigJson as Record<string, unknown>) ?? {}) };
      if (data.asesor !== undefined) {
        const nombre = data.asesor.trim().slice(0, 40);
        if (nombre) json.asesor = nombre;
        else delete json.asesor;
      }
      if (data.videoBienvenidaUrl !== undefined) {
        const url = data.videoBienvenidaUrl.trim();
        if (url) json.videoBienvenidaUrl = url;
        else delete json.videoBienvenidaUrl;
      }
      await this.prisma.empresa.update({
        where: { id: empresaId },
        data: { iaVentasConfigJson: json as never },
      });
    }
    const empresa = await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        ...(data.iaVentasActiva !== undefined
          ? { iaVentasActiva: data.iaVentasActiva }
          : {}),
        ...(data.iaVentasContexto !== undefined
          ? { iaVentasContexto: data.iaVentasContexto }
          : {}),
        ...(data.iaVentasSeguimiento !== undefined
          ? { iaVentasSeguimiento: data.iaVentasSeguimiento }
          : {}),
        ...(data.iaVentasCotizacion !== undefined
          ? { iaVentasCotizacion: data.iaVentasCotizacion }
          : {}),
        ...(data.iaVentasBrochureUrl !== undefined
          ? { iaVentasBrochureUrl: data.iaVentasBrochureUrl.trim() || null }
          : {}),
      },
      select: {
        iaVentasActiva: true,
        iaVentasContexto: true,
        iaVentasSeguimiento: true,
        iaVentasCotizacion: true,
        iaVentasBrochureUrl: true,
      },
    });
    return {
      iaVentasActiva: empresa.iaVentasActiva,
      iaVentasContexto: empresa.iaVentasContexto ?? '',
      iaVentasSeguimiento: empresa.iaVentasSeguimiento,
      iaVentasCotizacion: empresa.iaVentasCotizacion,
      iaVentasBrochureUrl: empresa.iaVentasBrochureUrl ?? '',
    };
  }

  /** Activa/desactiva el bot para un prospecto (pausar la IA en ese chat). */
  async setBotActivo(empresaId: number, prospectoId: number, activo: boolean) {
    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { id: prospectoId, empresaId },
      select: { id: true, conversacionId: true },
    });
    if (!prospecto) throw new NotFoundException('Prospecto no encontrado');
    return this.pausarConversacion(
      empresaId,
      prospecto.conversacionId,
      activo,
      'apagado desde el panel',
    );
  }

  /**
   * Tomar (o devolver) el chat por conversación.
   *
   * Es la vía general: la pausa es de la CONVERSACIÓN, no del prospecto. Los
   * chats de prueba del propio negocio no generan prospecto a propósito —para
   * que no ensucien el embudo, ver numeros-internos.ts— y durante un tiempo
   * fueron los únicos chats donde no se podía apagar la IA. Justo los que usa
   * el dueño para probar.
   *
   * Cuando SÍ hay prospecto se escribe también ahí: su `botActivo` es lo que
   * pinta "IA en pausa" en la tarjeta del embudo y en la lista.
   */
  async pausarConversacion(
    empresaId: number,
    conversacionId: number,
    activo: boolean,
    motivo = 'apagado desde el panel',
  ) {
    const conv = await this.prisma.leadConversacion.findFirst({
      where: { id: conversacionId, empresaId },
      select: { id: true, prospecto: { select: { id: true } } },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');

    // Encender a mano limpia cualquier pausa; apagar a mano es deliberado y
    // no vence solo.
    const data = {
      botActivo: activo,
      pausadoHasta: null,
      motivoPausa: activo ? null : motivo,
    };

    const [conversacion] = await this.prisma.$transaction([
      this.prisma.leadConversacion.update({ where: { id: conv.id }, data }),
      ...(conv.prospecto
        ? [
            this.prisma.leadProspecto.update({
              where: { id: conv.prospecto.id },
              data,
            }),
          ]
        : []),
    ]);
    return conversacion;
  }

  /**
   * Envía al prospecto un mensaje escrito a mano por el vendedor, desde el
   * WhatsApp de la empresa, y lo deja en el historial del chat.
   *
   * Hasta ahora el panel solo permitía LEER la conversación y pausar la IA: para
   * responder había que salir a WhatsApp, lo que es imposible si el número se
   * migró a la Cloud API y la app del celular dejó de funcionar.
   *
   * Tomar el chat a mano pausa la IA automáticamente — si el humano ya contestó,
   * el bot no debe contestar encima.
   */
  async enviarMensajeManual(
    empresaId: number,
    conversacionId: number,
    texto: string,
  ) {
    const contenido = (texto || '').trim();
    if (!contenido) throw new BadRequestException('El mensaje está vacío');
    if (contenido.length > LIMITE_TEXTO_WHATSAPP)
      throw new BadRequestException(
        `El mensaje supera los ${LIMITE_TEXTO_WHATSAPP} caracteres que admite WhatsApp`,
      );

    const conv = await this.prisma.leadConversacion.findFirst({
      where: { id: conversacionId, empresaId },
      select: {
        id: true,
        telefonoProspecto: true,
        botActivo: true,
        prospecto: { select: { id: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');

    const envio = await this.whatsapp.enviarTexto(
      conv.telefonoProspecto,
      contenido,
      empresaId,
    );
    if (!envio.success)
      throw new BadRequestException(
        envio.error || 'No se pudo enviar el mensaje por WhatsApp',
      );

    // Solo se persiste lo que SÍ salió: un mensaje en el historial que el
    // prospecto nunca recibió desorienta al vendedor y, al reactivar la IA,
    // también a la IA (el historial es su contexto).
    const mensaje = await this.prisma.leadMensaje.create({
      data: { conversacionId: conv.id, rol: 'SISTEMA', contenido },
    });
    await this.prisma.leadConversacion.update({
      where: { id: conv.id },
      data: { cantidadMensajes: { increment: 1 } },
    });

    // Idempotente: si el vendedor ya había tomado el chat, no se reescribe.
    let botPausado = false;
    if (conv.botActivo) {
      // Vence sola: una pausa permanente convertía cada respuesta manual en
      // un bot apagado para siempre en esa conversación.
      const data = {
        botActivo: false,
        pausadoHasta: venceEn(),
        motivoPausa: 'respuesta manual',
      };
      await this.prisma.$transaction([
        this.prisma.leadConversacion.update({ where: { id: conv.id }, data }),
        ...(conv.prospecto
          ? [
              this.prisma.leadProspecto.update({
                where: { id: conv.prospecto.id },
                data,
              }),
            ]
          : []),
      ]);
      botPausado = true;
    }

    return { mensaje, botPausado };
  }
}
