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
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { planPermiteShalomPro } from '../shalom/shalom.util';
import { parseFechaSoloDia } from '../common/utils/fecha';

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
  ) {}

  async getByComprobante(comprobanteId: number, empresaId: number) {
    await this.validateComprobante(comprobanteId, empresaId);
    const envio = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId },
      include: {
        repartidor: true,
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
      ESTADOS_NOTIFICABLES.has(dto.estado as EstadoDespacho)
    ) {
      this.notificarCambioEstado(
        comprobanteId,
        empresaId,
        dto.estado as EstadoDespacho,
        updated.repartidor?.nombre ?? null,
      ).catch((e) => this.logger.warn(`WA despacho fallido: ${e.message}`));
    }

    if (estadoCambia) {
      await this.syncPedidoTiendaByComprobante(
        comprobanteId,
        dto.estado as EstadoDespacho,
      );
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

  async getConfig(empresaId: number) {
    const [config, empresa] = await Promise.all([
      this.prisma.despachoMensajeTemplate.findUnique({ where: { empresaId } }),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: {
          shalomAutoTrackingActivo: true,
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
      notificarEnCamino: true,
      notificarEntregado: true,
    };
    return {
      ...base,
      // Opt-in del rastreo automático Shalom (cron 30 min). Default false.
      shalomAutoTrackingActivo: empresa?.shalomAutoTrackingActivo ?? false,
      // El plan permite editar esta configuración (`tieneShalomGuias`).
      habilitadoPorPlan: planPermiteShalomPro(empresa?.plan),
    };
  }

  async upsertConfig(empresaId: number, dto: DespachoConfigDto) {
    await this.validarPlanAutomatizacion(empresaId);
    return this.prisma.despachoMensajeTemplate.upsert({
      where: { empresaId },
      create: { empresaId, ...dto },
      update: dto,
    });
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
      comprobante: { empresaId },
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
    params?: { fecha?: string; page?: number; limit?: number },
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

    const [despachos, pedidos] = await Promise.all([
      this.prisma.envioDespacho.findMany({
        where: {
          comprobante: { empresaId },
          ...(fechaWhere ? { creadoEn: fechaWhere } : {}),
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
      const total = Number(d.comprobante.mtoImpVenta);
      const saldo = Number(d.comprobante.saldo ?? 0);
      const adelanto = Number(d.comprobante.adelanto ?? 0);
      const montoPagado =
        adelanto > 0 ? adelanto : saldo === 0 ? total : total - saldo;
      return {
        tipo: 'COMPROBANTE' as const,
        id: d.id,
        comprobanteId: d.comprobanteId,
        comprobanteTipoDoc: d.comprobante.tipoDoc,
        referencia: `${d.comprobante.serie}-${String(d.comprobante.correlativo).padStart(8, '0')}`,
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

  private async notificarCambioEstado(
    comprobanteId: number,
    empresaId: number,
    estado: EstadoDespacho,
    repartidorNombre: string | null,
  ): Promise<void> {
    const [comprobante, config] = await Promise.all([
      this.prisma.comprobante.findFirst({
        where: { id: comprobanteId },
        select: {
          serie: true,
          correlativo: true,
          cliente: { select: { nombre: true, telefono: true } },
        },
      }),
      this.prisma.despachoMensajeTemplate.findUnique({ where: { empresaId } }),
    ]);

    const telefono = comprobante?.cliente?.telefono;
    if (!telefono) return;

    const esEnCamino = estado === EstadoDespacho.EN_CAMINO;
    const esEnAgencia = estado === EstadoDespacho.EN_AGENCIA;
    const pedidoRef = `${comprobante.serie}-${String(comprobante.correlativo).padStart(8, '0')}`;

    const nombre = comprobante?.cliente?.nombre ?? 'Cliente';

    if (esEnAgencia) {
      const saldo = Number((comprobante as any)?.saldo ?? 0);
      const agencia =
        (
          await this.prisma.envioDespacho.findFirst({
            where: { comprobanteId },
            select: { agenciaDestino: true },
          })
        )?.agenciaDestino ?? 'la agencia';
      // Plantilla aprobada por Meta: se entrega fuera de la ventana de 24h, sin bloqueo.
      if (saldo > 0) {
        // pedido_en_destino_cobro → {{1}} nombre, {{2}} pedido, {{3}} agencia, {{4}} saldo
        await this.whatsapp.enviarPlantilla(
          telefono,
          'pedido_en_destino_cobro',
          'es',
          [nombre, pedidoRef, agencia, saldo.toFixed(2)],
          empresaId,
        );
      } else {
        // pedido_en_destino → {{1}} nombre, {{2}} pedido, {{3}} agencia
        await this.whatsapp.enviarPlantilla(
          telefono,
          'pedido_en_destino',
          'es',
          [nombre, pedidoRef, agencia],
          empresaId,
        );
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
      // pedido_en_camino → {{1}} nombre, {{2}} pedido, {{3}} repartidor
      await this.whatsapp.enviarPlantilla(
        telefono,
        'pedido_en_camino',
        'es',
        [nombre, pedidoRef, repartidorNombre ?? 'Sin asignar'],
        empresaId,
      );
    } else {
      // pedido_entregado → {{1}} nombre, {{2}} pedido
      await this.whatsapp.enviarPlantilla(
        telefono,
        'pedido_entregado',
        'es',
        [nombre, pedidoRef],
        empresaId,
      );
    }
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

  async confirmarPago(comprobanteId: number, empresaId: number): Promise<void> {
    const comprobante = await this.prisma.comprobante.findFirst({
      where: { id: comprobanteId, empresaId },
      select: {
        id: true,
        serie: true,
        correlativo: true,
        saldo: true,
        cliente: { select: { nombre: true, telefono: true } },
      },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');

    await this.prisma.comprobante.update({
      where: { id: comprobanteId },
      data: { saldo: 0, estadoPago: 'COMPLETADO' },
    });

    const telefono = comprobante.cliente?.telefono;
    if (telefono) {
      const pedidoRef = `${comprobante.serie}-${String(comprobante.correlativo).padStart(8, '0')}`;
      const nombre = comprobante.cliente?.nombre ?? 'Cliente';
      // pago_confirmado → {{1}} nombre, {{2}} pedido
      this.whatsapp
        .enviarPlantilla(
          telefono,
          'pago_confirmado',
          'es',
          [nombre, pedidoRef],
          empresaId,
        )
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
  private async despachosRepartoPropio(
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
        transportista: 'PROPIOS',
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

  /** Fila de la plantilla del courier + los datos internos, para export y resumen. */
  private filaReparto(e: any) {
    const c = e.comprobante;
    const cobra =
      e.tipoVentaReparto === 'CONTRAENTREGA' ||
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
    const faltan: string[] = [];
    if (!e.tipoVentaReparto) faltan.push('tipo de venta');
    if (!nombre) faltan.push('nombre');
    if (!/^9\d{8}$/.test(telefono)) faltan.push('teléfono');
    if (!distrito) faltan.push('distrito');
    if (!direccion) faltan.push('dirección');
    if (!detalle) faltan.push('detalle');
    // Un pedido ya entregado no vuelve al motorizado: si además ya se cobró
    // (saldo 0), no es un dato faltante sino un cobro cerrado.
    if (cobra && montoCobrar <= 0 && e.estado !== 'ENTREGADO')
      faltan.push('monto a cobrar');
    if (cobra && (!e.formaPagoCobro || e.formaPagoCobro === 'NO_COBRAR'))
      faltan.push('forma de pago');
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
      meta: {
        completo: faltan.length === 0,
        cobra,
        montoCobrar,
        distrito: distrito || '(sin distrito)',
        tipoVenta: e.tipoVentaReparto || '(sin tipo)',
        formaPago: cobra ? e.formaPagoCobro || '(sin forma)' : 'NO_COBRAR',
        estado: e.estado,
        repartidor: e.repartidor?.nombre || '(sin repartidor)',
        sede: c?.sede?.nombre || '(sin sede)',
        totalVenta: this.round2(totalPen),
        costoEnvio: this.round2(Number(e.costoEnvio ?? 0)),
      },
    };
  }

  /** Agrupa contando pedidos y sumando monto a cobrar; base de las estadísticas. */
  private agrupar(
    filas: ReturnType<EnvioDespachoService['filaReparto']>[],
    key: 'distrito' | 'tipoVenta' | 'formaPago' | 'estado' | 'repartidor' | 'sede',
  ) {
    const map = new Map<string, { pedidos: number; montoCobrar: number; totalVenta: number }>();
    for (const f of filas) {
      const k = f.meta[key];
      const acc = map.get(k) ?? { pedidos: 0, montoCobrar: 0, totalVenta: 0 };
      acc.pedidos += 1;
      acc.montoCobrar = this.round2(acc.montoCobrar + f.meta.montoCobrar);
      acc.totalVenta = this.round2(acc.totalVenta + f.meta.totalVenta);
      map.set(k, acc);
    }
    return [...map.entries()]
      .map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.pedidos - a.pedidos || a.nombre.localeCompare(b.nombre));
  }

  async resumenReparto(empresaId: number, q: ExportarRepartoQueryDto) {
    const { items, fecha, fechaFin } = await this.despachosRepartoPropio(empresaId, q);
    const filas = items.map((e) => this.filaReparto(e));
    const totales = filas.reduce(
      (acc, f) => ({
        pedidos: acc.pedidos + 1,
        completos: acc.completos + (f.meta.completo ? 1 : 0),
        contraentrega: acc.contraentrega + (f.meta.cobra ? 1 : 0),
        montoCobrar: this.round2(acc.montoCobrar + f.meta.montoCobrar),
        totalVenta: this.round2(acc.totalVenta + f.meta.totalVenta),
        costoEnvio: this.round2(acc.costoEnvio + f.meta.costoEnvio),
        entregados: acc.entregados + (f.meta.estado === 'ENTREGADO' ? 1 : 0),
      }),
      { pedidos: 0, completos: 0, contraentrega: 0, montoCobrar: 0, totalVenta: 0, costoEnvio: 0, entregados: 0 },
    );
    return {
      fecha,
      fechaFin,
      totales,
      porDistrito: this.agrupar(filas, 'distrito'),
      porTipoVenta: this.agrupar(filas, 'tipoVenta'),
      porFormaPago: this.agrupar(filas, 'formaPago'),
      porEstado: this.agrupar(filas, 'estado'),
      porRepartidor: this.agrupar(filas, 'repartidor'),
      porSede: this.agrupar(filas, 'sede'),
      incompletos: filas
        .filter((f) => !f.meta.completo)
        .map((f) => ({ documento: f.interno.DOCUMENTO, falta: f.courier.CARGA })),
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
        transportista: 'PROPIOS',
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
    const { items, fecha, fechaFin } = await this.despachosRepartoPropio(empresaId, q);
    const filas = items.map((e) => this.filaReparto(e));
    const resumen = await this.resumenReparto(empresaId, q);

    const wb = XLSX.utils.book_new();
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
    // Hoja 3: resumen para estadísticas.
    const t = resumen.totales;
    const bloque = (titulo: string, grupos: { nombre: string; pedidos: number; montoCobrar: number; totalVenta: number }[]) => [
      [titulo, 'PEDIDOS', 'MONTO A COBRAR', 'TOTAL VENTA'],
      ...grupos.map((g) => [g.nombre, g.pedidos, g.montoCobrar, g.totalVenta]),
      [],
    ];
    const aoa: any[][] = [
      ['RESUMEN REPARTO PROPIO', fecha === fechaFin ? fecha : `${fecha} a ${fechaFin}`],
      [],
      ['Pedidos', t.pedidos],
      ['Con datos completos', t.completos],
      ['Contraentrega (pedidos)', t.contraentrega],
      ['Monto a cobrar (S/)', t.montoCobrar],
      ['Total venta (S/)', t.totalVenta],
      ['Costo de envío (S/)', t.costoEnvio],
      ['Entregados', t.entregados],
      [],
      ...bloque('POR DISTRITO', resumen.porDistrito),
      ...bloque('POR TIPO DE VENTA', resumen.porTipoVenta),
      ...bloque('POR FORMA DE PAGO', resumen.porFormaPago),
      ...bloque('POR ESTADO', resumen.porEstado),
      ...bloque('POR REPARTIDOR', resumen.porRepartidor),
      ...bloque('POR SEDE', resumen.porSede),
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(aoa);
    wsResumen['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'RESUMEN');

    const buffer: Buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const nombreArchivo = `reparto_${fecha}${fechaFin !== fecha ? `_a_${fechaFin}` : ''}.xlsx`;
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
