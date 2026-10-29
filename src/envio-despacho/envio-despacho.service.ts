import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEnvioDespachoDto,
  UpdateEnvioDespachoDto,
  EstadoDespacho,
  ExportarRepartoQueryDto,
} from './dto/envio-despacho.dto';
import * as XLSX from 'xlsx';
import { DespachoConfigDto } from './dto/despacho-config.dto';
import { RepartidorService } from '../repartidor/repartidor.service';
import {
  enlaceVigente,
  nuevoTokenDeEntrega,
  puedeMarcar,
} from './acceso-repartidor';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { planPermiteShalomPro } from '../shalom/shalom.util';
import { parseFechaSoloDia } from '../common/utils/fecha';
import { ModuleRef } from '@nestjs/core';
import { PagoService } from '../pago/pago.service';
import { LeadsEmbudoService } from '../leads/leads-embudo.service';
import { formasDePagoParaElAviso } from './pago-repartidor';
import {
  llegadaAAgencia,
  quienReparte,
  saldoParaRetirar,
  textoDePlantilla,
  mensajePropio,
  tocaRecordatorioRecojo,
  ultimos9,
} from './recojo-agencia';

/** Mensaje que saldría al cliente, armado sin enviarlo (vista previa). */
type MensajeArmado = { telefono: string; texto: string };

const ESTADOS_NOTIFICABLES = new Set([
  EstadoDespacho.EN_CAMINO,
  EstadoDespacho.EN_AGENCIA,
  EstadoDespacho.ENTREGADO,
]);

const MENSAJES_DEFAULT: Record<string, string> = {
  EN_CAMINO:
    'Hola {{nombre}}, tu pedido {{pedido}} ya está en camino 🚚. Repartidor: {{repartidor}}.',
  ENTREGADO:
    'Hola {{nombre}}, tu pedido {{pedido}} fue entregado exitosamente ✅. ¡Gracias por preferir {{empresa}}!',
  EN_AGENCIA:
    'Hola {{nombre}}, tu pedido {{pedido}} ya llegó a {{agencia}} 📦. Ya puedes acercarte a recogerlo.',
};

const DESPACHO_FIELDS = [
  'transportista',
  'codigoGuia',
  'observaciones',
  'direccionDestino',
  'tipoEnvio',
  'agenciaDestino',
  'celularDest',
  'nroPaquetes',
  'turnoEnvio',
  'tipoMercaderia',
  'claveEnvio',
  'nroOrden',
  'claveOrden',
  'establecimiento',
  'empaquetador',
  'nombreDestinatario',
  'dniDestinatario',
  'contenidoPaquete',
  'shalomTipoProducto',
  'shalomAgenciaDestinoId',
  'pesoKg',
  'montoCOD',
  'costoEnvio',
  'costoCourier',
  'pagarFlete',
  'aplicacionMontoCliente',
  // Reparto propio / motorizado externo
  'tipoVentaReparto',
  'distritoUbigeo',
  'distrito',
  'coordenadas',
  'formaPagoCobro',
  'revisarProducto',
] as const;

const DESPACHO_TO_PEDIDO_ESTADO: Record<
  EstadoDespacho,
  { estadoEntrega: string; estadoEnvio: string }
> = {
  [EstadoDespacho.PREPARANDO]: {
    estadoEntrega: 'CONFIRMADO',
    estadoEnvio: 'POR_COORDINAR',
  },
  [EstadoDespacho.EN_CAMINO]: {
    estadoEntrega: 'EN_TRANSITO',
    estadoEnvio: 'EN_REPARTO',
  },
  [EstadoDespacho.EN_AGENCIA]: {
    estadoEntrega: 'EN_AGENCIA',
    estadoEnvio: 'ENVIADO',
  },
  [EstadoDespacho.EN_DESTINO]: {
    estadoEntrega: 'EN_TRANSITO',
    estadoEnvio: 'EN_REPARTO',
  },
  [EstadoDespacho.ENTREGADO]: {
    estadoEntrega: 'ENTREGADO_COMPLETADO',
    estadoEnvio: 'ENTREGADO',
  },
  [EstadoDespacho.DEVUELTO]: {
    estadoEntrega: 'PENDIENTE',
    estadoEnvio: 'INCIDENCIA',
  },
};

@Injectable()
export class EnvioDespachoService {
  private readonly logger = new Logger(EnvioDespachoService.name);

  constructor(
    private prisma: PrismaService,
    private repartidorService: RepartidorService,
    private whatsapp: WhatsAppService,
    private pagos: PagoService,
    // El embudo de la IA de Ventas vive en LeadsModule, que ya importa este
    // módulo. Se resuelve en tiempo de ejecución para no cerrar el ciclo.
    private moduleRef: ModuleRef,
  ) {}

