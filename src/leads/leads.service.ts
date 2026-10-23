import {
  MEDIOS_DE_ANTES,
  envioValido,
  mediosPagoValidos,
  perfilValido,
  textoMediosPago,
} from './perfil-vendedor';
import { demosValidas, type ConfigDemos } from './demos';
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

/** Lo que acepta el chat del panel; WhatsApp recibe hasta 5 MB y se reduce antes. */
const LIMITE_IMAGEN_PANEL = 10 * 1024 * 1024;
/** WhatsApp acepta audios de hasta 16 MB. */
const LIMITE_AUDIO_PANEL = 16 * 1024 * 1024;
import { venceEn } from './pausa-bot';
import sharp from 'sharp';
import { IaVentasService } from './leads-ia.service';
import { aOggOpus, tieneAudio } from './nota-de-voz';

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
    @Optional() private readonly ia?: IaVentasService,
    // Inyectable para las pruebas: en producción es el ffmpeg de verdad.
    @Optional() private readonly convertirAudio: (b: Buffer) => Promise<Buffer> = aOggOpus,
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
      include: {
        // El último anuncio de Facebook/Instagram por el que llegó, para que
        // el vendedor sepa qué vio el cliente antes de escribir.
        conversacion: {
          select: {
            anuncios: {
              orderBy: { creadoEn: 'desc' },
              take: 1,
              select: { anuncioId: true, tipo: true, titulo: true, texto: true, url: true, creadoEn: true },
            },
          },
        },
      },
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

    return prospectos.map(({ conversacion, ...p }) => ({
      ...p,
      anuncio: conversacion?.anuncios[0] ?? null,
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
        iaVentasConfigJson: true,
        mpConectado: true,
      },
    });
    const json = empresa?.iaVentasConfigJson as
      | {
          demos?: ConfigDemos;
          cobroConLink?: boolean;
          asesor?: string;
          vendedor?: unknown;
          envio?: unknown;
          mediosPago?: string;
          mediosPagoLista?: unknown;
          supervisorTelefono?: string;
        }
      | null;
    const demos = json?.demos;
    // Medios de pago escritos a mano antes de que existiera la lista: se
    // muestran como uno solo para que el dueño los vea y los ordene.
    const mediosPagoLista = mediosPagoValidos(json?.mediosPagoLista);
    return {
      iaVentasActiva: empresa?.iaVentasActiva ?? false,
      iaVentasContexto: empresa?.iaVentasContexto ?? '',
      iaVentasSeguimiento: empresa?.iaVentasSeguimiento ?? true,
      iaVentasCotizacion: empresa?.iaVentasCotizacion ?? false,
      iaVentasBrochureUrl: empresa?.iaVentasBrochureUrl ?? '',
      // El panel muestra la pestaña "Demos" solo a quien las entrega.
      tieneDemos: Boolean(demos?.cuentas?.length),
      // El link de pago solo cobra con el Mercado Pago del negocio conectado.
      cobroConLink: json?.cobroConLink === true,
      mpConectado: empresa?.mpConectado ?? false,
      // "Mi vendedor". Que estas claves vengan es lo que le dice al panel que
      // el servidor ya entiende la pantalla nueva.
      asesor: json?.asesor ?? '',
      vendedor: perfilValido(json?.vendedor),
      envio: envioValido(json?.envio),
      mediosPagoLista:
        mediosPagoLista.length || !json?.mediosPago
          ? mediosPagoLista
          : [{ nombre: MEDIOS_DE_ANTES, detalle: json.mediosPago }],
      supervisorTelefono: json?.supervisorTelefono ?? '',
    };
  }

  /**
   * El banco de prospectos que pidieron demo, el más reciente primero, con
   * cómo va el seguimiento: si ya se le preguntó qué le pareció y si
   * contestó. Es la lista que usan los vendedores para llamar.
   */
  async listarDemos(empresaId: number) {
    const demos = await this.prisma.leadDemo.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
      take: 500,
    });
    if (!demos.length) return [];
    const telefonos = demos.map((d) => d.telefono);
    const [seguimientos, conversaciones] = await Promise.all([
      this.prisma.leadDisparo.findMany({
        where: {
          empresaId,
          tipo: 'SEGUIMIENTO_DEMO' as never,
          referencia: { in: demos.map((d) => `demo:${d.id}`) },
        },
        select: {
          referencia: true,
          estado: true,
          programadoPara: true,
          enviadoEn: true,
          motivo: true,
        },
      }),
      this.prisma.leadConversacion.findMany({
        where: { empresaId, telefonoProspecto: { in: telefonos } },
        select: {
          telefonoProspecto: true,
          mensajes: {
            where: { rol: 'USUARIO' },
            orderBy: { creadoEn: 'desc' },
            take: 1,
            select: { creadoEn: true },
          },
        },
      }),
    ]);
    const seguimientoDe = new Map(seguimientos.map((s) => [s.referencia, s]));
    const ultimoDe = new Map(
      conversaciones.map((c) => [
        c.telefonoProspecto,
        c.mensajes[0]?.creadoEn ?? null,
      ]),
    );
    return demos.map((d) => {
      const seguimiento = seguimientoDe.get(`demo:${d.id}`) ?? null;
      const ultimoMensajeEn = ultimoDe.get(d.telefono) ?? null;
      return {
        ...d,
        ultimoMensajeEn,
        seguimiento,
        // Contestó al "¿qué tal te pareció?": escribió después de que salió.
        respondioSeguimiento: Boolean(
          seguimiento?.enviadoEn &&
            ultimoMensajeEn &&
            ultimoMensajeEn > seguimiento.enviadoEn,
        ),
      };
    });
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
      /** Demos por rubro que entrega la IA. null = sin demos. */
      demos?: ConfigDemos | null;
      /** Ofrecer el link de Mercado Pago para pagar lo cotizado. */
      cobroConLink?: boolean;
      /** "Mi vendedor": tono, reglas, saludo y temas. */
      vendedor?: unknown;
      /** Zonas de envío y tarifas, como las edita el panel. */
      envio?: unknown;
      /** Medios de pago (Yape, BCP…) con su titular. */
      mediosPagoLista?: unknown;
      /** A quién le llegan por WhatsApp los avisos de derivación y de demo. Vacío = a los administradores. */
      supervisorTelefono?: string;
    },
  ) {
    // El nombre del asesor vive en iaVentasConfigJson junto a zonas, descuentos
    // y avisos: se mezcla para no pisar lo demás. Antes no había forma de
    // cambiarlo sin tocar la base.
    if (
      data.asesor !== undefined ||
      data.videoBienvenidaUrl !== undefined ||
      data.demos !== undefined ||
      data.cobroConLink !== undefined ||
      data.vendedor !== undefined ||
      data.envio !== undefined ||
      data.mediosPagoLista !== undefined ||
      data.supervisorTelefono !== undefined
    ) {
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
      if (data.demos !== undefined) {
        if (data.demos === null) delete json.demos;
        else json.demos = demosValidas(data.demos);
      }
      if (data.cobroConLink !== undefined) {
        if (data.cobroConLink === true) json.cobroConLink = true;
        else delete json.cobroConLink;
      }
      if (data.vendedor !== undefined) {
        const perfil = perfilValido(data.vendedor);
        if (Object.keys(perfil).length) json.vendedor = perfil;
        else delete json.vendedor;
      }
      if (data.envio !== undefined) {
        // Sin zonas se borra entera: vacío es "sin configurar", y el flujo
        // deriva a una persona en vez de cotizar un envío inventado.
        const envio = envioValido(data.envio);
        if (envio.zonas.length) json.envio = envio;
        else delete json.envio;
      }
      if (data.mediosPagoLista !== undefined) {
        // La lista es lo que edita el panel; el texto es lo que ya leen el
        // flujo del pedido y la verificación de vouchers. Se guardan juntos.
        const medios = mediosPagoValidos(data.mediosPagoLista);
        if (medios.length) {
          json.mediosPagoLista = medios;
          json.mediosPago = textoMediosPago(medios);
        } else {
          delete json.mediosPagoLista;
          delete json.mediosPago;
        }
      }
      if (data.supervisorTelefono !== undefined) {
        // Sin él los avisos van a los administradores. En Krezka eso era el
        // celular de postventa, y ventas no se enteraba de los chats que la
        // IA le pasaba.
        const tel = String(data.supervisorTelefono).replace(/\D/g, '');
        if (!tel) delete json.supervisorTelefono;
        else if (tel.length < 9)
          throw new BadRequestException('El número de aviso debe tener 9 dígitos');
        else json.supervisorTelefono = tel;
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
    // La configuración completa, no solo lo tocado: el panel reemplaza la
    // suya con esto, y sin `tieneDemos` la pestaña Demos desaparecía al
    // guardar hasta recargar.
    return {
      ...(await this.obtenerConfig(empresaId)),
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

    const botPausado = await this.tomarChat(conv);
    return { mensaje, botPausado };
  }

  /**
   * Manda una imagen al prospecto desde el chat del panel: la foto de un
   * producto que no la tiene en el catálogo, una captura, lo que haga falta.
   *
   * El vendedor de Hierba Sana no tenía cómo: el cliente pedía ver lo que iba
   * a recibir, el producto no tenía foto, y desde el panel solo salía texto
   * (20-10). Como el texto, deja el mensaje en el historial y toma el chat.
   *
   * Va a JPG antes de subir: WhatsApp solo acepta JPG y PNG por enlace, y una
   * foto de celular puede llegar en HEIC o WEBP, o girada.
   */
  async enviarImagenManual(
    empresaId: number,
    conversacionId: number,
    archivo: { buffer: Buffer; mimetype: string; size: number } | undefined,
    texto?: string,
  ) {
    if (!archivo?.buffer?.length) throw new BadRequestException('Falta la imagen.');
    if (!/^image\//.test(archivo.mimetype)) {
      throw new BadRequestException('El archivo tiene que ser una imagen.');
    }
    if (archivo.size > LIMITE_IMAGEN_PANEL) {
      throw new BadRequestException('La imagen pesa más de 10 MB.');
    }
    const pie = (texto || '').trim();
    // El pie de una imagen en WhatsApp tiene su propio tope, más corto.
    if (pie.length > 1024) {
      throw new BadRequestException('El texto de la imagen supera los 1024 caracteres.');
    }
    if (!this.s3) throw new BadRequestException('El almacenamiento no está disponible.');

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

    let jpg: Buffer;
    try {
      jpg = await sharp(archivo.buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch {
      throw new BadRequestException('No se pudo leer la imagen. Prueba con una foto JPG o PNG.');
    }
    const url = await this.s3.uploadPDF(
      jpg,
      `ia-ventas/empresa-${empresaId}/chat/${conv.id}-${Date.now()}.jpg`,
      'image/jpeg',
    );

    const envio = await this.whatsapp.enviarImagenUrl(
      conv.telefonoProspecto,
      url,
      pie || undefined,
      empresaId,
    );
    if (!envio.success)
      throw new BadRequestException(
        envio.error || 'No se pudo enviar la imagen por WhatsApp',
      );

    const mensaje = await this.prisma.leadMensaje.create({
      data: {
        conversacionId: conv.id,
        rol: 'SISTEMA',
        // El historial es también el contexto de la IA, que lee texto: sin
        // esto, al reactivarla no sabría que el cliente ya vio la foto.
        contenido: pie ? `📷 [Imagen] ${pie}` : '📷 [Imagen]',
        imagenUrl: url,
      },
    });
    await this.prisma.leadConversacion.update({
      where: { id: conv.id },
      data: { cantidadMensajes: { increment: 1 } },
    });

    const botPausado = await this.tomarChat(conv);
    return { mensaje, botPausado };
  }

  /**
   * Manda una nota de voz al prospecto desde el chat del panel.
   *
   * Al vendedor le es más rápido hablar que escribir una explicación larga
   * (cómo se toma un producto, por qué conviene otro). Va a OGG/Opus para que
   * WhatsApp la muestre como nota de voz. Se transcribe para el historial: la
   * IA solo lee texto y, al reactivarla, tiene que saber qué se le dijo.
   */
  async enviarAudioManual(
    empresaId: number,
    conversacionId: number,
    archivo: { buffer: Buffer; mimetype: string; size: number } | undefined,
    duracion?: number,
  ) {
    if (!archivo?.buffer?.length) throw new BadRequestException('Falta el audio.');
    // Algunos navegadores mandan la grabación como video/webm (sin imagen).
    if (!/^(audio\/|video\/webm)/.test(archivo.mimetype)) {
      throw new BadRequestException('El archivo tiene que ser un audio.');
    }
    if (archivo.size > LIMITE_AUDIO_PANEL) {
      throw new BadRequestException('El audio pesa más de 16 MB.');
    }
    if (!this.s3) throw new BadRequestException('El almacenamiento no está disponible.');

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

    let ogg: Buffer;
    try {
      ogg = await this.convertirAudio(archivo.buffer);
    } catch {
      throw new BadRequestException('No se pudo leer el audio. Vuelve a grabarlo.');
    }
    if (!tieneAudio(ogg)) {
      throw new BadRequestException(
        'La grabación salió sin sonido: el micrófono no captó nada. Revisa que el micrófono esté activo y vuelve a grabarla.',
      );
    }
    const url = await this.s3.uploadPDF(
      ogg,
      `ia-ventas/empresa-${empresaId}/chat/${conv.id}-${Date.now()}.ogg`,
      'audio/ogg',
    );

    const envio = await this.whatsapp.enviarAudio(conv.telefonoProspecto, ogg, empresaId);
    if (!envio.success)
      throw new BadRequestException(
        envio.error || 'No se pudo enviar la nota de voz por WhatsApp',
      );

    // La transcripción es un extra: si falla, la nota ya salió y queda igual.
    let transcripcion = '';
    if (this.ia?.disponible()) {
      transcripcion = await this.ia
        .transcribirAudio(ogg, 'audio/ogg')
        .then((t) => (t || '').trim())
        .catch(() => '');
    }
    const segundos =
      Number.isFinite(Number(duracion)) && Number(duracion) > 0
        ? Math.round(Number(duracion))
        : null;

    const mensaje = await this.prisma.leadMensaje.create({
      data: {
        conversacionId: conv.id,
        rol: 'SISTEMA',
        contenido: transcripcion ? `[Nota de voz] ${transcripcion}` : '[Nota de voz]',
        audioUrl: url,
        esAudio: true,
      },
    });
    await this.prisma.leadConversacion.update({
      where: { id: conv.id },
      data: { cantidadMensajes: { increment: 1 } },
    });

    const botPausado = await this.tomarChat(conv);
    return { mensaje: { ...mensaje, ...(segundos ? { duracion: segundos } : {}) }, botPausado };
  }

  /**
   * Pausa la IA porque el vendedor respondió a mano. Devuelve si la pausó.
   * Idempotente: si el vendedor ya había tomado el chat, no se reescribe.
   */
  private async tomarChat(conv: {
    id: number;
    botActivo: boolean;
    prospecto: { id: number } | null;
  }): Promise<boolean> {
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
    return botPausado;
  }
}