  async getByComprobante(comprobanteId: number, empresaId: number) {
    await this.validateComprobante(comprobanteId, empresaId);
    const envio = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId },
      include: {
        repartidor: true,
        // La prueba de entrega viaja con el despacho: quien abre la ficha por
        // un reclamo la necesita ahí mismo, no en otra pestaña.
        evidencias: {
          where: { anuladaEn: null },
          orderBy: { tomadaEn: 'asc' },
          select: {
            id: true,
            url: true,
            tipo: true,
            nota: true,
            tomadaEn: true,
            usuarioNombre: true,
          },
        },
        // Sede desde la que sale el pedido: el reparto propio la muestra y la
        // exporta como origen (no es editable, es la del comprobante).
        comprobante: {
          select: { sedeId: true, sede: { select: { id: true, nombre: true } } },
        },
      },
    });
    if (!envio) return null;
    const { comprobante, ...rest } = envio as any;
    return this.withLegacyRepartidor({
      ...rest,
      sedeOrigenId: comprobante?.sedeId ?? null,
      sedeOrigenNombre: comprobante?.sede?.nombre ?? null,
    });
  }

  async create(
    comprobanteId: number,
    empresaId: number,
    dto: CreateEnvioDespachoDto,
    usuarioId?: number,
  ) {
    const comprobante = await this.validateComprobante(
      comprobanteId,
      empresaId,
    );
    const existing = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId },
    });
    if (existing)
      throw new BadRequestException(
        'Este comprobante ya tiene un seguimiento de despacho.',
      );
    // Ya viaja en el paquete de otra nota: un segundo despacho sería un
    // segundo envío (y una segunda guía de courier) por la misma mercadería.
    const agrupada = await this.prisma.envioDespachoNota.findUnique({
      where: { comprobanteId },
      select: { despacho: { select: { comprobante: { select: { serie: true, correlativo: true } } } } },
    });
    if (agrupada) {
      const c = agrupada.despacho.comprobante;
      throw new BadRequestException(
        `Esta nota ya va en el envío de ${c.serie}-${String(c.correlativo).padStart(8, '0')}. Edita ese envío.`,
      );
    }

    const estadoInicial: EstadoDespacho =
      dto.estado ?? EstadoDespacho.PREPARANDO;
    const usuarioNombre = await this.resolveUsuarioNombre(usuarioId);
    const historial = [
      {
        estado: estadoInicial,
        fecha: new Date().toISOString(),
        nota: 'Despacho creado',
        ...(usuarioId && { usuarioId, usuarioNombre }),
      },
    ];
    const repartidorId = await this.repartidorService.resolveForEmpresa(
      empresaId,
      {
        repartidorId: dto.repartidorId,
        repartidor: dto.repartidor,
        sedeId: comprobante.sedeId,
      },
    );

    const envio = await this.prisma.envioDespacho.create({
      data: {
        comprobanteId,
        estado: estadoInicial,
        // El enlace del repartidor nace con el despacho: así ya está listo
        // para mandárselo por WhatsApp sin un paso extra. Ver
        // `acceso-repartidor.ts`.
        accesoToken: nuevoTokenDeEntrega(),
        historial,
        direccionDestino:
          dto.direccionDestino ?? comprobante.cliente?.direccion ?? null,
        // Fecha "solo día": a mediodía UTC para que en Lima no se vea el día anterior.
        fechaEstimada: dto.fechaEstimada
          ? parseFechaSoloDia(dto.fechaEstimada)
          : null,
        ...(repartidorId !== undefined && { repartidorId }),
        ...this.pickFields(dto),
      },
      include: { repartidor: true },
    });
    await this.syncAdelantoDesdeEnvio(comprobanteId, empresaId, dto);
    await this.syncPedidoTiendaByComprobante(comprobanteId, estadoInicial);
    await this.backfillTelefonoCliente(
      comprobante.clienteId,
      comprobante.cliente?.telefono,
      dto.celularDest,
    );
    return this.withLegacyRepartidor(envio);
  }

  async upsert(
    comprobanteId: number,
    empresaId: number,
    dto: CreateEnvioDespachoDto,
    usuarioId?: number,
  ) {
    const existing = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId },
    });
    if (existing) return this.update(comprobanteId, empresaId, dto, usuarioId);
    return this.create(comprobanteId, empresaId, dto, usuarioId);
  }

  /**
   * Un solo envío para varias notas del mismo cliente: el despacho vive en la
   * nota de `comprobanteId` y estas otras quedan enlazadas a él. No se crea
   * otro despacho ni otra guía: el paquete es uno.
   */
  async agregarNotas(comprobanteId: number, empresaId: number, ids: number[]) {
    await this.validateComprobante(comprobanteId, empresaId);
    const principal = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      select: { clienteId: true },
    });
    const despacho = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId },
      select: { id: true },
    });
    if (!despacho) throw new NotFoundException('Primero guarda el envío de esta nota.');
    const otras = [...new Set((ids ?? []).map(Number))].filter(
      (n) => Number.isInteger(n) && n > 0 && n !== comprobanteId,
    );
    if (!otras.length) return { despachoId: despacho.id, notas: [] };
    const notas = await this.prisma.comprobante.findMany({
      where: { id: { in: otras }, empresaId },
      select: {
        id: true, serie: true, correlativo: true, clienteId: true, estadoEnvioSunat: true,
        envioDespacho: { select: { id: true } },
        despachoAgrupado: { select: { despachoId: true } },
      },
    });
    if (notas.length !== otras.length) throw new NotFoundException('Alguna de las notas no existe');
    const doc = (n: { serie: string; correlativo: number }) => `${n.serie}-${n.correlativo}`;
    for (const n of notas) {
      if (n.estadoEnvioSunat === 'ANULADO') throw new BadRequestException(`${doc(n)} está anulada`);
      if (n.clienteId !== principal?.clienteId) {
        throw new BadRequestException('Un envío es para un solo cliente: las notas son de clientes distintos.');
      }
      if (n.envioDespacho) throw new BadRequestException(`${doc(n)} ya tiene su propio envío. Quítalo primero.`);
      if (n.despachoAgrupado && n.despachoAgrupado.despachoId !== despacho.id) {
        throw new BadRequestException(`${doc(n)} ya va en otro envío.`);
      }
    }
    await this.prisma.envioDespachoNota.createMany({
      data: notas.map((n) => ({ comprobanteId: n.id, despachoId: despacho.id })),
      skipDuplicates: true,
    });
    return { despachoId: despacho.id, notas: notas.map(doc) };
  }

  async update(
    comprobanteId: number,
    empresaId: number,
    dto: UpdateEnvioDespachoDto,
    usuarioId?: number,
  ) {
    const comprobante = await this.validateComprobante(
      comprobanteId,
      empresaId,
    );
    const envio = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId },
    });
    if (!envio)
      throw new NotFoundException(
        'No existe seguimiento de despacho para este comprobante.',
      );

    let historial: any[] = Array.isArray(envio.historial)
      ? (envio.historial as any[])
      : [];
    if (dto.estado && dto.estado !== envio.estado) {
      const usuarioNombre = await this.resolveUsuarioNombre(usuarioId);
      historial = [
        ...historial,
        {
          estado: dto.estado,
          fecha: new Date().toISOString(),
          nota: dto.observaciones ?? null,
          ...(usuarioId && { usuarioId, usuarioNombre }),
        },
      ];
    }
    const repartidorId = await this.repartidorService.resolveForEmpresa(
      empresaId,
      {
        repartidorId: dto.repartidorId,
        repartidor: dto.repartidor,
      },
    );

    const estadoCambia = dto.estado && dto.estado !== envio.estado;

    const updated = await this.prisma.envioDespacho.update({
      where: { comprobanteId },
      data: {
        ...(dto.estado !== undefined && { estado: dto.estado as any }),
        // La hora de la entrega se sella cuando pasa a ENTREGADO: el reclamo
        // "no me llegó" siempre se discute con una fecha, y dentro del
        // historial Json no se puede filtrar ni ordenar.
        ...(estadoCambia &&
          dto.estado === EstadoDespacho.ENTREGADO && {
            entregadoEn: new Date(),
          }),
        // Cada llegada a la agencia es una estadía nueva: los recordatorios
        // de recojo vuelven a contar desde cero.
        ...(estadoCambia &&
          dto.estado === EstadoDespacho.EN_AGENCIA && {
            recordatoriosRecojo: 0,
            ultimoRecordatorioRecojoEn: null,
          }),
        ...(dto.fechaEstimada !== undefined && {
          fechaEstimada: parseFechaSoloDia(dto.fechaEstimada),
        }),
        ...(repartidorId !== undefined && { repartidorId }),
        historial,
        ...this.pickFields(dto),
      },
      include: { repartidor: true },
    });

    await this.syncAdelantoDesdeEnvio(comprobanteId, empresaId, dto);
    await this.backfillTelefonoCliente(
      comprobante.clienteId,
      comprobante.cliente?.telefono,
      dto.celularDest,
    );
    if (dto.actualizarFichaCliente) {
      await this.completarFichaCliente(
        comprobante.clienteId,
        empresaId,
        dto.dniDestinatario,
        dto.nombreDestinatario,
        dto.celularDest,
      );
    }

    if (
      estadoCambia &&
      dto.notificar !== false &&
      ESTADOS_NOTIFICABLES.has(dto.estado as EstadoDespacho)
    ) {
      this.notificarCambioEstado(
        comprobanteId,
        empresaId,
        dto.estado as EstadoDespacho,
        updated.repartidor ?? null,
      ).catch((e) => this.logger.warn(`WA despacho fallido: ${e.message}`));
    }

    if (estadoCambia) {
      await this.syncPedidoTiendaByComprobante(
        comprobanteId,
        dto.estado as EstadoDespacho,
      );
      await this.sincronizarEmbudo(empresaId, comprobanteId, dto.estado!);
    }

    return this.withLegacyRepartidor(updated);
  }

  /**
   * La automatización de despacho (rastreo automático + plantillas de WhatsApp)
   * tiene la característica `tieneShalomGuias`. El resto ve la configuración, pero no la
   * puede modificar: el candado se aplica acá, no solo en la UI.
   */
  private async validarPlanAutomatizacion(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        plan: {
          select: {
            nombre: true,
            features: { select: { featureKey: true, enabled: true } },
          },
        },
      },
    });
    if (!planPermiteShalomPro(empresa?.plan)) {
      throw new ForbiddenException(
        'Tu plan no incluye la automatización de despacho. Consulta con tu asesor para habilitarla.',
      );
    }
  }

  /**
   * Con Takiy los avisos salen desde el número del negocio y sin costo por
   * mensaje: escribir sus propios textos no depende del plan. El resto de la
   * automatización (recordatorios de recojo, formas de pago al repartidor,
   * rastreo Shalom) sigue siendo del plan.
   */
  private soloMensajes(dto: DespachoConfigDto): DespachoConfigDto {
    const { mensajeEnCamino, mensajeEntregado, mensajeEnAgencia, notificarEnCamino, notificarEntregado } = dto;
    return Object.fromEntries(
      Object.entries({ mensajeEnCamino, mensajeEntregado, mensajeEnAgencia, notificarEnCamino, notificarEntregado })
        .filter(([, v]) => v !== undefined),
    ) as DespachoConfigDto;
  }

  async getConfig(empresaId: number) {
    const [config, empresa] = await Promise.all([
      this.prisma.despachoMensajeTemplate.findUnique({ where: { empresaId } }),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: {
          shalomAutoTrackingActivo: true,
          takiyActivo: true,
          plan: {
            select: {
              nombre: true,
              features: { select: { featureKey: true, enabled: true } },
            },
          },
        },
      }),
    ]);
    const base = config ?? {
      empresaId,
      mensajeEnCamino: MENSAJES_DEFAULT.EN_CAMINO,
      mensajeEntregado: MENSAJES_DEFAULT.ENTREGADO,
      mensajeEnAgencia: MENSAJES_DEFAULT.EN_AGENCIA,
      notificarEnCamino: true,
      notificarEntregado: true,
      recordatorioRecojoDias: 0,
      pagoRepartidorPropio: null,
      pagoRepartidorContratado: null,
    };
    return {
      ...base,
      // Opt-in del rastreo automático Shalom (cron 30 min). Default false.
      shalomAutoTrackingActivo: empresa?.shalomAutoTrackingActivo ?? false,
      // El plan permite editar esta configuración (`tieneShalomGuias`).
      habilitadoPorPlan: planPermiteShalomPro(empresa?.plan),
      // Los textos por estado se editan con el plan o con Takiy activo.
      mensajesEditables: planPermiteShalomPro(empresa?.plan) || !!empresa?.takiyActivo,
    };
  }

  async upsertConfig(empresaId: number, dto: DespachoConfigDto) {
    try {
      await this.validarPlanAutomatizacion(empresaId);
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
      const takiy = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { takiyActivo: true },
      });
      if (!takiy?.takiyActivo) throw e;
      dto = this.soloMensajes(dto);
    }
    const guardado = await this.prisma.despachoMensajeTemplate.upsert({
      where: { empresaId },
      create: { empresaId, ...dto },
      update: dto,
    });
    // Las plantillas del recordatorio se agregaron después de que muchos
    // negocios conectaron su número: se dan de alta (idempotente) al
    // encenderlo, y Meta tarda un rato en aprobarlas.
    if ((dto.recordatorioRecojoDias ?? 0) > 0 || dto.pagoRepartidorPropio || dto.pagoRepartidorContratado) {
      const r = await this.whatsapp.crearPlantillasDespachoEmpresa(empresaId).catch((e) => ({
        creadas: [] as string[],
        existentes: [] as string[],
        errores: [String(e?.message ?? e)],
      }));
      return { ...guardado, plantillas: r };
    }
    return guardado;
  }

  /**
   * Activa/desactiva el rastreo automático Shalom para la empresa. Con `false`
   * (default) el cron de 30 min no actualiza estados ni envía WhatsApp a sus
   * clientes. Se activa recién cuando el empresario está avisado del automatismo.
   */
  async setAutoTracking(empresaId: number, activo: boolean) {
    await this.validarPlanAutomatizacion(empresaId);
    const empresa = await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { shalomAutoTrackingActivo: activo },
      select: { shalomAutoTrackingActivo: true },
    });
    return { shalomAutoTrackingActivo: empresa.shalomAutoTrackingActivo };
  }

  async remove(comprobanteId: number, empresaId: number) {
    await this.validateComprobante(comprobanteId, empresaId);
    await this.prisma.envioDespacho.delete({ where: { comprobanteId } });
  }

  async listByEmpresa(
    empresaId: number,
    params?: { estado?: string; page?: number; limit?: number },
  ) {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: any = {
      comprobante: {
        empresaId,
        // Una venta anulada ya no se despacha: fuera del panel, como en el
        // Excel de reparto (20-10: la NV que el cliente canceló seguía ahí
        // con "cobra S/ 22").
        estadoEnvioSunat: { not: 'ANULADO' as any },
        NOT: { estadoPago: 'ANULADO' as any },
      },
      ...(params?.estado ? { estado: params.estado } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.envioDespacho.findMany({
        where,
        skip,
        take: limit,
        orderBy: { creadoEn: 'desc' },
        include: {
          comprobante: {
            select: {
              id: true,
              serie: true,
              correlativo: true,
              tipoDoc: true,
              fechaEmision: true,
              mtoImpVenta: true,
              cliente: {
                select: {
                  id: true,
                  nombre: true,
                  nroDoc: true,
                  telefono: true,
                },
              },
              usuario: { select: { nombre: true } },
            },
          },
          repartidor: true,
        },
      }),
      this.prisma.envioDespacho.count({ where }),
    ]);

    return { data: items, total, page, totalPages: Math.ceil(total / limit) };
  }

  async panelUnificado(
    empresaId: number,
    params?: {
      fecha?: string;
      /** Día de ENTREGA programada. Ver nota abajo. */
      fechaEnvio?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 50;
    const skip = (page - 1) * limit;

    const fechaWhere = params?.fecha
      ? {
          gte: new Date(`${params.fecha}T00:00:00-05:00`),
          lte: new Date(`${params.fecha}T23:59:59-05:00`),
        }
      : undefined;

    // Filtro por día de ENTREGA: "qué sale el jueves" (pedido de COMERCIAL
    // LINNA MODA, que despacha por día). `fechaEstimada` se guarda a mediodía
    // UTC (parseFechaSoloDia), así que el rango va en UTC y no en hora de Lima:
    // con el offset -05:00 el mediodía UTC del día siguiente también entraría.
    const envioWhere = params?.fechaEnvio
      ? {
          gte: new Date(`${params.fechaEnvio}T00:00:00.000Z`),
          lte: new Date(`${params.fechaEnvio}T23:59:59.999Z`),
        }
      : undefined;

    // Un pedido que sale el jueves pudo tomarse el lunes: cuando se filtra por
    // día de entrega, el día de creación deja de acotar o no se vería.
    const filtroDespacho = envioWhere
      ? { fechaEstimada: envioWhere }
      : fechaWhere
        ? { creadoEn: fechaWhere }
        : {};

    const [despachos, pedidos] = await Promise.all([
      this.prisma.envioDespacho.findMany({
        where: {
          comprobante: {
            empresaId,
            // Una venta anulada ya no se despacha: fuera del panel, como en el
            // Excel de reparto (20-10: la NV que el cliente canceló seguía ahí
            // con "cobra S/ 22").
            estadoEnvioSunat: { not: 'ANULADO' as any },
            NOT: { estadoPago: 'ANULADO' as any },
          },
          ...filtroDespacho,
        },
        orderBy: { creadoEn: 'desc' },
        take: limit,
        skip,
        include: {
          comprobante: {
            select: {
              id: true,
              serie: true,
              correlativo: true,
              tipoDoc: true,
              fechaEmision: true,
              mtoImpVenta: true,
              adelanto: true,
              saldo: true,
              estadoPago: true,
              cliente: {
                select: { nombre: true, telefono: true, nroDoc: true },
              },
              usuario: { select: { nombre: true } },
              // Cobranza en campo: vendedor de campo atribuido (se muestra en vez del usuario).
              vendedorCampoNombre: true,
            },
          },
          repartidor: true,
          notasExtra: {
            select: {
              comprobante: {
                select: { serie: true, correlativo: true, mtoImpVenta: true, saldo: true, adelanto: true },
              },
            },
          },
        },
      }),
      this.prisma.pedidoTienda.findMany({
        where: {
          empresaId,
          tipoEntrega: 'ENVIO',
          ...(fechaWhere ? { creadoEn: fechaWhere } : {}),
        },
        orderBy: { creadoEn: 'desc' },
        take: limit,
        select: {
          id: true,
          codigoSeguimiento: true,
          clienteNombre: true,
          clienteTelefono: true,
          clienteDireccion: true,
          total: true,
          montoPagado: true,
          saldoPendiente: true,
          agenciaEnvio: true,
          estadoEnvio: true,
          estadoEntrega: true,
          creadoEn: true,
          repartidorId: true,
          repartidor: true,
          items: {
            select: {
              productoId: true,
              cantidad: true,
              precioUnit: true,
              producto: {
                select: { id: true, codigo: true, descripcion: true },
              },
            },
          },
        },
      }),
    ]);

    const despachosNormalizados = despachos.map((d) => {
      // Un paquete con varias notas cobra lo de todas.
      const notasDelPaquete: any[] = [d.comprobante, ...((d as any).notasExtra ?? []).map((x: any) => x.comprobante)];
      const pagadoDe = (c: any) => {
        const t = Number(c.mtoImpVenta);
        const sal = Number(c.saldo ?? 0);
        const ad = Number(c.adelanto ?? 0);
        return ad > 0 ? ad : sal === 0 ? t : t - sal;
      };
      const total = notasDelPaquete.reduce((s, c) => s + Number(c.mtoImpVenta), 0);
      const saldo = notasDelPaquete.reduce((s, c) => s + Number(c.saldo ?? 0), 0);
      const montoPagado = notasDelPaquete.reduce((s, c) => s + pagadoDe(c), 0);
      return {
        tipo: 'COMPROBANTE' as const,
        id: d.id,
        comprobanteId: d.comprobanteId,
        comprobanteTipoDoc: d.comprobante.tipoDoc,
        referencia: `${d.comprobante.serie}-${String(d.comprobante.correlativo).padStart(8, '0')}`,
        notasIncluidas: ((d as any).notasExtra ?? []).map(
          (x: any) => `${x.comprobante.serie}-${String(x.comprobante.correlativo).padStart(8, '0')}`,
        ),
        cliente: d.comprobante.cliente?.nombre ?? '—',
        telefono: d.comprobante.cliente?.telefono ?? '',
        vendedor:
          (d.comprobante as any).vendedorCampoNombre ??
          d.comprobante.usuario?.nombre ??
          '—',
        total,
        montoPagado,
        saldoPendiente: saldo,
        courier: d.transportista ?? '—',
        tipoEnvio: d.tipoEnvio ?? '—',
        agenciaDestino: d.agenciaDestino ?? '—',
        celularDest: d.celularDest ?? '',
        nroPaquetes: d.nroPaquetes ?? 1,
        turnoEnvio: d.turnoEnvio ?? '—',
        codigoGuia: d.codigoGuia ?? '',
        nroOrden: d.nroOrden ?? '',
        claveOrden: d.claveOrden ?? '',
        repartidorId: d.repartidorId,
        repartidor: d.repartidor?.nombre ?? '—',
        repartidorData: d.repartidor,
        estado: d.estado,
        creadoEn: d.creadoEn,
        // Reparto propio: lo que el panel muestra como chips (distrito, tipo,
        // cobro en destino) sin abrir el modal.
        tipoVentaReparto: d.tipoVentaReparto ?? null,
        distrito: d.distrito ?? null,
        montoCOD: d.montoCOD ?? null,
        formaPagoCobro: d.formaPagoCobro ?? null,
        fechaEstimada: d.fechaEstimada ?? null,
      };
    });

    const pedidosNormalizados = pedidos.map((p) => ({
      tipo: 'PEDIDO_TIENDA' as const,
      id: p.id,
      pedidoId: p.id,
      referencia: p.codigoSeguimiento,
      cliente: p.clienteNombre,
      telefono: p.clienteTelefono,
      vendedor: 'Tienda online',
      total: Number(p.total),
      montoPagado: Number(p.montoPagado ?? 0),
      saldoPendiente: Number(
        p.saldoPendiente ??
          Math.max(Number(p.total) - Number(p.montoPagado ?? 0), 0),
      ),
      courier: p.agenciaEnvio ?? '—',
      tipoEnvio: 'AGENCIA',
      agenciaDestino: p.clienteDireccion ?? '—',
      celularDest: p.clienteTelefono,
      nroPaquetes: 1,
      turnoEnvio: '—',
      codigoGuia: '',
      repartidorId: p.repartidorId,
      repartidor: p.repartidor?.nombre ?? '—',
      repartidorData: p.repartidor,
      estado: p.estadoEnvio,
      estadoEntrega: p.estadoEntrega,
      items: p.items,
      creadoEn: p.creadoEn,
    }));

    const todos = [...despachosNormalizados, ...pedidosNormalizados].sort(
      (a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime(),
    );

    return { data: todos, total: todos.length };
  }

  /**
   * Lleva el pedido de la IA de Ventas a la etapa que corresponde al despacho
   * (en ruta, entregado, reprogramado). La lógica estaba escrita en
   * `sincronizarConDespacho` pero nadie la llamaba: el despacho salía "en
   * camino" y el embudo seguía en "por despachar".
   *
   * Best-effort: un despacho que no salió de la IA no tiene pedido en el
   * embudo, y un fallo acá no debe tumbar el cambio de estado.
   */
  private async sincronizarEmbudo(
    empresaId: number,
    comprobanteId: number,
    estado: string,
  ) {
    try {
      const embudo = this.moduleRef.get(LeadsEmbudoService, { strict: false });
      await embudo.sincronizarConDespacho(empresaId, comprobanteId, estado);
    } catch (e) {
      this.logger.warn(
        `Embudo: no se pudo seguir al despacho ${comprobanteId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async notificarCambioEstado(
    comprobanteId: number,
    empresaId: number,
    estado: EstadoDespacho,
    repartidor: { nombre?: string | null; celular?: string | null; tipo?: string | null } | null,
    /** Si viene, no se envía nada: se deja acá el mensaje que saldría (vista previa). */
    armado?: MensajeArmado[],
  ): Promise<void> {
    const repartidorNombre = quienReparte(repartidor);
    const [comprobante, config] = await Promise.all([
      this.prisma.comprobante.findFirst({
        where: { id: comprobanteId },
        select: {
          serie: true,
          correlativo: true,
          // Sin esto el aviso de llegada nunca llevaba el saldo: se leía un
          // campo que no se pedía y siempre salía la versión sin cobro.
          saldo: true,
          cliente: { select: { nombre: true, telefono: true } },
          empresa: { select: { nombreComercial: true, razonSocial: true } },
        },
      }),
      this.prisma.despachoMensajeTemplate.findUnique({ where: { empresaId } }),
    ]);

    const telefono = comprobante?.cliente?.telefono;
    if (!comprobante || !telefono) return;
    const avisar = async (plantilla: string, valores: string[], propio?: string | null): Promise<boolean> => {
      if (!armado) return this.avisarAlCliente(empresaId, telefono, comprobanteId, plantilla, valores, propio);
      const cuerpo = this.whatsapp.cuerpoPlantillaDespacho(plantilla);
      const texto = propio?.trim() || (cuerpo ? textoDePlantilla(cuerpo, valores) : null);
      if (texto) armado.push({ telefono, texto });
      return !!texto;
    };

    const esEnCamino = estado === EstadoDespacho.EN_CAMINO;
    const esEnAgencia = estado === EstadoDespacho.EN_AGENCIA;
    const pedidoRef = `${comprobante.serie}-${String(comprobante.correlativo).padStart(8, '0')}`;

    const nombre = comprobante.cliente?.nombre ?? 'Cliente';
    // Los textos que escribe el negocio solo salen por Takiy (texto libre);
    // con Meta manda la plantilla aprobada y estos se ignoran.
    const variables = {
      nombre,
      pedido: pedidoRef,
      repartidor: repartidorNombre ?? 'nuestro equipo de reparto',
      empresa: comprobante.empresa?.nombreComercial || comprobante.empresa?.razonSocial || '',
    };

    if (esEnAgencia) {
      const envio = await this.prisma.envioDespacho.findFirst({
        where: { comprobanteId },
        select: { agenciaDestino: true, montoCOD: true, claveEnvio: true },
      });
      const agencia = envio?.agenciaDestino || 'la agencia';
      const saldo = saldoParaRetirar(comprobante.saldo, envio?.montoCOD);
      const propio = mensajePropio(config?.mensajeEnAgencia, {
        ...variables,
        agencia,
        saldo: saldo > 0 ? `S/ ${saldo.toFixed(2)}` : '',
        clave: envio?.claveEnvio ?? '',
      });
      // Un saldo o una clave que el mensaje propio no menciona igual se le
      // dicen al cliente: sin eso llega a la agencia sin la plata o sin la clave.
      const menciona = (v: string) => new RegExp(`\\{\\{${v}\\}\\}`).test(config?.mensajeEnAgencia ?? '');
      const extras = [
        envio?.claveEnvio && !menciona('clave') ? `🔑 Clave de retiro: ${envio.claveEnvio}.` : null,
        saldo > 0 && !menciona('saldo') ? `💵 Saldo a pagar al recoger: S/ ${saldo.toFixed(2)}.` : null,
      ].filter(Boolean);
      const propioConSaldo = propio && extras.length ? `${propio}\n\n${extras.join('\n')}` : propio;
      // Plantilla aprobada por Meta: se entrega fuera de la ventana de 24h, sin bloqueo.
      if (saldo > 0) {
        // pedido_en_destino_cobro → {{1}} nombre, {{2}} pedido, {{3}} agencia, {{4}} saldo
        await avisar('pedido_en_destino_cobro', [
          nombre,
          pedidoRef,
          agencia,
          saldo.toFixed(2),
        ], propioConSaldo);
      } else {
        // pedido_en_destino → {{1}} nombre, {{2}} pedido, {{3}} agencia
        await avisar('pedido_en_destino', [
          nombre,
          pedidoRef,
          agencia,
        ], propioConSaldo);
      }
      return;
    }

    const habilitado = esEnCamino
      ? (config?.notificarEnCamino ?? true)
      : (config?.notificarEntregado ?? true);
    if (!habilitado) return;

    // Plantilla aprobada por Meta (entrega garantizada fuera de 24h, sin bloqueo).
    // El texto libre personalizable por empresa (config.mensaje*) ya no aplica aquí:
    // Meta exige plantillas de contenido fijo aprobado.
    if (esEnCamino) {
      // Con saldo por cobrar y formas de pago configuradas para ese tipo de
      // repartidor, el aviso dice cuánto y cómo pagar (pago-repartidor.ts).
      const envio = await this.prisma.envioDespacho.findFirst({
        where: { comprobanteId },
        select: { montoCOD: true },
      });
      const saldo = saldoParaRetirar(comprobante.saldo, envio?.montoCOD);
      const formas = repartidorNombre ? formasDePagoParaElAviso(repartidor?.tipo, config) : null;
      const propio = mensajePropio(config?.mensajeEnCamino, variables);
      if (saldo > 0 && formas) {
        const salio = await avisar('pedido_en_camino_pago', [
          nombre,
          pedidoRef,
          repartidorNombre!,
          saldo.toFixed(2),
          formas,
        ], propio ? `${propio}\n\n💵 A pagar: S/ ${saldo.toFixed(2)}. Puedes pagar con ${formas}.` : null);
        // Si Meta todavía no aprueba la plantilla, sale el aviso de siempre.
        if (salio) return;
      }
      // pedido_en_camino → {{1}} nombre, {{2}} pedido, {{3}} repartidor
      await avisar('pedido_en_camino', [
        nombre,
        pedidoRef,
        // "Repartidor asignado: Sin asignar" le llegaba así al cliente. El
        // texto de la plantilla es fijo, así que el hueco se llena con algo
        // que se pueda leer.
        repartidorNombre ?? 'nuestro equipo de reparto',
      ], propio);
    } else {
      // pedido_entregado → {{1}} nombre, {{2}} pedido
      await avisar(
        'pedido_entregado',
        [nombre, pedidoRef],
        mensajePropio(config?.mensajeEntregado, variables),
      );
    }
  }

  /**
   * Manda una plantilla de despacho y, si salió, la deja en el chat del bot.
   *
   * Hierba Sana, 23-10: el empresario vende por su número personal y registra
   * la venta en Krezka. Los avisos de Shalom le llegan al cliente desde el
   * número del negocio, pero si el cliente contestaba, el bot no sabía de qué
   * pedido le hablaban. Con el aviso en el historial (como SISTEMA, igual que
   * lo que escribe el vendedor, para que no dispare el seguimiento por
   * silencio) el bot y el vendedor ven lo mismo que vio el cliente.
   */
  private async avisarAlCliente(
    empresaId: number,
    telefono: string,
    comprobanteId: number,
    plantilla: string,
    valores: string[],
    /** Texto del negocio; solo se usa si la empresa manda por Takiy. */
    textoPropio?: string | null,
  ): Promise<boolean> {
    const r = await this.whatsapp.enviarAvisoCliente(empresaId, telefono, plantilla, valores, textoPropio);
    if (!r.success) {
      this.logger.warn(`WA ${plantilla} (${r.via}) no salió a ${telefono}: ${r.error}`);
      return false;
    }
    const cuerpo = this.whatsapp.cuerpoPlantillaDespacho(plantilla);
    const enviado = r.texto ?? (cuerpo ? textoDePlantilla(cuerpo, valores) : null);
    if (enviado) await this.dejarEnElChat(empresaId, comprobanteId, telefono, enviado);
    return true;
  }

  /**
   * Deja el aviso en el chat del bot (como SISTEMA) para que el bot y el
   * vendedor vean lo mismo que vio el cliente. No falla: el aviso ya salió.
   */
  private async dejarEnElChat(
    empresaId: number,
    comprobanteId: number,
    telefono: string,
    enviado: string,
  ): Promise<void> {
    const nueve = ultimos9(telefono);
    try {
      // Primero la conversación donde el bot cerró ESTA venta: puede ser la de
      // un @usuario sin número (Erica, Hierba Sana 23-10), que por teléfono no
      // se encuentra. Si no la cerró el bot, la de ese celular.
      const conv =
        (await this.prisma.leadConversacion.findFirst({
          where: { empresaId, borrador: { comprobanteId } },
          select: { id: true },
        })) ??
        (nueve
          ? await this.prisma.leadConversacion.findFirst({
              where: { empresaId, telefonoProspecto: { endsWith: nueve } },
              select: { id: true },
            })
          : null);
      if (conv) {
        await this.prisma.leadMensaje.create({
          data: { conversacionId: conv.id, rol: 'SISTEMA', contenido: enviado },
        });
        await this.prisma.leadConversacion.update({
          where: { id: conv.id },
          data: { cantidadMensajes: { increment: 1 } },
        });
      }
    } catch (e: any) {
      // El aviso ya le llegó al cliente; no dejarlo en el chat no es motivo de error.
      this.logger.warn(`No se pudo dejar el aviso en el chat: ${e?.message}`);
    }
  }

  /**
   * El mensaje que saldría al pasar a `estado`, para que el negocio lo vea y
   * lo edite antes de mandarlo (Panel de Ventas). `texto: null` = ese estado
   * no avisa (apagado en la configuración, sin celular o no es notificable).
   */
  async mensajeParaEstado(comprobanteId: number, empresaId: number, estado: string) {
    await this.validateComprobante(comprobanteId, empresaId);
    // En el Panel de Ventas "En destino" es el "ya llegó, puede recoger": se
    // propone el mismo texto que el de la agencia.
    const base = estado === EstadoDespacho.EN_DESTINO ? EstadoDespacho.EN_AGENCIA : (estado as EstadoDespacho);
    if (ESTADOS_NOTIFICABLES.has(base)) {
      const envio = await this.prisma.envioDespacho.findUnique({
        where: { comprobanteId },
        select: { repartidor: { select: { nombre: true, celular: true, tipo: true } } },
      });
      const armado: MensajeArmado[] = [];
      await this.notificarCambioEstado(comprobanteId, empresaId, base, envio?.repartidor ?? null, armado);
      if (armado[0]) return armado[0];
    }
    // Los demás estados (o uno con el aviso apagado) no tienen mensaje propio:
    // se propone uno simple que el negocio puede editar o no mandar.
    const comp = await this.prisma.comprobante.findFirst({
      where: { id: comprobanteId },
      select: { serie: true, correlativo: true, cliente: { select: { nombre: true, telefono: true } } },
    });
    const telefono = comp?.cliente?.telefono;
    if (!comp || !telefono) return { telefono: null, texto: null };
    const pedido = `${comp.serie}-${String(comp.correlativo).padStart(8, '0')}`;
    const etiqueta: Record<string, string> = {
      PREPARANDO: 'en preparación 📦',
      EN_CAMINO: 'en camino 🚚',
      EN_AGENCIA: 'en la agencia 📦',
      EN_DESTINO: 'en destino 📍',
      ENTREGADO: 'entregado ✅',
      DEVUELTO: 'devuelto',
    };
    return {
      telefono,
      texto: `Hola ${comp.cliente?.nombre ?? ''}, tu pedido ${pedido} está ${etiqueta[estado] ?? estado.toLowerCase()}.`.replace(/\s+,/, ','),
    };
  }

  /** Manda el mensaje que el negocio revisó/editó. Solo por Takiy: es texto libre. */
  async enviarMensajeCliente(comprobanteId: number, empresaId: number, telefono: string, texto: string) {
    await this.validateComprobante(comprobanteId, empresaId);
    if (!telefono?.trim() || !texto?.trim()) {
      throw new BadRequestException('Falta el celular o el mensaje.');
    }
    const r = await this.whatsapp.enviarPorTakiy(empresaId, telefono, texto.trim());
    if (!r.success) {
      throw new BadRequestException(
        `${r.error || 'No se pudo enviar.'} Revisa en Takiy que tu celular siga vinculado.`,
      );
    }
    await this.dejarEnElChat(empresaId, comprobanteId, telefono, texto.trim());
    return { enviado: true };
  }

  /**
   * Recordatorio diario de recojo (ver recojo-agencia.ts). Lo llama el
   * scheduler una vez al día. Solo envíos con rastreo automático (Shalom/Olva):
   * sin él nadie marca la entrega y se le recordaría a quien ya recogió.
   */
  async recordarRecojosPendientes(ahora = new Date()): Promise<{ enviados: number; revisados: number }> {
    const envios = await this.prisma.envioDespacho.findMany({
      where: {
        estado: EstadoDespacho.EN_AGENCIA as any,
        OR: [
          {
            transportista: { in: ['SHALOM_PRO', 'SHALOM_COD'] },
            shalomEntregado: false,
            comprobante: { empresa: { shalomAutoTrackingActivo: true } },
          },
          {
            transportista: 'OLVA',
            olvaEntregado: false,
            comprobante: { empresa: { olvaAutoTrackingActivo: true } },
          },
        ],
        comprobante: { empresa: { despachoMensajeTemplate: { recordatorioRecojoDias: { gt: 0 } } } },
      },
      select: {
        id: true,
        comprobanteId: true,
        agenciaDestino: true,
        montoCOD: true,
        historial: true,
        actualizadoEn: true,
        recordatoriosRecojo: true,
        ultimoRecordatorioRecojoEn: true,
        comprobante: {
          select: {
            empresaId: true,
            serie: true,
            correlativo: true,
            saldo: true,
            cliente: { select: { nombre: true, telefono: true } },
            empresa: { select: { despachoMensajeTemplate: { select: { recordatorioRecojoDias: true } } } },
          },
        },
      },
      take: 300,
    });

    let enviados = 0;
    for (const e of envios) {
      const c = e.comprobante;
      const telefono = c.cliente?.telefono;
      const nueve = ultimos9(telefono);
      if (!telefono || !nueve) continue;
      const ultimoDelCliente = await this.prisma.leadMensaje.findFirst({
        where: {
          rol: 'USUARIO',
          conversacion: { empresaId: c.empresaId, telefonoProspecto: { endsWith: nueve } },
        },
        orderBy: { creadoEn: 'desc' },
        select: { creadoEn: true },
      });
      const decision = tocaRecordatorioRecojo({
        llegadaEn: llegadaAAgencia(e.historial, e.actualizadoEn),
        enviados: e.recordatoriosRecojo,
        ultimoEn: e.ultimoRecordatorioRecojoEn,
        maxDias: c.empresa.despachoMensajeTemplate?.recordatorioRecojoDias ?? 0,
        ultimoMensajeClienteEn: ultimoDelCliente?.creadoEn ?? null,
        ahora,
      });
      if (!decision.toca) continue;

      const pedidoRef = `${c.serie}-${String(c.correlativo).padStart(8, '0')}`;
      const nombre = c.cliente?.nombre ?? 'Cliente';
      const agencia = e.agenciaDestino || 'la agencia';
      const saldo = saldoParaRetirar(c.saldo, e.montoCOD);
      const salio =
        saldo > 0
          ? await this.avisarAlCliente(c.empresaId, telefono, e.comprobanteId, 'recordatorio_recojo_cobro', [
              nombre,
              pedidoRef,
              agencia,
              saldo.toFixed(2),
            ])
          : await this.avisarAlCliente(c.empresaId, telefono, e.comprobanteId, 'recordatorio_recojo', [
              nombre,
              pedidoRef,
              agencia,
            ]);
      // Si no salió (plantilla sin aprobar, sin medio de pago en Meta) no se
      // cuenta: mañana se vuelve a intentar.
      if (!salio) continue;
      await this.prisma.envioDespacho.update({
        where: { id: e.id },
        data: { recordatoriosRecojo: { increment: 1 }, ultimoRecordatorioRecojoEn: ahora },
      });
      enviados++;
    }
    return { enviados, revisados: envios.length };
  }

  /**
   * El enlace para mandarle al repartidor.
   *
   * Lo genera si el despacho todavía no tenía —los que ya existían cuando se
   * agregó esto, y los que vendrán si alguna vez se crea uno sin token—. Es
   * idempotente: llamarlo dos veces devuelve el mismo enlace, porque un token
   * nuevo invalidaría el que el motorizado ya tiene en su WhatsApp.
   */
  async enlaceParaRepartidor(comprobanteId: number, empresaId: number) {
    await this.validateComprobante(comprobanteId, empresaId);
    const envio = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId },
      select: { id: true, accesoToken: true },
    });
    if (!envio) {
      throw new NotFoundException(
        'No existe seguimiento de despacho para este comprobante.',
      );
    }
    const token =
      envio.accesoToken ??
      (
        await this.prisma.envioDespacho.update({
          where: { id: envio.id },
          data: { accesoToken: nuevoTokenDeEntrega() },
          select: { accesoToken: true },
        })
      ).accesoToken!;
    return { token };
  }

  /**
   * El despacho que abre un enlace de repartidor.
   *
   * Devuelve lo MÍNIMO para entregar: a quién, dónde, a qué teléfono llamar
   * si no encuentra, qué lleva y cuánto cobrar. Nada de precios unitarios,
   * márgenes ni el resto de la venta: el enlace no pide contraseña y anda
   * suelto en los WhatsApp de varios motorizados.
   *
   * Devuelve null si el token no existe o el enlace ya venció — el
   * controlador traduce las dos cosas al mismo 404, para no confirmarle a
   * nadie que un token existió.
   */
  async entregaPorToken(token: string) {
    if (!token?.trim()) return null;
    const d = await this.prisma.envioDespacho.findUnique({
      where: { accesoToken: token },
      select: {
        id: true,
        estado: true,
        entregadoEn: true,
        tipoEnvio: true,
        direccionDestino: true,
        agenciaDestino: true,
        distrito: true,
        observaciones: true,
        nombreDestinatario: true,
        celularDest: true,
        montoCOD: true,
        nroPaquetes: true,
        repartidor: { select: { nombre: true } },
        comprobante: {
          select: {
            serie: true,
            correlativo: true,
            cliente: { select: { nombre: true, telefono: true } },
            detalles: {
              select: { cantidad: true, descripcion: true },
            },
          },
        },
      },
    });
    if (!enlaceVigente(d)) return null;

    const c = d!.comprobante;
    return {
      pedido: `${c.serie}-${String(c.correlativo).padStart(8, '0')}`,
      estado: d!.estado,
      entregadoEn: d!.entregadoEn,
      tipoEnvio: d!.tipoEnvio,
      destinatario: d!.nombreDestinatario || c.cliente?.nombre || 'Cliente',
      telefono: d!.celularDest || c.cliente?.telefono || null,
      direccion: d!.direccionDestino || d!.agenciaDestino || null,
      distrito: d!.distrito,
      referencia: d!.observaciones,
      paquetes: d!.nroPaquetes ?? 1,
      // Lo que tiene que cobrar en la puerta. Cero = ya está pagado.
      aCobrar: Number(d!.montoCOD ?? 0),
      repartidor: d!.repartidor?.nombre ?? null,
      items: c.detalles.map((x) => ({
        cantidad: Number(x.cantidad),
        descripcion: x.descripcion,
      })),
    };
  }

  /**
   * El repartidor marca que salió o que entregó.
   *
   * Reusa `update`, que es el mismo camino del panel: así el aviso al
   * cliente, el historial y el rastreo salen igual que si lo hubiera marcado
   * alguien de la oficina. Lo único distinto es por dónde entra.
   *
   * Queda anotado en el historial que vino del enlace, para que después se
   * pueda distinguir de lo que marcó una persona desde el panel.
   */
  async marcarPorToken(token: string, estado: string) {
    const d = await this.prisma.envioDespacho.findUnique({
      where: { accesoToken: token },
      select: {
        comprobanteId: true,
        estado: true,
        entregadoEn: true,
        comprobante: { select: { empresaId: true } },
      },
    });
    if (!enlaceVigente(d)) return null;
    if (!puedeMarcar(estado)) {
      throw new BadRequestException('Ese estado no se marca desde el enlace.');
    }
    // Solo el estado: `observaciones` es la referencia de la dirección, no una
    // nota del historial, y mandarla la pisaría.
    await this.update(d!.comprobanteId, d!.comprobante.empresaId, {
      estado: estado as never,
    });
    this.logger.log(
      `Despacho ${d!.comprobanteId}: ${estado} marcado por el repartidor desde el enlace.`,
    );
    return { estado };
  }

  /** El comprobante al que pertenece un enlace vigente, para las fotos. */
  async comprobanteDeToken(
    token: string,
  ): Promise<{ comprobanteId: number; empresaId: number } | null> {
    const d = await this.prisma.envioDespacho.findUnique({
      where: { accesoToken: token },
      select: {
        comprobanteId: true,
        estado: true,
        entregadoEn: true,
        comprobante: { select: { empresaId: true } },
      },
    });
    if (!enlaceVigente(d)) return null;
    return {
      comprobanteId: d!.comprobanteId,
      empresaId: d!.comprobante.empresaId,
    };
  }

  async actualizarSaldo(
    comprobanteId: number,
    empresaId: number,
    saldo: number,
  ): Promise<void> {
    const comprobante = await this.prisma.comprobante.findFirst({
      where: { id: comprobanteId, empresaId },
      select: { id: true, mtoImpVenta: true },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');
    const nuevoSaldo = Math.max(
      Math.min(saldo, Number(comprobante.mtoImpVenta)),
      0,
    );
    const estadoPago = nuevoSaldo <= 0 ? 'COMPLETADO' : 'PAGO_PARCIAL';
    await this.prisma.comprobante.update({
      where: { id: comprobanteId },
      data: { saldo: nuevoSaldo, estadoPago },
    });
  }

  async confirmarPago(
    comprobanteId: number,
    empresaId: number,
    usuarioId?: number,
  ): Promise<void> {
    const comprobante = await this.prisma.comprobante.findFirst({
      where: { id: comprobanteId, empresaId },
      select: {
        id: true,
        serie: true,
        correlativo: true,
        saldo: true,
        cliente: { select: { nombre: true, telefono: true } },
        envioDespacho: { select: { tipoEnvio: true, formaPagoCobro: true } },
      },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');
    const despacho = comprobante.envioDespacho;

    // Lo cobrado se registra como un pago de verdad. Antes solo se ponía el
    // saldo en 0: la nota quedaba "pagada" pero el dinero no entraba a caja
    // ni a finanzas, y la venta contraentrega —que se cuenta cuando el
    // cliente recibe y paga— no aparecía en ningún ingreso.
    const saldo = Number(comprobante.saldo ?? 0);
    if (saldo > 0) {
      const forma = despacho?.formaPagoCobro;
      await this.pagos.registrarPago(
        comprobanteId,
        {
          monto: saldo,
          medioPago: forma && forma !== 'NO_COBRAR' ? forma : 'EFECTIVO',
          observacion: 'Cobro confirmado desde despacho',
        },
        usuarioId,
        empresaId,
      );
    } else {
      await this.prisma.comprobante.update({
        where: { id: comprobanteId },
        data: { saldo: 0, estadoPago: 'COMPLETADO' },
      });
    }

    // La plantilla dice "Ya puedes retirar tu pedido": tiene sentido en una
    // agencia, no en un delivery a domicilio, donde llegaba DESPUÉS de "fue
    // entregado exitosamente".
    if (despacho?.tipoEnvio === 'DOMICILIO') return;

    const telefono = comprobante.cliente?.telefono;
    if (telefono) {
      const pedidoRef = `${comprobante.serie}-${String(comprobante.correlativo).padStart(8, '0')}`;
      const nombre = comprobante.cliente?.nombre ?? 'Cliente';
      // pago_confirmado → {{1}} nombre, {{2}} pedido
      this.whatsapp
        .enviarAvisoCliente(empresaId, telefono, 'pago_confirmado', [nombre, pedidoRef])
        .catch((e) =>
          this.logger.warn(`WA pago completo fallido: ${e.message}`),
        );
    }
  }

  private async resolveUsuarioNombre(
    usuarioId?: number,
  ): Promise<string | null> {
    if (!usuarioId) return null;
    const u = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nombre: true },
    });
    return u?.nombre ?? null;
  }

  private pickFields(dto: CreateEnvioDespachoDto) {
    const result: Record<string, any> = {};
    for (const key of DESPACHO_FIELDS) {
      if ((dto as any)[key] !== undefined) result[key] = (dto as any)[key];
    }
    return result;
  }

  private async syncAdelantoDesdeEnvio(
    comprobanteId: number,
    empresaId: number,
    dto: CreateEnvioDespachoDto,
  ) {
    const aplicacion = dto.aplicacionMontoCliente;
    if (aplicacion === undefined) return;

    const comprobante = await this.prisma.comprobante.findFirst({
      where: { id: comprobanteId, empresaId },
      select: { id: true, tipoDoc: true, mtoImpVenta: true, adelanto: true },
    });
    if (!comprobante) return;

    const tiposInformalesConAdelanto = new Set([
      'NV',
      'NP',
      'OT',
      'TICKET',
      'CP',
      'RH',
    ]);
    if (!tiposInformalesConAdelanto.has(comprobante.tipoDoc)) return;

    const total = Number(comprobante.mtoImpVenta);
    const monto = Math.max(Number(dto.costoEnvio ?? 0), 0);
    const esAdelanto = aplicacion === 'ADELANTO' && monto > 0;

    // Limpiar SOLO los pagos que genera este método, para poder recalcularlos si
    // el envío se edita. Se identifican por su referencia determinista; las dos
    // observaciones son el formato antiguo, se mantienen para limpiar los que ya
    // existían antes de que hubiera referencia.
    const refEnvio = `${comprobante.tipoDoc}-ENVIO-${comprobanteId}`;
    const borrados = await this.prisma.pago.deleteMany({
      where: {
        comprobanteId,
        OR: [
          { referencia: refEnvio },
          {
            observacion: {
              in: [
                'Adelanto registrado desde coordinación de envío',
                'Pago adelantado registrado automáticamente',
              ],
            },
          },
        ],
      },
    });

    // Lo realmente cobrado hasta ahora (pagos de emisión, cobros posteriores…).
    const { _sum } = await this.prisma.pago.aggregate({
      where: { comprobanteId },
      _sum: { monto: true },
    });
    const yaPagado = this.round2(Number(_sum.monto ?? 0));

    if (esAdelanto) {
      const adelantoDto = Math.min(monto, total);
      // Cuando el adelanto ya se cobró al emitir el comprobante, el pago existe
      // desde `registrarPagosDeEmision` con el medio real (Yape, tarjeta...). No
      // se debe crear otro: antes se duplicaba porque el limpiador de arriba solo
      // buscaba por observación y la de emisión es distinta, así que el historial
      // mostraba dos pagos y el total pagado salía al doble.
      const falta = this.round2(adelantoDto - yaPagado);
      if (falta > 0) {
        await this.prisma.pago.create({
          data: {
            comprobanteId,
            empresaId,
            monto: falta,
            medioPago: 'EFECTIVO',
            observacion: 'Adelanto registrado desde coordinación de envío',
            referencia: refEnvio,
          },
        });
      }
      // El adelanto efectivo nunca puede ser menor a lo ya cobrado: si la venta
      // ya estaba pagada (o tenía cobros mayores) y en el despacho se escribe un
      // monto menor, antes el saldo se recalculaba como total − monto y una venta
      // Completada pasaba a Pago parcial con saldo inventado.
      const adelanto = Math.min(Math.max(adelantoDto, yaPagado), total);
      const saldo = Math.max(this.round2(total - adelanto), 0);
      await this.prisma.comprobante.update({
        where: { id: comprobanteId },
        data: {
          adelanto,
          saldo,
          estadoPago: (saldo > 0 ? 'PAGO_PARCIAL' : 'COMPLETADO') as any,
        },
      });
      return;
    }

    // Sin adelanto en el envío: el estado de pago de la venta NO se toca.
    // Antes se marcaba COMPLETADO con saldo 0 solo por guardar el despacho, y una
    // venta a crédito o contraentrega (reparto propio) quedaba "pagada" antes de
    // que el motorizado cobrara. Solo si este método había registrado un adelanto
    // antes (y ahora se quitó), se recalcula el saldo con los pagos que quedan.
    if (borrados.count > 0) {
      const saldo = Math.max(this.round2(total - yaPagado), 0);
      await this.prisma.comprobante.update({
        where: { id: comprobanteId },
        data: {
          adelanto: saldo > 0 ? yaPagado : (comprobante.adelanto ?? 0),
          saldo,
          estadoPago: (saldo <= 0
            ? 'COMPLETADO'
            : yaPagado > 0
              ? 'PAGO_PARCIAL'
              : 'PENDIENTE_PAGO') as any,
        },
      });
    }
  }

  private round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private async validateComprobante(comprobanteId: number, empresaId: number) {
    const comprobante = await this.prisma.comprobante.findFirst({
      where: { id: comprobanteId, empresaId },
      include: { cliente: { select: { direccion: true, telefono: true } } },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado.');
    return comprobante;
  }

  /**
   * Completa el teléfono del cliente con el celular del destinatario del
   * despacho, SOLO si el cliente todavía no tiene uno guardado. Sin esto, un
   * cliente recurrente nunca queda con celular registrado (el que se tipea
   * en "Celular destinatario" solo vivía en el despacho puntual) y el
   * siguiente despacho para el mismo cliente vuelve a pedirlo desde cero.
   */
  /**
   * Cliente registrado solo con WhatsApp ("WSP 9…" y sin documento) o sin DNI:
   * al completar el destinatario de la guía se corrige su ficha (DNI + nombre
   * + celular) para que la siguiente venta y su boleta ya salgan bien. Nunca
   * pisa un DNI/RUC válido ya registrado.
   */
  private async completarFichaCliente(
    clienteId: number | null | undefined,
    empresaId: number,
    dni?: string,
    nombre?: string,
    celular?: string,
  ) {
    if (!clienteId) return;
    const dniLimpio = String(dni ?? '').replace(/\D/g, '');
    const nombreLimpio = String(nombre ?? '').trim();
    if (dniLimpio.length !== 8 || !nombreLimpio) return;
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: { id: true, nroDoc: true, nombre: true, telefono: true },
    });
    if (!cliente) return;
    const docActual = String(cliente.nroDoc ?? '').trim();
    const tieneDocValido =
      /^\d{8}$/.test(docActual) || /^\d{11}$/.test(docActual);
    if (tieneDocValido && docActual !== dniLimpio) return;
    const tipoDni = await this.prisma.tipoDocumento.findFirst({
      where: {
        OR: [
          { codigo: '1' },
          { descripcion: { contains: 'DNI', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    const celularLimpio = String(celular ?? '').replace(/\D/g, '');
    await this.prisma.cliente
      .update({
        where: { id: cliente.id },
        data: {
          nroDoc: dniLimpio,
          nombre: nombreLimpio,
          ...(tipoDni ? { tipoDocumentoId: tipoDni.id } : {}),
          ...(/^9\d{8}$/.test(celularLimpio) && !cliente.telefono
            ? { telefono: celularLimpio }
            : {}),
        },
      })
      .catch((e) =>
        this.logger.warn(
          `No se pudo completar la ficha del cliente ${cliente.id}: ${e?.message}`,
        ),
      );
  }

  private async backfillTelefonoCliente(
    clienteId: number | null | undefined,
    telefonoActual: string | null | undefined,
    celularDest: string | null | undefined,
  ) {
    if (!clienteId || telefonoActual) return;
    const celular = String(celularDest ?? '').replace(/\D/g, '');
    if (celular.length !== 9 || !celular.startsWith('9')) return;
    await this.prisma.cliente
      .update({ where: { id: clienteId }, data: { telefono: celular } })
      .catch((e) =>
        this.logger.warn(
          `No se pudo completar el teléfono del cliente ${clienteId}: ${e?.message}`,
        ),
      );
  }

  private async syncPedidoTiendaByComprobante(
    comprobanteId: number,
    estado: EstadoDespacho,
  ) {
    const mapped = DESPACHO_TO_PEDIDO_ESTADO[estado];
    if (!mapped) return;
    await this.prisma.pedidoTienda.updateMany({
      where: { comprobanteId },
      data: mapped,
    });
  }

  // ─── Reparto propio / motorizado externo ──────────────────────────────────

  /**
   * Despachos con transportista PROPIOS del rango pedido. La fecha es la de
   * entrega programada (`fechaEstimada`); si no se programó, cuenta el día en
   * que se creó el despacho. Por defecto un solo día (hoy en Lima).
   */
  /**
   * A qué `transportista` corresponde cada modo del reporte.
   *
   * Shalom se guarda con tres variantes (`SHALOM`, `SHALOM_PRO`, `SHALOM_COD`)
   * según cómo se creó el envío, así que se filtra por coincidencia parcial —
   * el mismo criterio que usa `analisis-financiero`. `NO_APLICA` es una venta
   * que no se despacha: nunca entra al reporte.
   */
  private filtroCourier(courier?: string) {
    switch (courier) {
      case 'SHALOM':
        return { transportista: { contains: 'SHALOM' } };
      case 'OLVA':
        return { transportista: { contains: 'OLVA' } };
      case 'TODOS':
        return {
          AND: [
            { transportista: { not: null } },
            { transportista: { not: 'NO_APLICA' } },
          ],
        };
      default:
        return { transportista: 'PROPIOS' };
    }
  }

  /**
   * Los envíos por agencia (Shalom/Olva) no se validan ni se agrupan como el
   * reparto propio: no tienen distrito ni repartidor, su destino es la agencia
   * y lo que falta para despacharlos es el DNI del destinatario, no el tipo de
   * venta de la plantilla del motorizado.
   */
  private modoReporte(courier?: string): 'PROPIOS' | 'AGENCIA' {
    return !courier || courier === 'PROPIOS' ? 'PROPIOS' : 'AGENCIA';
  }

  private async despachosParaReporte(
    empresaId: number,
    q: ExportarRepartoQueryDto,
  ) {
    const hoyLima = new Date()
      .toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
      .slice(0, 10);
    const esDia = (v?: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!esDia(q.fecha) || !esDia(q.fechaFin)) {
      throw new BadRequestException('La fecha debe tener el formato YYYY-MM-DD');
    }
    const fecha = q.fecha || hoyLima;
    const fechaFin = q.fechaFin && q.fechaFin > fecha ? q.fechaFin : fecha;
    // `fechaEstimada` es una fecha "solo día" (se guarda a mediodía UTC; las
    // filas antiguas quedaron a medianoche UTC): se compara por día calendario
    // UTC, que cubre ambos casos. `creadoEn` sí es un instante real → día Lima.
    const rangoDia = {
      gte: new Date(`${fecha}T00:00:00.000Z`),
      lte: new Date(`${fechaFin}T23:59:59.999Z`),
    };
    const rango = {
      gte: new Date(`${fecha}T00:00:00-05:00`),
      lte: new Date(`${fechaFin}T23:59:59.999-05:00`),
    };

    const items = await this.prisma.envioDespacho.findMany({
      where: {
        ...this.filtroCourier(q.courier),
        comprobante: {
          empresaId,
          // Una venta anulada no se reparte ni se cobra.
          estadoEnvioSunat: { not: 'ANULADO' as any },
          NOT: { estadoPago: 'ANULADO' as any },
          ...(q.sedeId ? { sedeId: Number(q.sedeId) } : {}),
        },
        ...(q.repartidorId ? { repartidorId: Number(q.repartidorId) } : {}),
        ...(q.estado
          ? { estado: q.estado as any }
          : { estado: { not: 'DEVUELTO' as any } }),
        OR: [
          { fechaEstimada: rangoDia },
          { fechaEstimada: null, creadoEn: rango },
        ],
      },
      include: {
        repartidor: { select: { id: true, nombre: true } },
        comprobante: {
          select: {
            id: true,
            tipoDoc: true,
            serie: true,
            correlativo: true,
            mtoImpVenta: true,
            saldo: true,
            estadoPago: true,
            tipoMoneda: true,
            tipoCambio: true,
            sede: { select: { id: true, nombre: true } },
            cliente: { select: { nombre: true, telefono: true, direccion: true } },
            detalles: {
              select: { cantidad: true, descripcion: true },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });
    // Orden por fecha de entrega efectiva: la programada o, si no hay, el día
    // en que se creó el despacho (un orderBy de BD mandaba los nulos al final).
    const diaUtc = (d: Date | null | undefined) =>
      d ? new Date(d).toISOString().slice(0, 10) : '';
    const diaLima = (d: Date) =>
      new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    items.sort((a, b) => {
      const fa = a.fechaEstimada ? diaUtc(a.fechaEstimada) : diaLima(a.creadoEn);
      const fb = b.fechaEstimada ? diaUtc(b.fechaEstimada) : diaLima(b.creadoEn);
      return fa.localeCompare(fb) || a.creadoEn.getTime() - b.creadoEn.getTime();
    });
    return { items, fecha, fechaFin };
  }

  /** Etiquetas exactas que acepta la plantilla del courier. */
  private static readonly TIPO_VENTA_COURIER: Record<string, string> = {
    CONTRAENTREGA: 'CONTRAENTREGA',
    SOLO_ENTREGA: 'SOLO-ENTREGA-NO-COBRAR',
    CAMBIO: 'CAMBIO',
    CONTRAENTREGA_CAMBIO: 'CONTRAENTREGA-CAMBIO',
    RECOJO: 'RECOJO TURNO TARDE',
  };
  private static readonly FORMA_PAGO_COURIER: Record<string, string> = {
    EFECTIVO: 'EFECTIVO',
    YAPE: 'YAPE',
    PLIN: 'PLIN',
    TRANSFERENCIA: 'TRANSFERENCIA',
    POS: 'POS',
    NO_COBRAR: 'NO COBRAR',
  };
  private static readonly ESTADO_LABEL: Record<string, string> = {
    PREPARANDO: 'Preparando',
    EN_CAMINO: 'En camino',
    EN_AGENCIA: 'En agencia',
    EN_DESTINO: 'En destino',
    ENTREGADO: 'Entregado',
    DEVUELTO: 'Devuelto',
  };

  /** Etiqueta legible del courier, para agrupar y comparar en el resumen. */
  private static courierLabel(transportista?: string | null) {
    const t = String(transportista || '').toUpperCase();
    if (t === 'PROPIOS') return 'Reparto propio';
    if (t.includes('SHALOM')) return 'Shalom';
    if (t.includes('OLVA')) return 'Olva';
    return t ? t.replace(/_/g, ' ') : '(sin courier)';
  }

  /**
   * Fila de la plantilla del courier + los datos internos, para export y resumen.
   *
   * Cada fila se interpreta según SU propio transportista, no según el modo del
   * reporte: en `TODOS` conviven motorizado y agencia en el mismo listado, y
   * decidirlo por el reporte hacía que los envíos de reparto propio reclamaran
   * "agencia destino" y que su destino saliera como la dirección del cliente en
   * vez del distrito.
   */
  private filaReparto(e: any) {
    const modo: 'PROPIOS' | 'AGENCIA' =
      String(e.transportista || '').toUpperCase() === 'PROPIOS'
        ? 'PROPIOS'
        : 'AGENCIA';
    const c = e.comprobante;
    // Qué significa "se cobra en destino" según el modo. El reparto propio lo
    // declara en `tipoVentaReparto` (campo de su plantilla); un envío por
    // agencia no tiene ese campo, así que se cobra cuando es un Shalom COD o
    // cuando se dejó un monto a cobrar — sin esto, todo COD salía en S/0.
    const cobra =
      modo === 'AGENCIA'
        ? Number(e.montoCOD ?? 0) > 0 ||
          String(e.transportista || '')
            .toUpperCase()
            .includes('COD')
        : e.tipoVentaReparto === 'CONTRAENTREGA' ||
          e.tipoVentaReparto === 'CONTRAENTREGA_CAMBIO';
    // Monto a cobrar: el indicado en el despacho; si no se puso y la venta es
    // contraentrega, lo que falta por pagar del comprobante.
    // Monto a cobrar: el indicado en el despacho o, si no se puso, lo que falta
    // por pagar del comprobante. Una venta ya pagada (saldo 0) marcada como
    // contraentrega sin monto queda en 0 y se avisa: nunca se manda a cobrar el
    // total de nuevo.
    // Venta en dólares: el motorizado cobra en soles, así que el saldo y el
    // total se convierten al TC del comprobante (montoCOD ya se ingresa en S/).
    const factorPen =
      c?.tipoMoneda === 'USD' && Number(c?.tipoCambio) > 0
        ? Number(c.tipoCambio)
        : 1;
    const saldoPen = Math.max(Number(c?.saldo ?? 0), 0) * factorPen;
    const totalPen = Number(c?.mtoImpVenta ?? 0) * factorPen;
    const montoCobrar = cobra
      ? this.round2(
          Number(e.montoCOD ?? 0) > 0 ? Number(e.montoCOD) : saldoPen,
        )
      : 0;
    const telefono = String(e.celularDest || c?.cliente?.telefono || '')
      .replace(/\D/g, '')
      .slice(-9);
    const direccion = String(
      e.agenciaDestino || e.direccionDestino || c?.cliente?.direccion || '',
    ).trim();
    const detalle =
      String(e.contenidoPaquete || '').trim() ||
      (c?.detalles || [])
        .map(
          (d: any) =>
            `${Number(d.cantidad) % 1 === 0 ? Number(d.cantidad) : Number(d.cantidad).toFixed(2)} x ${String(d.descripcion || '').trim()}`,
        )
        .join(', ');
    // fechaEstimada es "solo día" → se lee por calendario UTC; creadoEn es un
    // instante real → día de Lima.
    const fechaTxt = e.fechaEstimada
      ? new Date(e.fechaEstimada).toLocaleDateString('es-PE', {
          timeZone: 'UTC',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      : e.creadoEn
        ? new Date(e.creadoEn).toLocaleDateString('es-PE', {
            timeZone: 'America/Lima',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })
        : '';
    // "WSP 9…" (alta solo con WhatsApp) y "CLIENTES VARIOS" (genérico del POS)
    // no son nombres para el motorizado: se exporta vacío y se marca faltante.
    const esGenerico = (v: string) =>
      /^WSP\s/i.test(v) || /^CLIENTES?\s+VARIOS$/i.test(v);
    const nombreCliente = String(c?.cliente?.nombre || '').trim();
    const nombreManual = String(e.nombreDestinatario || '').trim();
    // Aunque venga guardado a mano (p. ej. precargado antes de este fix), un
    // genérico sigue sin ser nombre.
    const nombre = esGenerico(nombreManual)
      ? ''
      : nombreManual || (esGenerico(nombreCliente) ? '' : nombreCliente);
    const distrito = String(e.distrito || '').trim();
    const agencia = String(e.agenciaDestino || '').trim();
    const dni = String(e.dniDestinatario || '').replace(/\D/g, '');
    const faltan: string[] = [];
    if (modo === 'AGENCIA') {
      // Lo que exige `crearGuiaDesdeDespacho` para registrar la guía: sin esto
      // el envío no se puede emitir. El tipo de venta, el distrito y la forma
      // de pago son de la plantilla del motorizado y aquí no aplican — pedirlos
      // marcaría como incompleto a todo envío por agencia.
      if (!nombre) faltan.push('nombre');
      if (!/^\d{8}$/.test(dni)) faltan.push('DNI');
      if (!/^9\d{8}$/.test(telefono)) faltan.push('teléfono');
      if (!agencia) faltan.push('agencia destino');
    } else {
      if (!e.tipoVentaReparto) faltan.push('tipo de venta');
      if (!nombre) faltan.push('nombre');
      if (!/^9\d{8}$/.test(telefono)) faltan.push('teléfono');
      if (!distrito) faltan.push('distrito');
      if (!direccion) faltan.push('dirección');
      if (!detalle) faltan.push('detalle');
    }
    // Un pedido ya entregado no vuelve al motorizado: si además ya se cobró
    // (saldo 0), no es un dato faltante sino un cobro cerrado.
    if (cobra && montoCobrar <= 0 && e.estado !== 'ENTREGADO')
      faltan.push('monto a cobrar');
    // La forma de pago es una columna de la plantilla del motorizado; en un
    // Shalom COD el cobro lo hace la agencia y no se elige aquí.
    if (
      modo === 'PROPIOS' &&
      cobra &&
      (!e.formaPagoCobro || e.formaPagoCobro === 'NO_COBRAR')
    )
      faltan.push('forma de pago');
    // Destino del envío: el distrito es el eje del motorizado, la agencia el de
    // Shalom/Olva. Un solo campo para que "a dónde mando más" funcione igual en
    // los dos modos y se puedan comparar couriers en el modo TODOS.
    const destino =
      (modo === 'AGENCIA' ? agencia || direccion : distrito) || '(sin destino)';
    // El courier confirma la entrega por su propio rastreo (lo sincroniza el
    // scheduler); `estado` puede ir atrás si nadie abrió el panel.
    const entregado =
      e.estado === 'ENTREGADO' ||
      e.shalomEntregado === true ||
      e.olvaEntregado === true;
    // En agencia el flete real es el que cotizó Shalom al crear la guía;
    // `costoEnvio` queda en 0 cuando nadie lo tipeó a mano. En reparto propio se
    // respeta tal cual para no mover los números que ya ve el motorizado.
    const costoEnvio = this.round2(
      modo === 'AGENCIA'
        ? Number(e.costoEnvio ?? 0) || Number(e.shalomFleteCotizado ?? 0)
        : Number(e.costoEnvio ?? 0),
    );
    // Día calendario efectivo, con el mismo criterio que `fechaTxt`: la fecha
    // programada se lee en UTC y la de creación en hora de Lima. Base del eje
    // mes a mes.
    const diaIso = e.fechaEstimada
      ? new Date(e.fechaEstimada).toISOString().slice(0, 10)
      : e.creadoEn
        ? new Date(e.creadoEn).toLocaleDateString('en-CA', {
            timeZone: 'America/Lima',
          })
        : '';
    // Contraentrega con "No cobrar" es contradictorio: se deja vacío (y CARGA lo
    // marca) en vez de mandar "NO COBRAR" junto a un monto.
    const formaPago = cobra
      ? e.formaPagoCobro && e.formaPagoCobro !== 'NO_COBRAR'
        ? EnvioDespachoService.FORMA_PAGO_COURIER[e.formaPagoCobro] || ''
        : ''
      : 'NO COBRAR';
    const documento = c ? `${c.serie}-${c.correlativo}` : '';
    return {
      courier: {
        CARGA: faltan.length ? `FALTAN DATOS: ${faltan.join(', ')}` : 'OK',
        'TIPO DE VENTA (SELECCIONE SOLO DEL LISTADO)':
          EnvioDespachoService.TIPO_VENTA_COURIER[e.tipoVentaReparto] || '',
        'NOMBRE DEL DESTINATARIO': nombre,
        'TELEFONO DESTINATARIO 9 DIGITOS': telefono,
        'DISTRITO (SELECCIONE SOLO DEL LISTADO)': distrito,
        'DIRECCION DE ENTREGA': direccion,
        'COORDENADAS DE LA DIRECCIÓN': String(e.coordenadas || '').trim(),
        'FECHA DE ENTREGA (DIA/MES/AÑO)': fechaTxt,
        'DETALLE DEL PRODUCTO': detalle,
        'MONTO A COBRAR (decimales se separan con punto . )': montoCobrar,
        'FORMA DE PAGO': formaPago,
        OBSERVACION: String(e.observaciones || '').trim(),
        '¿Revisar producto? (SI/NO).': e.revisarProducto ? 'SI' : 'NO',
      },
      interno: {
        DOCUMENTO: documento,
        'SEDE ORIGEN': c?.sede?.nombre || '',
        REPARTIDOR: e.repartidor?.nombre || '',
        ESTADO: EnvioDespachoService.ESTADO_LABEL[e.estado] || e.estado,
        TURNO: e.turnoEnvio || '',
        'N° PAQUETES': e.nroPaquetes ?? 1,
        'TOTAL VENTA': this.round2(totalPen),
        'MONTO A COBRAR': montoCobrar,
        'COSTO ENVÍO': this.round2(Number(e.costoEnvio ?? 0)),
        'FLETE LO PAGA': e.pagarFlete || '',
        'CÓDIGO GUÍA': e.codigoGuia || '',
      },
      envio: {
        DOCUMENTO: documento,
        FECHA: fechaTxt,
        COURIER: EnvioDespachoService.courierLabel(e.transportista),
        DESTINATARIO: nombre,
        DNI: dni,
        TELEFONO: telefono,
        DESTINO: destino,
        'N° GUÍA / ORDEN': String(e.nroOrden || e.codigoGuia || '').trim(),
        CLAVE: String(e.claveEnvio || '').trim(),
        'N° PAQUETES': e.nroPaquetes ?? 1,
        CONTENIDO: detalle,
        ESTADO: EnvioDespachoService.ESTADO_LABEL[e.estado] || e.estado,
        'RASTREO COURIER': String(e.shalomEstado || e.olvaEstado || '').trim(),
        ENTREGADO: entregado ? 'SI' : 'NO',
        'TOTAL VENTA': this.round2(totalPen),
        'MONTO A COBRAR': montoCobrar,
        'COSTO ENVÍO': costoEnvio,
        'SEDE ORIGEN': c?.sede?.nombre || '',
        CARGA: faltan.length ? `FALTAN DATOS: ${faltan.join(', ')}` : 'OK',
      },
      meta: {
        completo: faltan.length === 0,
        cobra,
        montoCobrar,
        distrito: distrito || '(sin distrito)',
        destino,
        courier: EnvioDespachoService.courierLabel(e.transportista),
        mes: diaIso.slice(0, 7) || '(sin fecha)',
        entregado,
        tipoVenta: e.tipoVentaReparto || '(sin tipo)',
        formaPago: cobra ? e.formaPagoCobro || '(sin forma)' : 'NO_COBRAR',
        estado: e.estado,
        repartidor: e.repartidor?.nombre || '(sin repartidor)',
        sede: c?.sede?.nombre || '(sin sede)',
        totalVenta: this.round2(totalPen),
        costoEnvio,
        // Lo que el negocio PAGA al courier por este despacho. Distinto de
        // `costoEnvio`, que es lo que se le cobra al cliente: con reparto propio
        // se puede cobrar S/15 al comprador y pagarle S/8 al motorizado.
        costoCourier: this.round2(Number(e.costoCourier ?? 0)),
      },
    };
  }

  /** Agrupa contando pedidos y sumando monto a cobrar; base de las estadísticas. */
  private agrupar(
    filas: ReturnType<EnvioDespachoService['filaReparto']>[],
    key:
      | 'distrito'
      | 'destino'
      | 'courier'
      | 'mes'
      | 'tipoVenta'
      | 'formaPago'
      | 'estado'
      | 'repartidor'
      | 'sede',
  ) {
    const map = new Map<
      string,
      { pedidos: number; montoCobrar: number; totalVenta: number; costoCourier: number }
    >();
    for (const f of filas) {
      const k = f.meta[key];
      const acc =
        map.get(k) ?? { pedidos: 0, montoCobrar: 0, totalVenta: 0, costoCourier: 0 };
      acc.pedidos += 1;
      acc.montoCobrar = this.round2(acc.montoCobrar + f.meta.montoCobrar);
      acc.totalVenta = this.round2(acc.totalVenta + f.meta.totalVenta);
      acc.costoCourier = this.round2(acc.costoCourier + f.meta.costoCourier);
      map.set(k, acc);
    }
    return [...map.entries()]
      .map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.pedidos - a.pedidos || a.nombre.localeCompare(b.nombre));
  }

  async resumenReparto(empresaId: number, q: ExportarRepartoQueryDto) {
    const { items, fecha, fechaFin } = await this.despachosParaReporte(
      empresaId,
      q,
    );
    const filas = items.map((e) => this.filaReparto(e));
    const totales = filas.reduce(
      (acc, f) => ({
        pedidos: acc.pedidos + 1,
        completos: acc.completos + (f.meta.completo ? 1 : 0),
        contraentrega: acc.contraentrega + (f.meta.cobra ? 1 : 0),
        montoCobrar: this.round2(acc.montoCobrar + f.meta.montoCobrar),
        totalVenta: this.round2(acc.totalVenta + f.meta.totalVenta),
        costoEnvio: this.round2(acc.costoEnvio + f.meta.costoEnvio),
        costoCourier: this.round2(acc.costoCourier + f.meta.costoCourier),
        entregados: acc.entregados + (f.meta.entregado ? 1 : 0),
      }),
      { pedidos: 0, completos: 0, contraentrega: 0, montoCobrar: 0, totalVenta: 0, costoEnvio: 0, costoCourier: 0, entregados: 0 },
    );
    return {
      fecha,
      fechaFin,
      totales,
      courier: q.courier || 'PROPIOS',
      porDistrito: this.agrupar(filas, 'distrito'),
      porDestino: this.agrupar(filas, 'destino'),
      porCourier: this.agrupar(filas, 'courier'),
      porMes: this.agrupar(filas, 'mes').sort((a, b) =>
        a.nombre.localeCompare(b.nombre),
      ),
      porTipoVenta: this.agrupar(filas, 'tipoVenta'),
      porFormaPago: this.agrupar(filas, 'formaPago'),
      porEstado: this.agrupar(filas, 'estado'),
      porRepartidor: this.agrupar(filas, 'repartidor'),
      porSede: this.agrupar(filas, 'sede'),
      incompletos: filas
        .filter((f) => !f.meta.completo)
        .map((f) => ({ documento: f.interno.DOCUMENTO, falta: f.envio.CARGA })),
      otrasFechas: await this.pendientesOtrasFechas(empresaId, q, fecha, fechaFin),
    };
  }

  /**
   * Pedidos de reparto propio aún por entregar cuya fecha de entrega cae FUERA
   * del rango consultado (p. ej. vendidos hoy para entregar pasado mañana): el
   * panel los avisa para que no parezca que "faltan" en el Excel del día.
   */
  private async pendientesOtrasFechas(
    empresaId: number,
    q: ExportarRepartoQueryDto,
    fecha: string,
    fechaFin: string,
  ) {
    const items = await this.prisma.envioDespacho.findMany({
      where: {
        ...this.filtroCourier(q.courier),
        estado: { notIn: ['ENTREGADO', 'DEVUELTO'] as any },
        comprobante: {
          empresaId,
          estadoEnvioSunat: { not: 'ANULADO' as any },
          NOT: { estadoPago: 'ANULADO' as any },
          ...(q.sedeId ? { sedeId: Number(q.sedeId) } : {}),
        },
        ...(q.repartidorId ? { repartidorId: Number(q.repartidorId) } : {}),
      },
      select: { fechaEstimada: true, creadoEn: true, montoCOD: true },
    });
    const porFecha = new Map<string, { fecha: string; pedidos: number }>();
    for (const e of items) {
      const dia = e.fechaEstimada
        ? new Date(e.fechaEstimada).toISOString().slice(0, 10)
        : new Date(e.creadoEn).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
      if (dia >= fecha && dia <= fechaFin) continue;
      const cur = porFecha.get(dia) ?? { fecha: dia, pedidos: 0 };
      cur.pedidos += 1;
      porFecha.set(dia, cur);
    }
    return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  async exportarReparto(empresaId: number, q: ExportarRepartoQueryDto) {
    const modo = this.modoReporte(q.courier);
    const { items, fecha, fechaFin } = await this.despachosParaReporte(
      empresaId,
      q,
    );
    const filas = items.map((e) => this.filaReparto(e));
    const resumen = await this.resumenReparto(empresaId, q);

    const wb = XLSX.utils.book_new();
    if (modo === 'AGENCIA') {
      // Envíos por agencia: una sola hoja de datos, pensada para leer y cruzar.
      // A propósito NO se emite la plantilla de carga masiva del courier: la
      // guía se genera desde el sistema (`crearGuiaDesdeDespacho`), y producir
      // aquí un Excel para subirlo a mano reconstruiría el paso manual que ese
      // flujo ya reemplaza.
      const wsEnvios = XLSX.utils.json_to_sheet(filas.map((f) => f.envio));
      wsEnvios['!cols'] = [
        16, 12, 14, 30, 11, 12, 34, 18, 10, 12, 40, 14, 16, 11, 14, 16, 14, 20,
        34,
      ].map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, wsEnvios, 'ENVIOS');
    } else {
      // Hoja 1: EXACTAMENTE las 13 columnas de la plantilla del courier, sin extras,
      // para que se cargue tal cual en su sistema.
      const wsPedidos = XLSX.utils.json_to_sheet(filas.map((f) => f.courier));
      wsPedidos['!cols'] = [14, 34, 30, 18, 24, 40, 24, 18, 40, 18, 16, 30, 14].map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, wsPedidos, 'PEDIDOS');
      // Hoja 2: qué documento/sede/repartidor es cada fila (mismo orden que PEDIDOS).
      const wsInterno = XLSX.utils.json_to_sheet(
        filas.map((f, i) => ({ FILA: i + 1, ...f.interno, DESTINATARIO: f.courier['NOMBRE DEL DESTINATARIO'], DISTRITO: f.courier['DISTRITO (SELECCIONE SOLO DEL LISTADO)'] })),
      );
      XLSX.utils.book_append_sheet(wb, wsInterno, 'DETALLE INTERNO');
    }
    // Hoja de resumen para estadísticas.
    const t = resumen.totales;
    const bloque = (titulo: string, grupos: { nombre: string; pedidos: number; montoCobrar: number; totalVenta: number }[]) => [
      [titulo, 'PEDIDOS', 'MONTO A COBRAR', 'TOTAL VENTA'],
      ...grupos.map((g) => [g.nombre, g.pedidos, g.montoCobrar, g.totalVenta]),
      [],
    ];
    const titulo =
      modo === 'AGENCIA'
        ? `RESUMEN ENVÍOS · ${q.courier === 'TODOS' ? 'TODOS LOS COURIERS' : q.courier}`
        : 'RESUMEN REPARTO PROPIO';
    const aoa: any[][] = [
      [titulo, fecha === fechaFin ? fecha : `${fecha} a ${fechaFin}`],
      [],
      ['Pedidos', t.pedidos],
      ['Con datos completos', t.completos],
      ['Contraentrega (pedidos)', t.contraentrega],
      ['Monto a cobrar (S/)', t.montoCobrar],
      ['Total venta (S/)', t.totalVenta],
      ['Costo de envío (S/)', t.costoEnvio],
      ['Entregados', t.entregados],
      [],
      // Mes a mes y destino van primero: son las dos preguntas del empresario
      // ("a dónde mando más por mes").
      ...bloque('POR MES', resumen.porMes),
      ...bloque(
        modo === 'PROPIOS'
          ? 'POR DISTRITO'
          : q.courier === 'TODOS'
            ? 'POR DESTINO'
            : 'POR AGENCIA DESTINO',
        resumen.porDestino,
      ),
      ...bloque('POR COURIER', resumen.porCourier),
      ...(modo === 'AGENCIA'
        ? []
        : [
            ...bloque('POR TIPO DE VENTA', resumen.porTipoVenta),
            ...bloque('POR FORMA DE PAGO', resumen.porFormaPago),
            ...bloque('POR REPARTIDOR', resumen.porRepartidor),
          ]),
      ...bloque('POR ESTADO', resumen.porEstado),
      ...bloque('POR SEDE', resumen.porSede),
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(aoa);
    wsResumen['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'RESUMEN');

    const buffer: Buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const prefijo =
      modo === 'AGENCIA'
        ? `envios_${String(q.courier || '').toLowerCase()}`
        : 'reparto';
    const nombreArchivo = `${prefijo}_${fecha}${fechaFin !== fecha ? `_a_${fechaFin}` : ''}.xlsx`;
    return { buffer, nombreArchivo };
  }

  private withLegacyRepartidor<T>(envio: T): T {
    if (!envio) return envio;
    const data = envio as any;
    return {
      ...data,
      repartidor: data.repartidor?.nombre ?? null,
      repartidorData: data.repartidor ?? null,
    };
  }
}
