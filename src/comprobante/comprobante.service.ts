import { num, round3 } from '../common/utils/stock';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  Prisma,
  EstadoProductoSerie,
  EstadoReserva,
  EstadoSunat,
  EstadoType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KardexService } from '../kardex/kardex.service';
import { InventarioNotificacionesService } from '../notificaciones/inventario-notificaciones.service';
import { S3Service } from '../s3/s3.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { numeroALetras } from './utils/numero-a-letras';
import { ProductoLoteService } from '../producto/producto-lote.service';
import { EnviarSunatService } from './enviar-sunat.service';
import {
  isJambleProvider,
  resolveBillingProvider,
} from '../common/utils/billing-provider';
import { ComisionesService } from '../comisiones/comisiones.service';

@Injectable()
export class ComprobanteService {
  private readonly logger = new Logger(ComprobanteService.name);

  private readonly adminSistemaRole = 'ADMIN_SISTEMA';

  private esProductoServicio(atributosTecnicos?: Record<string, any> | null) {
    return (
      String(atributosTecnicos?.tipoProducto || '').toUpperCase() === 'SERVICIO'
    );
  }

  private getJambleCorrelativoFloor(
    empresaId: number,
    serie: string,
  ): number | null {
    // Format:
    // JAMBLE_CORRELATIVO_FLOOR="43:B001:60,43:F001:16,50:B001:120"
    const raw = String(process.env.JAMBLE_CORRELATIVO_FLOOR || '').trim();
    if (!raw) return null;

    const entries = raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    for (const entry of entries) {
      const [empresa, serieCfg, floor] = entry
        .split(':')
        .map((v) => String(v || '').trim());
      if (!empresa || !serieCfg || !floor) continue;
      if (Number(empresa) !== empresaId) continue;
      if (serieCfg.toUpperCase() !== String(serie || '').toUpperCase())
        continue;
      const value = Number(floor);
      if (!Number.isNaN(value) && value > 0) return value;
    }
    return null;
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => KardexService))
    private readonly kardexService: KardexService,
    private readonly inventarioNotificaciones: InventarioNotificacionesService,
    private readonly s3Service: S3Service,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly loteService: ProductoLoteService,
    @Inject(forwardRef(() => EnviarSunatService))
    private readonly enviarSunatService: EnviarSunatService,
    @Optional() private readonly comisionesService: ComisionesService,
  ) {}

  private normalizarMedioPago(value?: string) {
    return String(value || 'EFECTIVO')
      .trim()
      .toUpperCase();
  }

  private normalizarDetallePago(
    input: any,
    medioPago: string,
    montoObjetivo: number,
  ) {
    const objetivo = Math.max(0, this.round2(Number(montoObjetivo || 0)));
    const source = input && typeof input === 'object' ? input : {};
    const rawLines = Array.isArray(source.splitPayments)
      ? source.splitPayments
      : Array.isArray(source.pagos)
        ? source.pagos
        : [];

    const lines =
      rawLines.length > 0
        ? rawLines
        : [
            {
              method: source.method || medioPago,
              amount: source.amount || objetivo,
              referencia: source.referencia,
              cuentaBancariaId: source.cuentaBancariaId,
              tarjetaMarca: source.tarjetaMarca,
              tarjetaTipo: source.tarjetaTipo,
              tarjetaUltimos4: source.tarjetaUltimos4,
            },
          ];

    let restante = objetivo;
    return lines
      .map((line: any) => {
        const requestedAmount = this.round2(Number(line?.amount || 0));
        const amount =
          rawLines.length > 0 ? Math.min(requestedAmount, restante) : objetivo;
        restante = this.round2(restante - amount);
        return {
          method: this.normalizarMedioPago(line?.method),
          amount,
          referencia: String(line?.referencia || '').trim() || null,
          cuentaBancariaId: line?.cuentaBancariaId
            ? Number(line.cuentaBancariaId)
            : null,
          tarjetaMarca: String(line?.tarjetaMarca || '').trim() || null,
          tarjetaTipo: String(line?.tarjetaTipo || '').trim() || null,
          tarjetaUltimos4:
            String(line?.tarjetaUltimos4 || '')
              .replace(/\D/g, '')
              .slice(-4) || null,
        };
      })
      .filter((line: any) => line.amount > 0);
  }

  private async validarDetallePago(
    input: any,
    medioPago: string,
    montoObjetivo: number,
    empresaId: number,
  ) {
    const lines = this.normalizarDetallePago(input, medioPago, montoObjetivo);
    for (const line of lines) {
      if (
        ['TRANSFERENCIA', 'TARJETA'].includes(line.method) &&
        !line.referencia
      ) {
        throw new BadRequestException(
          `El pago por ${line.method} requiere número de operación o voucher`,
        );
      }
      if (line.method === 'TRANSFERENCIA') {
        if (!line.cuentaBancariaId) {
          throw new BadRequestException(
            'El pago por transferencia requiere cuenta bancaria destino',
          );
        }
        const cuenta = await this.prisma.cuentaBancaria.findFirst({
          where: { id: line.cuentaBancariaId, empresaId, activo: true },
          select: { id: true },
        });
        if (!cuenta) {
          throw new BadRequestException(
            'La cuenta bancaria destino no pertenece a la empresa o está inactiva',
          );
        }
      }
    }
    return lines;
  }

  private async registrarPagosDeEmision(params: {
    comprobanteId: number;
    empresaId: number;
    usuarioId?: number;
    medioPago: string;
    paymentDetails?: any;
    montoPagado: number;
    documento: string;
    fecha?: Date;
  }) {
    const montoPagado = this.round2(Number(params.montoPagado || 0));
    if (montoPagado <= 0) return;
    const lines = await this.validarDetallePago(
      params.paymentDetails,
      params.medioPago,
      montoPagado,
      params.empresaId,
    );
    if (lines.length === 0) return;

    await this.prisma.pago.createMany({
      data: lines.map((line: any) => ({
        comprobanteId: params.comprobanteId,
        empresaId: params.empresaId,
        usuarioId: params.usuarioId ?? null,
        fecha: params.fecha ?? new Date(),
        monto: line.amount,
        medioPago: line.method,
        observacion: `Pago registrado al emitir ${params.documento}`,
        referencia: line.referencia || params.documento,
        cuentaBancariaId: line.cuentaBancariaId,
      })),
    });
  }

  async listarTipoOperacion() {
    return this.prisma.tipoOperacion.findMany({ orderBy: { codigo: 'asc' } });
  }

  async listarTiposDetraccion() {
    return this.prisma.tipoDetraccion.findMany({
      where: { activo: true },
      orderBy: { codigo: 'asc' },
    });
  }

  async listarMediosPagoDetraccion() {
    return this.prisma.medioPagoDetraccion.findMany({
      where: { activo: true },
      orderBy: { codigo: 'asc' },
    });
  }

  async listar(params: {
    empresaId: number;
    sedeId?: number;
    usuarioId?: number;
    tipoComprobante: 'FORMAL' | 'INFORMAL' | 'COTIZACION' | 'TODOS';
    search?: string;
    page?: number;
    limit?: number;
    sort?: string;
    order?: 'asc' | 'desc';
    fechaInicio?: string;
    fechaFin?: string;
    estado?: string;
    tipoDoc?: string;
    estadoPago?: string;
  }) {
    const {
      empresaId,
      usuarioId,
      tipoComprobante,
      search,
      page = 1,
      limit = 10,
      sort = 'id',
      order = 'desc',
      fechaInicio,
      fechaFin,
      estado,
      tipoDoc,
      estadoPago,
    } = params;

    try {
      const skip = (page - 1) * limit;
      const normalizedEstado =
        typeof estado === 'string' && estado.trim().length > 0
          ? estado.trim().toUpperCase()
          : undefined;
      const validEstadosSunat = new Set(Object.values(EstadoSunat));
      const estadoSunatFilter =
        normalizedEstado &&
        validEstadosSunat.has(normalizedEstado as EstadoSunat)
          ? (normalizedEstado as EstadoSunat)
          : undefined;

      if (
        tipoComprobante === 'FORMAL' &&
        normalizedEstado &&
        !estadoSunatFilter
      ) {
        this.logger.warn(
          `Filtro estado inválido recibido en listar: "${estado}". Se ignorará el filtro estadoEnvioSunat.`,
        );
      }

      const tiposFormales = ['01', '03', '07', '08'];
      const tiposInformales = ['TICKET', 'NV', 'RH', 'CP', 'NP', 'OT'];
      const tiposCotizacion = ['COT'];

      let tiposPermitidos: string[];
      if (tipoComprobante === 'FORMAL') {
        tiposPermitidos = tiposFormales;
      } else if (tipoComprobante === 'COTIZACION') {
        tiposPermitidos = tiposCotizacion;
      } else if (tipoComprobante === 'TODOS') {
        tiposPermitidos = [...tiposFormales, ...tiposInformales];
      } else {
        tiposPermitidos = tiposInformales;
      }

      // Validar tipoDoc si viene
      if (tipoDoc && !tiposPermitidos.includes(tipoDoc)) {
        throw new BadRequestException(
          `El tipo de documento debe ser uno de: ${tiposPermitidos.join(', ')}`,
        );
      }

      let adjustedFechaInicio: string | undefined;
      let adjustedFechaFin: string | undefined;
      if (fechaInicio) {
        adjustedFechaInicio = new Date(
          `${fechaInicio}T00:00:00.000-05:00`,
        ).toISOString();
      }
      if (fechaFin) {
        adjustedFechaFin = new Date(
          `${fechaFin}T23:59:59.999-05:00`,
        ).toISOString();
      }

      // Build sedeId filter — for the principal sede also include legacy records (sedeId=null)
      let sedeFilter: any = {};
      if (params.sedeId) {
        const esPrincipal = await this.prisma.sede.findFirst({
          where: { empresaId, id: params.sedeId, esPrincipal: true },
          select: { id: true },
        });
        if (esPrincipal) {
          // Legacy comprobantes were created with sedeId=null before the JWT fix
          sedeFilter = {
            AND: [{ OR: [{ sedeId: params.sedeId }, { sedeId: null }] }],
          };
        } else {
          sedeFilter = { sedeId: params.sedeId };
        }
      }

      const where: any = {
        empresaId,
        ...sedeFilter,
        ...(usuarioId ? { usuarioId } : {}),
        tipoDoc: { in: tipoDoc ? [tipoDoc] : tiposPermitidos },
        ...(search
          ? {
              OR: [
                { serie: { contains: search, mode: 'insensitive' } },
                ...(Number.isNaN(+search)
                  ? []
                  : [{ correlativo: parseInt(search, 10) }]),
                {
                  cliente: {
                    nroDoc: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  cliente: {
                    nombre: { contains: search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
        ...(fechaInicio || fechaFin
          ? {
              fechaEmision: {
                ...(adjustedFechaInicio
                  ? { gte: adjustedFechaInicio as any }
                  : {}),
                ...(adjustedFechaFin ? { lte: adjustedFechaFin as any } : {}),
              },
            }
          : {}),
        ...(tipoComprobante === 'FORMAL' && estadoSunatFilter
          ? { estadoEnvioSunat: estadoSunatFilter }
          : {}),
        ...(['INFORMAL', 'TODOS'].includes(tipoComprobante) && estadoPago
          ? { estadoPago: estadoPago as any }
          : {}),
      };

      const [rawItems, totalDb] = await Promise.all([
        this.prisma.comprobante.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ [sort]: order }, { id: 'desc' }] as any,
          include: {
            cliente: {
              select: {
                id: true,
                nombre: true,
                nroDoc: true,
                persona: true,
                telefono: true,
              },
            },
            detalles: {
              select: {
                producto: {
                  select: { id: true, descripcion: true, imagenUrl: true },
                },
                unidad: true,
                descripcion: true,
                cantidad: true,
                mtoValorUnitario: true,
                mtoValorVenta: true,
                mtoBaseIgv: true,
                porcentajeIgv: true,
                igv: true,
                totalImpuestos: true,
                mtoPrecioUnitario: true,
              },
            },
            leyendas: { select: { code: true, value: true } },
            motivo: { select: { codigo: true, descripcion: true } },
            tipoOperacion: { select: { codigo: true, descripcion: true } },
            usuario: { select: { id: true, nombre: true } },
            sede: { select: { id: true, nombre: true } },
            envioDespacho: {
              select: {
                id: true,
                comprobanteId: true,
                estado: true,
                transportista: true,
                tipoEnvio: true,
                agenciaDestino: true,
                direccionDestino: true,
                celularDest: true,
                nroPaquetes: true,
                turnoEnvio: true,
                creadoEn: true,
              },
            },
          },
        }),
        this.prisma.comprobante.count({ where }),
      ]);

      const tipoLabels: Record<string, string> = {
        '01': 'FACTURA',
        '03': 'BOLETA',
        '07': 'NOTA DE CREDITO',
        '08': 'NOTA DE DEBITO',
        COT: 'COTIZACIÓN',
        TICKET: 'TICKET',
        NV: 'NOTA DE VENTA',
        RH: 'RECIBO POR HONORARIOS',
        CP: 'COMPROBANTE DE PAGO',
        NP: 'NOTA DE PEDIDO',
        OT: 'ORDEN DE TRABAJO',
      };

      // Mapear etiqueta de comprobante (estadoPago/saldo ya vienen de DB si existen)
      const mapped = rawItems.map((it) => {
        const comprobante = tipoLabels[it.tipoDoc] || it.tipoDoc;
        return { ...it, comprobante } as any;
      });

      return { comprobantes: mapped, total: totalDb, page, limit };
    } catch (error: any) {
      this.logger.error(
        `Error al listar comprobantes: ${error?.message || 'Error desconocido'}`,
      );
      throw error;
    }
  }

  async siguienteCorrelativo(
    empresaId: number,
    tipoDoc: string,
    tipDocAfectado?: string,
  ) {
    console.log(
      '[ComprobanteService.siguienteCorrelativo] empresaId:',
      empresaId,
      'tipoDoc:',
      tipoDoc,
      'tipDocAfectado:',
      tipDocAfectado,
    );

    try {
      const tiposValidos = [
        '01',
        '03',
        '07',
        '08',
        'COT', // Cotización
        'TICKET',
        'NV',
        'RH',
        'CP',
        'NP',
        'OT',
      ];
      if (!tiposValidos.includes(tipoDoc)) {
        throw new BadRequestException('tipoDoc inválido');
      }
      if ((tipoDoc === '07' || tipoDoc === '08') && !tipDocAfectado) {
        throw new BadRequestException('tipDocAfectado requerido para notas');
      }
      // Reusar la misma lógica centralizada para serie y correlativo
      const { serie, correlativo } = await this.obtenerSerieYCorrelativo(
        tipoDoc,
        tipDocAfectado ?? null,
        empresaId,
      );
      console.log(
        '[ComprobanteService.siguienteCorrelativo] Success - serie:',
        serie,
        'correlativo:',
        correlativo,
      );
      return { serie, correlativo };
    } catch (error: any) {
      console.error(
        '[ComprobanteService.siguienteCorrelativo] ❌ ERROR:',
        error.message,
      );
      console.error(
        '[ComprobanteService.siguienteCorrelativo] Error code:',
        error.code,
      );
      console.error(
        '[ComprobanteService.siguienteCorrelativo] Full error:',
        JSON.stringify(error, null, 2),
      );
      throw error;
    }
  }

  async detalle(
    empresaId: number,
    serie: string,
    correlativo: number,
    sedeId?: number,
  ) {
    const comp = await this.prisma.comprobante.findFirst({
      where: { empresaId, serie, correlativo, ...(sedeId ? { sedeId } : {}) },
      include: {
        cliente: true,
        detalles: {
          include: {
            producto: true,
            lote: { select: { lote: true, fechaVencimiento: true } },
          },
        },
        pagos: true,
      },
    });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');
    return comp;
  }

  async obtenerPorId(empresaId: number, id: number, sedeId?: number) {
    let sedeFilter: any = {};
    if (sedeId) {
      const esPrincipal = await this.prisma.sede.findFirst({
        where: { empresaId, id: sedeId, esPrincipal: true },
        select: { id: true },
      });
      if (esPrincipal) {
        sedeFilter = { AND: [{ OR: [{ sedeId: sedeId }, { sedeId: null }] }] };
      } else {
        sedeFilter = { sedeId };
      }
    }

    const comp = await this.prisma.comprobante.findFirst({
      where: { empresaId, id, ...sedeFilter },
      include: {
        cliente: true,
        detalles: {
          include: {
            producto: {
              select: {
                id: true,
                descripcion: true,
                imagenUrl: true,
              },
            },
            lote: { select: { lote: true, fechaVencimiento: true } },
          },
        },
        usuario: {
          select: {
            id: true,
            nombre: true,
          },
        },
        tipoDetraccion: true,
        medioPagoDetraccion: true,
        pagos: true,
      },
    });

    if (!comp) throw new NotFoundException('Comprobante no encontrado');

    // Obtener información de lotes desde el Kardex (Soporte Dual: Campos Planos y Relación KardexLote)
    const movimientos = await this.prisma.movimientoKardex.findMany({
      where: {
        comprobanteId: id,
        empresaId,
        tipoMovimiento: 'SALIDA',
      },
      select: {
        productoId: true,
        lote: true, // Legacy / Simple
        fechaVencimiento: true, // Legacy / Simple
        movimientoLotes: {
          // Sistema de Lotes Complejo
          select: {
            lote: {
              select: {
                lote: true,
                fechaVencimiento: true,
              },
            },
          },
        },
      },
    });

    // Enriquecer detalles con información de lotes
    const detallesConLotes = comp.detalles.map((detalle) => {
      const lotesEncontrados = movimientos
        .filter((m) => m.productoId === detalle.productoId)
        .map((m) => {
          // Prioridad: Relación > Campo Plano
          if (m.movimientoLotes.length > 0) {
            const primerLote = m.movimientoLotes[0]?.lote;
            if (!primerLote) return null;
            return {
              lote: primerLote.lote,
              fechaVencimiento: primerLote.fechaVencimiento,
            };
          } else if (m.lote) {
            return {
              lote: m.lote,
              fechaVencimiento: m.fechaVencimiento,
            };
          }
          return null;
        })
        .filter((l) => l !== null); // Filtrar nulos

      // Eliminar duplicados si hubiera breakdown por mismo lote
      const uniqueLotes = lotesEncontrados.filter(
        (v, i, a) => a.findIndex((t) => t?.lote === v?.lote) === i,
      );

      return {
        ...detalle,
        lotes: uniqueLotes,
      };
    });

    return { ...comp, detalles: detallesConLotes };
  }

  async anularComprobante(comprobanteId: number, motivo?: string) {
    const comp = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      include: { detalles: true },
    });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');
    const isInformal = ['TICKET', 'NV', 'RH', 'CP', 'NP', 'OT'].includes(
      comp.tipoDoc,
    );
    const isFormal = ['01', '03', '08'].includes(comp.tipoDoc);

    // Documentos SUNAT formales: Boleta y Factura ya aceptadas NO pueden darse de baja directamente.
    // - Boleta (03): comunicación de baja SUNAT — use Nota de Crédito (botón "Generar NC")
    // - Factura (01): SUNAT exige Nota de Crédito, nunca baja directa
    // - Nota de Débito (08): ídem, use Nota de Crédito
    if (isFormal && comp.estadoEnvioSunat === 'EMITIDO') {
      const tipoNombre =
        comp.tipoDoc === '01'
          ? 'Factura'
          : comp.tipoDoc === '03'
            ? 'Boleta'
            : 'Nota de Débito';
      throw new BadRequestException(
        `Una ${tipoNombre} ya aceptada por SUNAT debe anularse emitiendo una Nota de Crédito. Use el botón "Generar NC (Anular)".`,
      );
    }

    // Revertir stock para todos los tipos de comprobantes que afectan inventario
    // (tanto formales como informales, excluyendo notas de crédito que ya manejan su propio stock)
    if ((isInformal || isFormal) && comp.detalles && comp.tipoDoc !== '07') {
      await this.revertirStock(comp.detalles, {
        empresaId: comp.empresaId,
        comprobanteId: comp.id,
        concepto: `Anulación ${comp.tipoDoc} ${comp.serie}-${comp.correlativo}`,
      });
    }

    // Eliminar pagos registrados — la venta queda anulada, no hubo cobro válido.
    // La caja ya excluye comprobantes ANULADO al calcular totales de cierre,
    // pero los pagos individuales deben borrarse para no inflar reportes de ingresos.
    await this.prisma.pago.deleteMany({
      where: { comprobanteId: comp.id },
    });

    return this.prisma.comprobante.update({
      where: { id: comprobanteId },
      data: {
        estadoEnvioSunat: EstadoSunat.ANULADO,
        ...(isInformal ? { estadoPago: 'ANULADO' as any, saldo: 0 } : {}),
      },
    });
  }

  async completarPagoOT(
    comprobanteId: number,
    input: any,
    usuarioId?: number,
    empresaId?: number,
  ) {
    const comp = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
    });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');

    if (empresaId && comp.empresaId !== empresaId) {
      throw new BadRequestException('El comprobante no pertenece a tu empresa');
    }
    const isInformal = ['TICKET', 'NV', 'RH', 'CP', 'NP', 'OT'].includes(
      comp.tipoDoc,
    );
    if (!isInformal)
      throw new BadRequestException(
        'Completar pago aplica solo para comprobantes informales',
      );
    if (comp.estadoEnvioSunat === 'ANULADO')
      throw new BadRequestException(
        'No se puede completar pago de un comprobante anulado',
      );

    const montoPagado = input?.montoPagado ?? comp.saldo ?? 0;
    const saldoActual = comp.saldo ?? 0;

    if (montoPagado <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }
    if (montoPagado > saldoActual) {
      throw new BadRequestException(
        `El monto no puede exceder el saldo pendiente (${saldoActual})`,
      );
    }

    // Create payment record
    const pago = await this.prisma.pago.create({
      data: {
        comprobanteId,
        usuarioId,
        empresaId: comp.empresaId,
        monto: montoPagado,
        medioPago: (input?.medioPago ?? 'EFECTIVO').toUpperCase(),
        observacion: input?.observacion || null,
        referencia: input?.referencia || null,
        cuentaBancariaId: input?.cuentaBancariaId ?? null,
      },
    });

    const nuevoSaldo = saldoActual - montoPagado;
    let nuevoEstado = 'PAGO_PARCIAL';
    if (nuevoSaldo <= 0) {
      nuevoEstado = 'COMPLETADO';
    }

    const comprobanteActualizado = await this.prisma.comprobante.update({
      where: { id: comprobanteId },
      data: {
        estadoPago: nuevoEstado as any,
        saldo: Math.max(0, nuevoSaldo),
        ...(input?.medioPago
          ? { medioPago: (input.medioPago as string).toUpperCase() }
          : {}),
      },
    });

    return { pago, comprobanteActualizado };
  }

  private round2(n: number): number {
    return parseFloat(n.toFixed(2));
  }

  private normalizarNumerosSerie(value: unknown): string[] {
    const raw = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/[\n,;]+/)
        : [];
    return Array.from(
      new Set(
        raw
          .map((serie) =>
            String(serie ?? '')
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean),
      ),
    );
  }

  private atributosProducto(producto: any): Record<string, any> {
    const attrs = producto?.atributosTecnicos;
    if (!attrs) return {};
    if (typeof attrs === 'string') {
      try {
        return JSON.parse(attrs);
      } catch {
        return {};
      }
    }
    return typeof attrs === 'object' ? attrs : {};
  }

  private productoRequiereSerie(producto: any): boolean {
    const attrs = this.atributosProducto(producto);
    const control = String(
      attrs.controlSeries ?? attrs.requiereSerie ?? '',
    ).toLowerCase();
    return (
      attrs.controlSeries === true ||
      attrs.requiereSerie === true ||
      ['true', 'si', 'sí', '1'].includes(control)
    );
  }

  private garantiaMesesProducto(producto: any): number | undefined {
    const attrs = this.atributosProducto(producto);
    const meses = Number(attrs.garantiaMeses ?? attrs.garantia ?? 0);
    return Number.isFinite(meses) && meses > 0 ? Math.trunc(meses) : undefined;
  }

  private async validarSeriesComprobante(
    detalles: any[],
    empresaId: number,
    esVenta = true,
  ) {
    if (!esVenta) return;

    const seriesSolicitadas = detalles.flatMap(
      (detalle) => detalle.numerosSerie ?? [],
    );
    const duplicadas = seriesSolicitadas.filter(
      (serie, index) => seriesSolicitadas.indexOf(serie) !== index,
    );
    if (duplicadas.length > 0) {
      throw new BadRequestException(
        `Series duplicadas en el comprobante: ${Array.from(new Set(duplicadas)).join(', ')}`,
      );
    }

    for (const detalle of detalles) {
      if (!detalle.productoId) continue;
      const cantidad = Number(detalle.cantidad);
      const numerosSerie = this.normalizarNumerosSerie(detalle.numerosSerie);
      const requiereSerie = Boolean(detalle.requiereSerie);

      if (
        (requiereSerie || numerosSerie.length > 0) &&
        (!Number.isInteger(cantidad) || cantidad <= 0)
      ) {
        throw new BadRequestException(
          `El producto "${detalle.descripcion}" requiere cantidad entera para controlar series.`,
        );
      }

      if (requiereSerie && numerosSerie.length !== cantidad) {
        throw new BadRequestException(
          `El producto "${detalle.descripcion}" requiere ${cantidad} serie(s). Recibidas: ${numerosSerie.length}.`,
        );
      }

      if (numerosSerie.length > 0 && numerosSerie.length !== cantidad) {
        throw new BadRequestException(
          `La cantidad de series de "${detalle.descripcion}" debe coincidir con la cantidad vendida.`,
        );
      }
    }

    if (seriesSolicitadas.length === 0) return;

    const existentes = await this.prisma.productoSerie.findMany({
      where: {
        empresaId,
        numeroSerie: { in: seriesSolicitadas },
      },
      select: { numeroSerie: true, productoId: true, estado: true },
    });

    for (const existente of existentes) {
      const detalle = detalles.find((d) =>
        (d.numerosSerie ?? []).includes(existente.numeroSerie),
      );
      if (!detalle) continue;
      if (existente.productoId !== Number(detalle.productoId)) {
        throw new BadRequestException(
          `La serie ${existente.numeroSerie} pertenece a otro producto.`,
        );
      }
      if (
        existente.estado === EstadoProductoSerie.VENDIDO ||
        existente.estado === EstadoProductoSerie.BAJA
      ) {
        throw new BadRequestException(
          `La serie ${existente.numeroSerie} no está disponible.`,
        );
      }
    }
  }

  private async registrarSeriesVendidas(
    comprobanteId: number,
    empresaId: number,
    sedeId?: number | null,
  ) {
    const detalles = await this.prisma.detalleComprobante.findMany({
      where: { comprobanteId, numerosSerie: { not: Prisma.JsonNull } },
      select: {
        id: true,
        productoId: true,
        numerosSerie: true,
        producto: { select: { atributosTecnicos: true } },
      },
    });

    for (const detalle of detalles) {
      if (!detalle.productoId) continue;
      const numerosSerie = this.normalizarNumerosSerie(detalle.numerosSerie);
      if (numerosSerie.length === 0) continue;
      const garantiaMeses = this.garantiaMesesProducto(detalle.producto);
      const garantiaHasta = garantiaMeses
        ? new Date(new Date().setMonth(new Date().getMonth() + garantiaMeses))
        : undefined;

      for (const numeroSerie of numerosSerie) {
        await this.prisma.productoSerie.upsert({
          where: { empresaId_numeroSerie: { empresaId, numeroSerie } },
          create: {
            empresaId,
            productoId: detalle.productoId,
            sedeId: sedeId ?? undefined,
            numeroSerie,
            estado: EstadoProductoSerie.VENDIDO,
            garantiaMeses,
            garantiaHasta,
            comprobanteId,
            detalleComprobanteId: detalle.id,
          },
          update: {
            estado: EstadoProductoSerie.VENDIDO,
            garantiaMeses,
            garantiaHasta,
            comprobanteId,
            detalleComprobanteId: detalle.id,
            sedeId: sedeId ?? undefined,
          },
        });
      }
    }
  }

  private limpiarDetalleParaPersistencia(detalles: any[]) {
    return detalles.map(({ requiereSerie, ...detalle }) => detalle);
  }

  // Crea el comprobante con reintentos automáticos en caso de colisión de correlativo (race condition)
  private async crearComprobanteConReintento(
    data: any,
    tipoDoc: string,
    tipDocAfectado: string | null,
    empresaId: number,
    maxIntentos = 5,
  ) {
    let intento = 0;
    while (intento < maxIntentos) {
      const { serie, correlativo } = await this.obtenerSerieYCorrelativo(
        tipoDoc,
        tipDocAfectado,
        empresaId,
      );
      try {
        return await this.prisma.comprobante.create({
          data: { ...data, serie, correlativo },
        });
      } catch (err: any) {
        if (err?.code === 'P2002' && intento < maxIntentos - 1) {
          intento++;
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException(
      'No se pudo generar el correlativo. Intente de nuevo.',
    );
  }

  private async obtenerSerieYCorrelativo(
    tipoDoc: string,
    tipDocAfectado: string | null,
    empresaId: number,
  ) {
    console.log(
      '[obtenerSerieYCorrelativo] tipoDoc:',
      tipoDoc,
      'tipDocAfectado:',
      tipDocAfectado,
      'empresaId:',
      empresaId,
    );

    try {
      const empresaProvider = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { billingProvider: true, usaDemo: true },
      });
      const billingProvider = resolveBillingProvider(empresaProvider as any);
      const useJambleSeries = isJambleProvider(billingProvider);

      let serie: string;
      switch (tipoDoc) {
        case '01':
          serie = useJambleSeries ? 'F001' : 'F0A1';
          break;
        case '03':
          serie = useJambleSeries ? 'B001' : 'B0A1';
          break;
        case '07':
          if (tipDocAfectado === '01') serie = 'FCA1';
          else if (tipDocAfectado === '03') serie = 'BCA1';
          else
            throw new BadRequestException(
              'Tipo de documento afectado inválido para nota de crédito',
            );
          break;
        case '08':
          if (tipDocAfectado === '01') serie = 'FDA1';
          else if (tipDocAfectado === '03') serie = 'BDA1';
          else
            throw new BadRequestException(
              'Tipo de documento afectado inválido para nota de débito',
            );
          break;
        case 'TICKET':
          serie = 'T001';
          break;
        case 'NV':
          serie = 'NV01';
          break;
        case 'RH':
          serie = 'RH01';
          break;
        case 'CP':
          serie = 'CP01';
          break;
        case 'NP':
          serie = 'NP01';
          break;
        case 'OT':
          serie = 'OT01';
          break;
        case 'COT':
          serie = 'COT1';
          break;
        default:
          throw new BadRequestException('Tipo de documento no reconocido');
      }

      const tipoDocConfig =
        (tipoDoc === '07' || tipoDoc === '08') && tipDocAfectado
          ? `${tipoDoc}:${tipDocAfectado}`
          : tipoDoc;
      const configuredSerie =
        tipoDocConfig !== tipoDoc
          ? (await this.prisma.empresaSerie.findFirst({
              where: { empresaId, tipoDoc: tipoDocConfig, activo: true },
              orderBy: { id: 'asc' },
            })) ||
            (await this.prisma.empresaSerie.findFirst({
              where: { empresaId, tipoDoc, activo: true },
              orderBy: { id: 'asc' },
            }))
          : await this.prisma.empresaSerie.findFirst({
              where: { empresaId, tipoDoc, activo: true },
              orderBy: { id: 'asc' },
            });
      if (configuredSerie?.serie) {
        serie = configuredSerie.serie;
      }

      console.log('[obtenerSerieYCorrelativo] Querying for serie:', serie);

      const ultimo = await this.prisma.comprobante.findFirst({
        where: { empresaId, tipoDoc, serie },
        orderBy: { correlativo: 'desc' },
      });
      let correlativo = ultimo ? Number(ultimo.correlativo) + 1 : 1;

      if (
        !ultimo &&
        configuredSerie?.correlativo &&
        correlativo < configuredSerie.correlativo
      ) {
        correlativo = configuredSerie.correlativo;
      }

      if (useJambleSeries && (serie === 'B001' || serie === 'F001')) {
        const floor = this.getJambleCorrelativoFloor(empresaId, serie);
        if (floor && correlativo < floor) {
          correlativo = floor;
        }
      }

      console.log(
        '[obtenerSerieYCorrelativo] Success - ultimo:',
        ultimo?.id,
        'nuevo correlativo:',
        correlativo,
      );

      return { serie, correlativo };
    } catch (error: any) {
      console.error('[obtenerSerieYCorrelativo] ❌ ERROR:', error.message);
      console.error('[obtenerSerieYCorrelativo] Error code:', error.code);
      console.error(
        '[obtenerSerieYCorrelativo] Full error:',
        JSON.stringify(error, null, 2),
      );
      throw error;
    }
  }

  private async cargarProductosYDetalles(detalles: any[], empresaId: number) {
    // Separar ítems con producto de ítems de servicio libre (sin productoId, ej. costo de envío)
    const productDetalles = detalles.filter((d) => d.productoId != null);
    const serviceDetalles = detalles.filter((d) => d.productoId == null);

    for (const s of serviceDetalles) {
      if (!String(s.descripcion ?? '').trim()) {
        throw new BadRequestException(
          'Los ítems de servicio (sin productoId) requieren una descripción.',
        );
      }
      const cantidad = Number(s.cantidad);
      const precioConIgv = Number(s.nuevoValorUnitario);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new BadRequestException(
          `Cantidad inválida para "${s.descripcion}"`,
        );
      }
      if (!Number.isFinite(precioConIgv) || precioConIgv < 0) {
        throw new BadRequestException(
          `Precio inválido para "${s.descripcion}"`,
        );
      }
    }

    // Normalizar IDs a números (solo ítems con producto)
    const productIds = productDetalles.map((d) => {
      const id = Number(d.productoId);
      if (Number.isNaN(id)) {
        throw new BadRequestException(`productoId inválido: ${d.productoId}`);
      }
      return id;
    });
    const productos = await this.prisma.producto.findMany({
      where: {
        id: { in: productIds },
        empresaId,
      },
      include: { unidadMedida: true },
    });

    if (productos.length !== productDetalles.length) {
      // Identificar cuáles productos no fueron encontrados
      const productosEncontrados = productos.map((p) => p.id);
      const productosFaltantes = productIds.filter(
        (id) => !productosEncontrados.includes(id),
      );

      // Obtener información adicional de los productos faltantes
      const productosInactivos = await this.prisma.producto.findMany({
        where: { id: { in: productosFaltantes } },
        select: { id: true, descripcion: true, estado: true, empresaId: true },
      });
      const productosRealmenteFaltantes = productosInactivos.filter(
        (p) => p.estado !== ('PLACEHOLDER' as any),
      );

      if (
        productosRealmenteFaltantes.length > 0 ||
        productosFaltantes.length > productosInactivos.length
      ) {
        const detalleError =
          productosRealmenteFaltantes.length > 0
            ? `Productos encontrados pero inactivos: ${productosRealmenteFaltantes.map((p) => `ID ${p.id} (${p.descripcion}) - Estado: ${p.estado}`).join('; ')}`
            : `Productos no encontrados: IDs ${productosFaltantes.join(', ')}`;

        throw new BadRequestException(detalleError);
      }
    }
    let mtoOperGravadas = 0;
    let mtoOpExoneradas = 0;
    let mtoOpInafectas = 0;
    let totalIGV = 0;
    const detalleFinal = detalles.map((item: any) => {
      // Ítem de servicio libre (sin productoId): ej. costo de envío al cliente
      if (item.productoId == null) {
        const cantidad = Number(item.cantidad);
        const precioConIgv = Number(item.nuevoValorUnitario);
        const unidadLibre = String(item.unidadVenta || item.unidad || 'ZZ')
          .trim()
          .toUpperCase();
        const igvPct = 18;
        const valorUnitario = this.round2(precioConIgv / 1.18);
        const igvMonto = this.round2(
          precioConIgv * cantidad - valorUnitario * cantidad,
        );
        const mtoValorVenta = this.round2(valorUnitario * cantidad);
        mtoOperGravadas += valorUnitario * cantidad;
        totalIGV += igvMonto;
        return {
          productoId: null,
          unidad: unidadLibre || 'ZZ',
          descripcion: String(item.descripcion).trim(),
          cantidad,
          mtoPrecioUnitario: this.round2(precioConIgv),
          mtoValorUnitario: valorUnitario,
          mtoValorVenta,
          mtoBaseIgv: mtoValorVenta,
          porcentajeIgv: igvPct,
          igv: igvMonto,
          tipAfeIgv: 10,
          totalImpuestos: igvMonto,
        };
      }

      const productoId = Number(item.productoId);
      const prod = productos.find((p) => p.id === productoId)!;
      const cantidad = Number(item.cantidad);
      const numerosSerie = this.normalizarNumerosSerie(
        item.numerosSerie ?? item.series,
      );
      const requiereSerie = this.productoRequiereSerie(prod);
      const descripcion = item.descripcion ?? (prod as any).descripcion;
      const precioConIgv =
        item.nuevoValorUnitario != null
          ? Number(item.nuevoValorUnitario)
          : Number((prod as any).precioUnitario);
      const tipAfeIgv = parseInt((prod as any).tipoAfectacionIGV ?? '10', 10);

      let valorUnitario: number;
      let igvMonto: number;
      let igvPct: number;

      if (tipAfeIgv === 10) {
        // Gravado — extraer IGV incluido en precioUnitario
        // Fallback a 18% si igvPorcentaje es 0/null (evita TaxAmount=0 en SUNAT código 3111)
        igvPct = Number((prod as any).igvPorcentaje) || 18;
        valorUnitario = precioConIgv / (1 + igvPct / 100);
        igvMonto = precioConIgv * cantidad - valorUnitario * cantidad;
        mtoOperGravadas += valorUnitario * cantidad;
        totalIGV += igvMonto;
      } else if (tipAfeIgv === 20) {
        // Exonerado — sin IGV
        igvPct = 0;
        valorUnitario = precioConIgv;
        igvMonto = 0;
        mtoOpExoneradas += precioConIgv * cantidad;
      } else if (tipAfeIgv === 30) {
        // Inafecto — sin IGV
        igvPct = 0;
        valorUnitario = precioConIgv;
        igvMonto = 0;
        mtoOpInafectas += precioConIgv * cantidad;
      } else {
        // Fallback: tratar como gravado
        igvPct = Number((prod as any).igvPorcentaje) || 18;
        valorUnitario = precioConIgv / (1 + igvPct / 100);
        igvMonto = precioConIgv * cantidad - valorUnitario * cantidad;
        mtoOperGravadas += valorUnitario * cantidad;
        totalIGV += igvMonto;
      }

      const mtoValorVenta = valorUnitario * cantidad;
      return {
        productoId: (prod as any).id,
        // Fraccionamiento: usar unidadVenta del ítem si viene (ej. TABLETA vs CAJA)
        unidad: item.unidadVenta || (prod as any).unidadMedida.codigo,
        descripcion,
        cantidad,
        mtoPrecioUnitario: this.round2(precioConIgv),
        mtoValorUnitario: this.round2(valorUnitario),
        mtoValorVenta: this.round2(mtoValorVenta),
        mtoBaseIgv: this.round2(mtoValorVenta),
        porcentajeIgv: igvPct,
        igv: this.round2(igvMonto),
        tipAfeIgv,
        totalImpuestos: this.round2(igvMonto),
        // Farmacia: propagar campos de trazabilidad y receta
        ...(item.loteId != null && { loteId: Number(item.loteId) }),
        ...(item.numeroReceta && { numeroReceta: item.numeroReceta }),
        ...(item.dniPaciente && { dniPaciente: item.dniPaciente }),
        ...(item.nombrePaciente && { nombrePaciente: item.nombrePaciente }),
        ...(item.medicoNombre && { medicoNombre: item.medicoNombre }),
        ...(numerosSerie.length > 0 ? { numerosSerie } : {}),
        ...(requiereSerie ? { requiereSerie: true } : {}),
      };
    });
    return {
      productos,
      detalleFinal,
      mtoOperGravadas: this.round2(mtoOperGravadas),
      mtoOpExoneradas: this.round2(mtoOpExoneradas),
      mtoOpInafectas: this.round2(mtoOpInafectas),
      totalIGV: this.round2(totalIGV),
    };
  }

  /**
   * Valida receta médica y datos de controlados para rubros farmacia/botica/droguería.
   * Rechaza la emisión en backend (el frontend solo hace UX).
   */
  private async validarRecetasSiFarmacia(
    detalles: any[],
    empresaId: number,
  ): Promise<void> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { rubro: { select: { nombre: true } } },
    });
    const rubroNombre = empresa?.rubro?.nombre?.toLowerCase() ?? '';
    const habilitaRecetaMedica =
      rubroNombre.includes('farmacia') ||
      rubroNombre.includes('botica') ||
      rubroNombre.includes('medicament') ||
      rubroNombre.includes('drogueria') ||
      rubroNombre.includes('droguería');

    if (!habilitaRecetaMedica) return;

    const productIds = detalles
      .map((d) => Number(d.productoId))
      .filter((id) => !Number.isNaN(id));

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: productIds }, empresaId },
      select: {
        id: true,
        descripcion: true,
        requiereReceta: true,
        controlado: true,
      },
    });
    const productoMap = new Map(productos.map((p) => [p.id, p]));

    for (const detalle of detalles) {
      const prod = productoMap.get(Number(detalle.productoId));
      if (!prod) continue;

      if (prod.requiereReceta && !detalle.numeroReceta) {
        throw new BadRequestException(
          `El producto "${prod.descripcion}" requiere número de receta médica.`,
        );
      }
      if (prod.controlado) {
        if (!detalle.dniPaciente) {
          throw new BadRequestException(
            `El producto controlado "${prod.descripcion}" requiere DNI del paciente.`,
          );
        }
        if (!detalle.medicoNombre) {
          throw new BadRequestException(
            `El producto controlado "${prod.descripcion}" requiere nombre del médico.`,
          );
        }
      }
    }
  }

  private async resolverSedeParaStock(data: {
    empresaId: number;
    usuarioId?: number;
    sedeId?: number;
  }): Promise<number> {
    let sedeId = data.sedeId;

    if (!sedeId && data.usuarioId) {
      const usuario = await this.prisma.usuario.findUnique({
        where: { id: data.usuarioId },
        select: { sedeId: true },
      });
      if (usuario?.sedeId) sedeId = usuario.sedeId;
    }

    if (!sedeId) {
      const principal = await this.prisma.sede.findFirst({
        where: { empresaId: data.empresaId, esPrincipal: true },
        select: { id: true },
      });
      if (principal) sedeId = principal.id;
    }

    if (!sedeId) {
      throw new BadRequestException(
        'No se pudo determinar la sede para descontar stock',
      );
    }

    return sedeId;
  }

  private async validarStockDisponibleParaVenta(
    detalles: Array<{
      productoId: number | null;
      cantidad: number;
      loteId?: number | null;
    }>,
    data: {
      empresaId: number;
      usuarioId?: number;
      sedeId?: number;
    },
  ): Promise<number> {
    const sedeId = await this.resolverSedeParaStock(data);

    for (const item of detalles) {
      // Ítems de servicio libre (sin productoId) no tienen stock que validar
      if (item.productoId == null) continue;
      const productoId = Number(item.productoId);
      const cantidad = Number(item.cantidad);

      if (!Number.isFinite(productoId) || productoId <= 0) {
        throw new BadRequestException(
          `productoId inválido para descontar stock: ${item.productoId}`,
        );
      }
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new BadRequestException(
          `Cantidad inválida para descontar stock: ${item.cantidad}`,
        );
      }

      const producto = await this.prisma.producto.findFirst({
        where: { id: productoId, empresaId: data.empresaId },
        select: {
          id: true,
          descripcion: true,
          stock: true,
          atributosTecnicos: true,
          porcentajeVenta: true,
          porcentajeProvision: true,
          factorConversion: true,
        },
      });

      if (!producto) {
        throw new BadRequestException(
          'El producto no existe o no pertenece a la empresa',
        );
      }
      if (this.esProductoServicio(producto.atributosTecnicos as any)) continue;

      // Fraccionamiento: el lote guarda stock en unidad base (ej. tabletas).
      // Si se vende por CAJA (sin unidadVenta), descontar cantidad × factor.
      const factorConv = Number((producto as any).factorConversion ?? 1);
      const cantidadLote =
        factorConv > 1 && !(item as any).unidadVenta
          ? cantidad * factorConv
          : cantidad;

      if (item.loteId != null) {
        const lote = await this.prisma.productoLote.findFirst({
          where: {
            id: Number(item.loteId),
            productoId,
            producto: { empresaId: data.empresaId },
          },
          select: {
            lote: true,
            activo: true,
            stockActual: true,
            fechaVencimiento: true,
          },
        });

        if (!lote) {
          throw new BadRequestException(
            `El lote seleccionado para "${producto.descripcion}" no existe o no pertenece al producto`,
          );
        }
        if (!lote.activo) {
          throw new BadRequestException(
            `El lote ${lote.lote} de "${producto.descripcion}" está inactivo`,
          );
        }
        if (lote.fechaVencimiento && lote.fechaVencimiento < new Date()) {
          throw new BadRequestException(
            `El lote ${lote.lote} de "${producto.descripcion}" está vencido`,
          );
        }
        if (num(lote.stockActual) < cantidadLote) {
          throw new BadRequestException(
            `Stock insuficiente en lote ${lote.lote} para "${producto.descripcion}". Disponible: ${num(lote.stockActual)}, solicitado: ${cantidadLote}.`,
          );
        }
        continue;
      }

      const stockSede = await this.prisma.productoStock.findUnique({
        where: { productoId_sedeId: { productoId, sedeId } },
        select: { stock: true },
      });

      const stockBase = num(stockSede?.stock ?? producto.stock);
      const reservasActivas = await this.prisma.reserva.aggregate({
        _sum: { cantidad: true },
        where: {
          empresaId: data.empresaId,
          sedeId,
          productoId,
          estado: { in: [EstadoReserva.PENDIENTE, EstadoReserva.CONFIRMADA] },
        },
      });
      const reservado = num(reservasActivas._sum.cantidad);
      const cupoProvision = Math.floor(
        (stockBase * (producto.porcentajeProvision ?? 0)) / 100,
      );
      const cupoVenta = Math.max(0, stockBase - cupoProvision);
      const disponibleVenta = Math.max(
        0,
        Math.min(stockBase - reservado, cupoVenta),
      );

      if (disponibleVenta < cantidad) {
        throw new BadRequestException(
          `Stock no disponible para venta en "${producto.descripcion}". Disponible para venta: ${disponibleVenta}, solicitado: ${cantidad}.`,
        );
      }
    }

    return sedeId;
  }

  private async ajustarStock(
    detalles: any[],
    data?: {
      empresaId: number;
      comprobanteId: number;
      concepto: string;

      usuarioId?: number;
      sedeId?: number;
    },
  ) {
    if (!data) {
      throw new BadRequestException(
        'No se recibieron datos para descontar stock',
      );
    }

    const sedeId = await this.validarStockDisponibleParaVenta(detalles, data);

    for (const item of detalles) {
      const productoId = Number(item.productoId);
      const cantidad = Number(item.cantidad);

      const producto = await this.prisma.producto.findFirst({
        where: { id: productoId, empresaId: data.empresaId },
        select: {
          stock: true,
          costoPromedio: true,
          atributosTecnicos: true,
          factorConversion: true,
        },
      });
      if (!producto) continue;
      if (this.esProductoServicio(producto.atributosTecnicos as any)) continue;

      const factorConvVenta = Number((producto as any).factorConversion ?? 1);
      const cantidadLote =
        factorConvVenta > 1 && !item.unidadVenta
          ? cantidad * factorConvVenta
          : cantidad;
      if (data && this.kardexService) {
        const costoUnitario = Number(producto.costoPromedio) || 0;

        const movimiento = await this.kardexService.registrarMovimiento({
          productoId,
          empresaId: data.empresaId,
          tipoMovimiento: 'SALIDA',
          concepto: data.concepto,
          cantidad,
          comprobanteId: data.comprobanteId,
          costoUnitario: costoUnitario,
          usuarioId: data.usuarioId,
          sedeId,
        });

        // Descuento de lote: atómico cuando viene loteId (farmacia), FEFO cuando no
        if (this.loteService) {
          if (item.loteId) {
            // Lote específico: descuento dentro de transacción propia para evitar sobreventa
            await this.prisma.$transaction(async (tx) => {
              await this.loteService.descontarStockLoteEnTx(tx, {
                loteId: Number(item.loteId),
                cantidad: cantidadLote,
                movimientoKardexId: movimiento.id,
              });
            });
          } else {
            await this.loteService.descontarStockLote(
              productoId,
              cantidadLote,
              movimiento.id,
            );
          }
        }

        // Notificación no bloqueante: si falla, no tumbamos la emisión
        try {
          await this.inventarioNotificaciones.verificarProductoDespuesVenta(
            productoId,
            data.empresaId,
            sedeId,
          );
        } catch (error) {
          console.error(
            'Error al notificar inventario después de venta:',
            error,
          );
        }
      }
    }
  }

  private async revertirStock(
    detalles: any[],
    data?: {
      empresaId: number;
      comprobanteId: number;
      concepto: string;

      usuarioId?: number;
    },
  ) {
    // Resolver Sede ID (similar a ajustarStock)
    // Nota: Idealmente deberíamos revertir en la MISMA sede donde se hizo la salida.
    // Para eso, deberíamos consultar el movimiento original.

    // 1. Obtener movimientos originales de kardex asociados a este comprobante
    const movimientosOriginales = await this.prisma.movimientoKardex.findMany({
      where: {
        comprobanteId: data?.comprobanteId,
        empresaId: data?.empresaId,
        tipoMovimiento: 'SALIDA',
      },
      include: {
        // Relación con lotes (falta definirla en schema si no existe, pero asumimos que existe o la consultamos aparte)
        // Si la relación en prisma schema no se llama 'movimientosLote', hay que consultarla manualmente.
        // Asumiremos consulta manual para seguridad si no conozco el schema exacto.
      },
    });

    for (const item of detalles) {
      if (item.productoId) {
        const producto = await this.prisma.producto.findUnique({
          where: { id: item.productoId },
          select: { stock: true, costoPromedio: true },
        });

        if (producto) {
          // Registrar movimiento de kardex GLOBAL (siempre se hace para subir el stock del producto)
          if (data && this.kardexService) {
            try {
              const costoUnitario = Number(producto.costoPromedio) || 0;

              const movimientoIngreso =
                await this.kardexService.registrarMovimiento({
                  productoId: item.productoId,
                  empresaId: data.empresaId,
                  tipoMovimiento: 'INGRESO',
                  concepto: data.concepto,
                  cantidad: item.cantidad,
                  comprobanteId: data.comprobanteId,
                  costoUnitario: costoUnitario,
                  usuarioId: data.usuarioId,
                  sedeId:
                    movimientosOriginales.find(
                      (m) => m.productoId === item.productoId,
                    )?.sedeId ||
                    (
                      await this.prisma.sede.findFirst({
                        where: {
                          empresaId: data?.empresaId,
                          esPrincipal: true,
                        },
                        select: { id: true },
                      })
                    )?.id ||
                    1,
                });

              // --- REVERSIÓN DETALLADA DE LOTES ---
              if (this.loteService) {
                // Buscar si hubo salida de lotes para este producto en este comprobante
                const movOriginal = movimientosOriginales.find(
                  (m) => m.productoId === item.productoId,
                );

                if (movOriginal) {
                  // Buscar detalles de lote para ese movimiento
                  // Nombre de tabla en prisma suele ser camelCase. movimientoKardexLote ??
                  // Usaré consulta directa a la tabla intermedia
                  const movimientosLote =
                    await this.prisma.movimientoKardexLote.findMany({
                      where: { movimientoId: movOriginal.id },
                    });

                  if (movimientosLote.length > 0) {
                    // Hay lotes involucrados. Devolver el stock a cada uno.
                    for (const ml of movimientosLote) {
                      await this.loteService.aumentarStockLote(
                        ml.productoLoteId,
                        num(ml.cantidad), // Devolver la cantidad exacta que salió de este lote
                        movimientoIngreso.id, // Ligar al nuevo movimiento de anulación
                      );
                    }
                  }
                }
              }
            } catch (error) {
              console.error(
                'Error al registrar movimiento de kardex (reversión):',
                error,
              );
            }
          }
        }
      }
    }
  }

  private normalizarCuotasCredito(
    montoCredito: number,
    cuotas?: any[],
    fechaVencimientoCredito?: string | Date,
  ): Array<{ monto: number; fechaVencimiento: string }> {
    const totalCredito = this.round2(Number(montoCredito || 0));
    if (totalCredito <= 0) return [];

    const cuotasValidas = Array.isArray(cuotas) ? cuotas : [];
    const normalizadas = cuotasValidas
      .map((cuota) => ({
        monto: this.round2(Number(cuota?.monto ?? 0)),
        fechaVencimiento: String(cuota?.fechaVencimiento ?? '').slice(0, 10),
      }))
      .filter((cuota) => cuota.monto > 0 || cuota.fechaVencimiento);

    if (normalizadas.length === 0) {
      if (!fechaVencimientoCredito) {
        throw new BadRequestException(
          'La venta al crédito requiere fecha de vencimiento o cronograma de cuotas',
        );
      }
      const fecha = new Date(fechaVencimientoCredito);
      if (Number.isNaN(fecha.getTime())) {
        throw new BadRequestException(
          'Fecha de vencimiento de crédito inválida',
        );
      }
      return [
        {
          monto: totalCredito,
          fechaVencimiento: fecha.toISOString().slice(0, 10),
        },
      ];
    }

    for (const cuota of normalizadas) {
      if (cuota.monto <= 0) {
        throw new BadRequestException(
          'Todas las cuotas deben tener monto mayor a cero',
        );
      }
      const fecha = new Date(cuota.fechaVencimiento);
      if (!cuota.fechaVencimiento || Number.isNaN(fecha.getTime())) {
        throw new BadRequestException(
          'Todas las cuotas deben tener fecha de vencimiento válida',
        );
      }
      cuota.fechaVencimiento = fecha.toISOString().slice(0, 10);
    }

    const sumaCuotas = this.round2(
      normalizadas.reduce((sum, cuota) => sum + cuota.monto, 0),
    );
    if (Math.abs(sumaCuotas - totalCredito) > 0.01) {
      throw new BadRequestException(
        `La suma de cuotas (S/ ${sumaCuotas.toFixed(2)}) debe ser igual al saldo a crédito (S/ ${totalCredito.toFixed(2)})`,
      );
    }

    return normalizadas;
  }

  async crearFormal(
    input: any,
    empresaId: number,
    formalTipo: '01' | '03' | '07' | '08',
    usuarioId?: number,
    sedeId?: number,
  ) {
    const {
      fechaEmision,
      formaPagoTipo,
      formaPagoMoneda,
      tipoMoneda,
      medioPago,
      clienteId,
      leyenda,
      detalles,
      observaciones,
      clienteName,
      tipDocAfectado,
      numDocAfectado,
      tipoOperacionId,
      motivoId,
      montoDescuentoGlobal,
      vuelto,
      tipoDetraccionId,
      medioPagoDetraccionId,
      cuentaBancoNacion,
      porcentajeDetraccion,
      montoDetraccion,
      cuotas,
      retencionMonto,
      retencionPorcentaje,
      comprobanteOrigenId,
      paymentDetails,
      fechaVencimientoCredito,
    } = input;

    // Cuando se convierte desde un informal (NV, TICKET, etc.) el stock ya fue descontado
    // al crear el informal — NO volver a descontarlo.
    const esConversionDesdeInformal = comprobanteOrigenId != null;

    // Validar que el comprobante origen pertenezca a esta empresa (seguridad)
    if (esConversionDesdeInformal) {
      const origen = await this.prisma.comprobante.findFirst({
        where: { id: Number(comprobanteOrigenId), empresaId },
        select: { id: true, tipoDoc: true },
      });
      if (!origen) {
        throw new BadRequestException(
          'El comprobante de origen no existe o no pertenece a esta empresa',
        );
      }
      const tiposInformales = ['NV', 'TICKET', 'NP', 'OT', 'RH', 'CP'];
      if (!tiposInformales.includes(origen.tipoDoc)) {
        throw new BadRequestException(
          'El comprobante de origen no es de tipo informal',
        );
      }
    }

    // Map retencion fields to detraccion fields if present
    const finalMontoDetraccion = retencionMonto || montoDetraccion;
    const finalPorcentajeDetraccion =
      retencionPorcentaje || porcentajeDetraccion;

    // ============= VALIDACIÓN DE LÍMITE DE COMPROBANTES =============
    // Solo validar para Facturas (01) y Boletas (03), no para notas
    if (formalTipo === '01' || formalTipo === '03') {
      const usageStats = await this.getUsageStats(empresaId);
      if (!usageStats.puedeEmitir) {
        throw new BadRequestException(
          `Has alcanzado el límite de ${usageStats.limiteMaximo} comprobantes mensuales de tu plan "${usageStats.plan}". ` +
            `Para continuar emitiendo comprobantes, contacta a soporte para actualizar tu plan.`,
        );
      }
    }
    // ================================================================

    // Si es nota de crédito, usar lógica especializada
    if (formalTipo === '07') {
      return this.crearNotaCredito(input, empresaId, usuarioId, sedeId);
    }

    // Lógica original para facturas, boletas y notas de débito
    let finalClienteId: number | null = clienteId ?? null;
    if (clienteName === 'CLIENTES VARIOS') {
      const clienteVarios = await this.prisma.cliente.findFirst({
        where: {
          nombre: 'CLIENTES VARIOS',
          empresaId,
          estado: 'ACTIVO' as any,
        },
        select: { id: true },
      });
      if (!clienteVarios) {
        throw new BadRequestException(
          "No existe el cliente 'CLIENTES VARIOS' ACTIVO para esta empresa",
        );
      }
      finalClienteId = clienteVarios.id;
    } else if (!finalClienteId) {
      throw new BadRequestException('clienteId es requerido');
    }

    const {
      detalleFinal,
      mtoOperGravadas,
      mtoOpExoneradas,
      mtoOpInafectas,
      totalIGV,
    } = await this.cargarProductosYDetalles(detalles, empresaId);
    await this.validarSeriesComprobante(
      detalleFinal,
      empresaId,
      !esConversionDesdeInformal,
    );

    // Validar cliente si viene explícito
    if (clienteName !== 'CLIENTES VARIOS' && finalClienteId) {
      const cli = await this.prisma.cliente.findFirst({
        where: { id: finalClienteId, empresaId, estado: 'ACTIVO' as any },
        select: { id: true },
      });
      if (!cli)
        throw new BadRequestException(
          'El cliente no existe o no pertenece a la empresa',
        );
    }

    // Validar tipoOperacion si se envía
    let tipoOperacionIdFinal: number | null = null;
    if (tipoOperacionId != null) {
      const to = await this.prisma.tipoOperacion.findUnique({
        where: { id: tipoOperacionId },
      });
      if (!to) {
        tipoOperacionIdFinal = null;
      } else {
        tipoOperacionIdFinal = tipoOperacionId;
      }
    }

    const valorVenta = this.round2(
      mtoOperGravadas + mtoOpExoneradas + mtoOpInafectas,
    );
    const subTotal = this.round2(valorVenta + totalIGV);
    const mtoImpVenta = subTotal;

    const fecha = new Date(fechaEmision);

    // Determinar estado y saldo para comprobantes formales
    // IMPORTANTE: formaPagoTipo es la fuente autoritativa
    // Si formaPagoTipo es CREDITO, es crédito aunque medioPago sea Efectivo
    const formaPagoTipoUpper = formaPagoTipo?.toUpperCase() || '';
    const esPagoCredito = formaPagoTipoUpper === 'CREDITO';
    const esPagoContado = !esPagoCredito; // Si no es crédito, es contado

    // Calcular descuento por detracción/retención
    const montoDescontado = finalMontoDetraccion
      ? Number(finalMontoDetraccion)
      : 0;

    let estadoPagoInicial: string;
    let saldoInicial: number;

    if (esPagoContado) {
      estadoPagoInicial = 'COMPLETADO';
      saldoInicial = 0;
    } else {
      // Crédito: saldo = total - detracción/retención
      estadoPagoInicial = 'PENDIENTE_PAGO';
      saldoInicial = Math.max(0, this.round2(mtoImpVenta - montoDescontado));
    }

    if (esPagoContado) {
      await this.validarDetallePago(
        paymentDetails,
        medioPago,
        mtoImpVenta,
        empresaId,
      );
    }

    const cuotasCredito = esPagoCredito
      ? this.normalizarCuotasCredito(
          saldoInicial,
          cuotas,
          fechaVencimientoCredito,
        )
      : null;

    const dataBase: any = {
      tipoOperacionId: tipoOperacionIdFinal ?? undefined,
      tipoDetraccionId: tipoDetraccionId ?? undefined,
      medioPagoDetraccionId: medioPagoDetraccionId ?? undefined,
      cuentaBancoNacion: cuentaBancoNacion ?? null,
      porcentajeDetraccion: finalPorcentajeDetraccion
        ? Number(finalPorcentajeDetraccion)
        : null,
      montoDetraccion: finalMontoDetraccion
        ? Number(finalMontoDetraccion)
        : null,
      cuotas: cuotasCredito ?? Prisma.JsonNull,
      tipoDoc: formalTipo,
      fechaEmision: fecha,
      formaPagoTipo,
      formaPagoMoneda,
      tipoMoneda,
      observaciones: observaciones ?? null,
      clienteId: finalClienteId,
      empresaId,
      sedeId,
      usuarioId: usuarioId ?? undefined,
      mtoOperGravadas,
      mtoOperInafectas: mtoOpInafectas,
      mtoOperExoneradas: mtoOpExoneradas,
      medioPago,
      paymentDetails: paymentDetails ?? Prisma.JsonNull,
      mtoIGV: totalIGV,
      valorVenta,
      totalImpuestos: totalIGV,
      subTotal,
      mtoImpVenta,
      vuelto: vuelto != null ? Number(vuelto) : 0,
      estadoEnvioSunat: 'PENDIENTE' as string,
      estadoPago: estadoPagoInicial,
      saldo: saldoInicial,
      fechaVencimientoCredito:
        esPagoCredito && fechaVencimientoCredito
          ? new Date(fechaVencimientoCredito)
          : undefined,
      ...(formalTipo === '08'
        ? {
            tipDocAfectado: tipDocAfectado ?? null,
            numDocAfectado: numDocAfectado ?? null,
            motivoId: motivoId ?? null,
          }
        : {}),
      detalles: { create: this.limpiarDetalleParaPersistencia(detalleFinal) },
      leyendas: { create: [{ code: '1000', value: leyenda }] },
      // Vínculo con el documento informal de origen (NV, TICKET, NP, etc.)
      ...(esConversionDesdeInformal && comprobanteOrigenId != null
        ? { comprobanteOrigenId: Number(comprobanteOrigenId) }
        : {}),
    };

    // Validar receta médica en backend (guardia real, no solo UX)
    await this.validarRecetasSiFarmacia(detalles, empresaId);

    if (!esConversionDesdeInformal) {
      await this.validarStockDisponibleParaVenta(detalleFinal, {
        empresaId,
        sedeId,
        usuarioId,
      });
    }

    const comprobante = await this.crearComprobanteConReintento(
      dataBase,
      formalTipo,
      tipDocAfectado ?? null,
      empresaId,
    );

    if (esPagoContado) {
      await this.registrarPagosDeEmision({
        comprobanteId: comprobante.id,
        empresaId,
        usuarioId,
        medioPago,
        paymentDetails,
        montoPagado: mtoImpVenta,
        documento: `${comprobante.serie}-${comprobante.correlativo}`,
        fecha,
      });
    }

    // Registrar movimientos de kardex SOLO si NO es conversión desde informal.
    // Cuando viene de NV/TICKET el stock ya fue descontado al crear el informal.
    if (!esConversionDesdeInformal) {
      await this.ajustarStock(detalleFinal, {
        empresaId,
        comprobanteId: comprobante.id,
        concepto: `Venta ${formalTipo === '01' ? 'Factura' : formalTipo === '03' ? 'Boleta' : 'Nota de Débito'} ${comprobante.serie}-${comprobante.correlativo}`,
        sedeId,
        usuarioId,
      });
      await this.registrarSeriesVendidas(comprobante.id, empresaId, sedeId);
    }

    // Registrar comisiones del vendedor (no bloqueante)
    if (usuarioId && this.comisionesService) {
      try {
        await this.comisionesService.registrarComisionesDesdeComprobante({
          comprobanteId: comprobante.id,
          empresaId,
          vendedorId: usuarioId,
          fechaEmision: new Date(fechaEmision),
          detalles: detalleFinal.map((d: any) => ({
            productoId: d.productoId ?? null,
            descripcion: d.descripcion,
            cantidad: d.cantidad,
            mtoPrecioUnitario: d.mtoPrecioUnitario,
          })),
        });
      } catch (err) {
        console.warn(
          '[crearFormal] Error al registrar comisiones:',
          err?.message,
        );
      }
    }

    return comprobante;
  }

  async registrarErrorSunat(id: number, errorMessage: string) {
    return this.prisma.comprobante.update({
      where: { id },
      data: {
        estadoEnvioSunat: 'FALLIDO_ENVIO',
        sunatErrorMsg: errorMessage,
      },
    });
  }

  /**
   * Elimina un comprobante que no pudo armarse correctamente antes de enviarse a SUNAT.
   * Solo debe llamarse cuando el error es de datos (SunatPayloadException), nunca
   * por errores de red, ya que esos sí deben reintentarse.
   */
  async eliminarComprobante(id: number) {
    // Borrar hijos sin cascade antes de eliminar el padre
    await this.prisma.detalleComprobante.deleteMany({
      where: { comprobanteId: id },
    });
    await this.prisma.leyenda.deleteMany({ where: { comprobanteId: id } });
    await this.prisma.movimientoKardex.updateMany({
      where: { comprobanteId: id },
      data: { comprobanteId: null },
    });
    await this.prisma.comprobante.delete({ where: { id } });
  }

  /**
   * Guarda una notificación de error fatal SUNAT antes de que el comprobante sea eliminado.
   * Así el usuario tiene trazabilidad de qué pasó sin necesidad de ver el comprobante eliminado.
   */
  async guardarLogErrorFatal(params: {
    empresaId: number;
    usuarioId?: number | null;
    serie: string;
    correlativo: number;
    tipoDoc: string;
    errorMsg: string;
  }): Promise<void> {
    try {
      let uid = params.usuarioId;
      if (!uid) {
        const adminUser = await this.prisma.usuario.findFirst({
          where: { empresaId: params.empresaId, rol: 'ADMIN_EMPRESA' },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        uid = adminUser?.id ?? null;
      }
      if (!uid) return; // sin usuario no se puede crear la notificación

      const correlativoStr = String(params.correlativo).padStart(8, '0');
      const tipoLabel: Record<string, string> = {
        '01': 'Factura',
        '03': 'Boleta',
        '07': 'Nota de Crédito',
        '08': 'Nota de Débito',
      };
      const tipo = tipoLabel[params.tipoDoc] ?? 'Comprobante';

      await this.prisma.notificacion.create({
        data: {
          usuarioId: uid,
          empresaId: params.empresaId,
          tipo: 'ERROR_SUNAT_FATAL',
          titulo: `${tipo} ${params.serie}-${correlativoStr} eliminado por error SUNAT`,
          mensaje: params.errorMsg,
          leida: false,
        },
      });
    } catch (logErr: any) {
      console.warn(
        '[guardarLogErrorFatal] No se pudo guardar el log:',
        logErr?.message,
      );
    }
  }

  /**
   * Elimina manualmente un comprobante atascado (PENDIENTE, FALLIDO_ENVIO o RECHAZADO).
   * Revierte el stock de los productos y borra el registro permanentemente.
   * No se permite sobre comprobantes ya EMITIDO o ANULADO.
   */
  async descartarComprobante(id: number, empresaId: number) {
    const comp = await this.prisma.comprobante.findFirst({
      where: { id, empresaId },
      include: { detalles: true },
    });

    if (!comp) throw new NotFoundException('Comprobante no encontrado');

    // Los comprobantes informales (NV, TICKET, RH, CP, NP, OT) pueden eliminarse
    // siempre — incluso ANULADO — porque no son documentos SUNAT y su borrado
    // libera el correlativo. Los formales EMITIDO/ANULADO NO pueden borrarse.
    const isInformal = ['TICKET', 'NV', 'RH', 'CP', 'NP', 'OT'].includes(
      comp.tipoDoc,
    );
    const yaAnulado = comp.estadoEnvioSunat === 'ANULADO';
    if (
      !isInformal &&
      ['EMITIDO', 'ANULADO'].includes(comp.estadoEnvioSunat as string)
    ) {
      throw new BadRequestException(
        `No se puede eliminar un comprobante con estado ${comp.estadoEnvioSunat}`,
      );
    }

    // 1) Revertir stock primero (antes de borrar los detalles).
    //    Si el comprobante ya estaba ANULADO, el stock ya se revirtió al anular
    //    — no revertir de nuevo para no duplicar el inventario.
    if (comp.detalles?.length && !yaAnulado) {
      try {
        await this.revertirStock(comp.detalles, {
          empresaId: comp.empresaId,
          comprobanteId: comp.id,
          concepto: 'Eliminación de comprobante pendiente/fallido',
        });
      } catch (stockErr: any) {
        // No bloquear el borrado si el stock falla — registrar y continuar
        console.warn(
          `[descartarComprobante] No se pudo revertir stock para ${id}: ${stockErr.message}`,
        );
      }
    }

    // 2) Borrar en orden respetando FKs (hijos antes que padres).
    //    Usa transacción interactiva para poder capturar el paso exacto que falla.
    await this.prisma.$transaction(async (tx) => {
      // 2a. Hijos de movimientoKardex (pueden no tener CASCADE activo en la BD)
      const movimientos = await tx.movimientoKardex.findMany({
        where: { comprobanteId: id },
        select: { id: true },
      });
      if (movimientos.length) {
        const movIds = movimientos.map((m) => m.id);
        await tx.movimientoKardexLote.deleteMany({
          where: { movimientoId: { in: movIds } },
        });
        await tx.movimientoKardex.deleteMany({ where: { id: { in: movIds } } });
      }

      // 2b. Resto de hijos directos del comprobante
      await tx.detalleComprobante.deleteMany({ where: { comprobanteId: id } });
      await tx.leyenda.deleteMany({ where: { comprobanteId: id } });

      // 2c. Eliminar el comprobante (Pago/WhatsAppEnvio/EnvioDespacho tienen CASCADE en DB)
      await tx.comprobante.delete({ where: { id } });
    });

    return {
      message: 'Comprobante eliminado y stock revertido',
      eliminado: true,
    };
  }

  async crearNotaCredito(
    input: any,
    empresaId: number,
    usuarioId?: number,
    sedeId?: number,
  ) {
    const {
      fechaEmision,
      formaPagoTipo,
      formaPagoMoneda,
      tipoMoneda,
      medioPago,
      clienteId,
      leyenda,
      detalles,
      observaciones,
      clienteName,
      tipDocAfectado,
      numDocAfectado,
      tipoOperacionId,
      motivoId,
      montoDescuentoGlobal,
    } = input;

    // 1) Validaciones iniciales
    if (!motivoId) {
      throw new BadRequestException(
        'Debe proporcionar motivo de Nota de Crédito',
      );
    }

    // 2) Cargar motivo y validar tipo
    const motivoNota = await this.prisma.motivoNota.findUnique({
      where: { id: motivoId },
    });
    if (!motivoNota) {
      throw new BadRequestException('Motivo no encontrado');
    }
    if (motivoNota.tipo !== 'CREDITO') {
      throw new BadRequestException(
        'El motivo no corresponde a Nota de Crédito',
      );
    }

    // 3) Resolver cliente
    let finalClienteId: number | null = clienteId ?? null;
    if (clienteName === 'CLIENTES VARIOS') {
      const clienteVarios = await this.prisma.cliente.findFirst({
        where: {
          nombre: 'CLIENTES VARIOS',
          empresaId,
          estado: 'ACTIVO' as any,
        },
        select: { id: true },
      });
      if (!clienteVarios) {
        throw new BadRequestException(
          "No existe el cliente 'CLIENTES VARIOS' ACTIVO para esta empresa",
        );
      }
      finalClienteId = clienteVarios.id;
    } else if (!finalClienteId) {
      throw new BadRequestException('clienteId es requerido');
    }

    // 4) Cargar comprobante afectado (factura o boleta)
    if (!tipDocAfectado || !numDocAfectado) {
      throw new BadRequestException('Debe indicar documento afectado');
    }

    const [serieAF, corrAF] = numDocAfectado.split('-');

    // Autocorrección: Detectar tipo real basado en la serie
    let tipoDocReal = tipDocAfectado;
    if (serieAF.startsWith('B')) {
      tipoDocReal = '03'; // Es Boleta
    } else if (serieAF.startsWith('F')) {
      tipoDocReal = '01'; // Es Factura
    }

    const afectado = await this.prisma.comprobante.findFirst({
      where: {
        empresaId,
        tipoDoc: tipoDocReal,
        serie: serieAF,
        correlativo: Number(corrAF),
      },
      include: { detalles: true },
    });

    // Variable final para guardar en BD
    const tipDocAfectadoFinal = afectado ? tipoDocReal : tipDocAfectado;

    if (!afectado) {
      throw new BadRequestException('Documento afectado no encontrado');
    }

    // 5) Variables de totales originales
    let mtoOperGravadas = afectado.mtoOperGravadas;
    let totalIGV = afectado.mtoIGV;

    // 6) Array definitivo de líneas
    const detalleFinal: any[] = [];

    // --- Motivo 01 y 06 = Anulación total o Devolución total
    if (['01', '06'].includes(motivoNota.codigo)) {
      for (const orig of afectado.detalles) {
        detalleFinal.push({
          productoId: orig.productoId,
          unidad: orig.unidad,
          descripcion: orig.descripcion,
          cantidad: orig.cantidad,
          mtoValorUnitario: this.round2(orig.mtoValorUnitario),
          mtoValorVenta: this.round2(orig.mtoValorVenta),
          mtoBaseIgv: this.round2(orig.mtoBaseIgv),
          porcentajeIgv: this.round2(orig.porcentajeIgv),
          igv: this.round2(orig.igv),
          tipAfeIgv: orig.tipAfeIgv,
          totalImpuestos: this.round2(orig.totalImpuestos),
          mtoPrecioUnitario: orig.mtoPrecioUnitario,
        });
      }
    }

    // --- Motivo 02 = Corrección por error en el RUC
    if (motivoNota.codigo === '02') {
      for (const orig of afectado.detalles) {
        detalleFinal.push({
          productoId: orig.productoId,
          unidad: orig.unidad,
          descripcion: orig.descripcion,
          cantidad: orig.cantidad,
          mtoValorUnitario: this.round2(orig.mtoValorUnitario),
          mtoValorVenta: this.round2(orig.mtoValorVenta),
          mtoBaseIgv: this.round2(orig.mtoBaseIgv),
          porcentajeIgv: this.round2(orig.porcentajeIgv),
          igv: this.round2(orig.igv),
          tipAfeIgv: orig.tipAfeIgv,
          totalImpuestos: this.round2(orig.totalImpuestos),
          mtoPrecioUnitario: orig.mtoPrecioUnitario,
        });
      }
    }

    // --- Motivo 03 = Corrección por error en descripción
    if (motivoNota.codigo === '03') {
      if (!Array.isArray(detalles) || detalles.length === 0) {
        throw new BadRequestException(
          'Debe indicar los detalles para corrección por descripción',
        );
      }
      for (const item of detalles) {
        if (!item.descripcion) {
          throw new BadRequestException(
            `Debe indicar la nueva descripción para el producto ${item.productoId}`,
          );
        }
        const orig = afectado.detalles.find(
          (d) => d.productoId === item.productoId,
        );
        if (!orig) {
          throw new BadRequestException(
            `El producto ${item.productoId} no existe en la factura original`,
          );
        }
        detalleFinal.push({
          productoId: orig.productoId,
          unidad: orig.unidad,
          descripcion: item.descripcion || orig.descripcion,
          cantidad: orig.cantidad,
          mtoValorUnitario: this.round2(orig.mtoValorUnitario),
          mtoValorVenta: this.round2(orig.mtoValorVenta),
          mtoBaseIgv: this.round2(orig.mtoBaseIgv),
          porcentajeIgv: this.round2(orig.porcentajeIgv),
          igv: this.round2(orig.igv),
          tipAfeIgv: orig.tipAfeIgv,
          totalImpuestos: this.round2(orig.totalImpuestos),
          mtoPrecioUnitario: orig.mtoPrecioUnitario,
        });
      }
    }

    // --- Motivo 04 = Descuento global
    if (motivoNota.codigo === '04') {
      const totalDesc = Math.min(
        montoDescuentoGlobal ?? 0,
        mtoOperGravadas + totalIGV,
      );
      if (totalDesc <= 0) {
        throw new BadRequestException('Debe indicar monto de descuento');
      }

      const igvPct = 0.18;
      const baseFinal = parseFloat((totalDesc / (1 + igvPct)).toFixed(2));
      const igvFinal = parseFloat((totalDesc - baseFinal).toFixed(2));
      const totalInc = parseFloat((baseFinal + igvFinal).toFixed(2));

      // Cargar producto placeholder
      const placeholder = await this.prisma.producto.findFirst({
        where: { empresaId, codigo: 'DGD' },
      });
      if (!placeholder) {
        throw new BadRequestException('Producto placeholder DGD no encontrado');
      }

      detalleFinal.push({
        productoId: placeholder.id,
        unidad: 'NIU',
        descripcion: placeholder.descripcion,
        cantidad: 1,
        mtoValorUnitario: baseFinal,
        mtoBaseIgv: baseFinal,
        porcentajeIgv: igvPct * 100,
        igv: igvFinal,
        tipAfeIgv: 10,
        totalImpuestos: igvFinal,
        mtoPrecioUnitario: totalInc,
        mtoValorVenta: baseFinal,
      });

      mtoOperGravadas = baseFinal;
      totalIGV = igvFinal;
    }

    // --- Motivo 05 = Descuento por ítem
    if (motivoNota.codigo === '05') {
      if (!Array.isArray(detalles) || detalles.length === 0) {
        throw new BadRequestException(
          'Debe indicar al menos un ítem para descuento por ítem',
        );
      }

      mtoOperGravadas = 0;
      totalIGV = 0;

      for (const item of detalles) {
        const orig = afectado.detalles.find(
          (d) => d.productoId === item.productoId,
        );
        if (!orig) {
          throw new BadRequestException(
            `El producto ${item.productoId} no existe en la factura original`,
          );
        }

        const qty = item.cantidad;
        const newInclUnit = this.round2(item.nuevoValorUnitario);
        const igvPct = Number(orig.porcentajeIgv) || 18;
        const valorUnitario = newInclUnit / (1 + igvPct / 100);
        const mtoValorVenta = valorUnitario * item.cantidad;
        const igvMonto = newInclUnit * qty - mtoValorVenta;

        mtoOperGravadas += mtoValorVenta;
        totalIGV += igvMonto;

        detalleFinal.push({
          productoId: orig.productoId,
          unidad: orig.unidad,
          descripcion: orig.descripcion,
          cantidad: qty,
          mtoValorUnitario: this.round2(valorUnitario),
          mtoBaseIgv: this.round2(mtoValorVenta),
          porcentajeIgv: igvPct,
          igv: this.round2(igvMonto),
          tipAfeIgv: orig.tipAfeIgv,
          totalImpuestos: this.round2(igvMonto),
          mtoPrecioUnitario: newInclUnit,
          mtoValorVenta: this.round2(mtoValorVenta),
        });
      }
    }

    // --- Motivo 07 = Devolución por ítem
    if (motivoNota.codigo === '07') {
      if (!Array.isArray(detalles) || detalles.length === 0) {
        throw new BadRequestException(
          'Debe indicar al menos un ítem para devolución por ítem',
        );
      }

      for (const item of detalles) {
        const orig = afectado.detalles.find(
          (d) => d.productoId === item.productoId,
        );
        if (!orig) {
          throw new BadRequestException(
            `El producto ${item.productoId} no existe en la factura original`,
          );
        }
        const qty = item.cantidad;
        const baseUnit = this.round2(orig.mtoValorUnitario);
        const inclUnit = this.round2(orig.mtoPrecioUnitario);

        const baseTotal = this.round2(baseUnit * qty);
        const igvTotal = this.round2(inclUnit * qty - baseTotal);

        detalleFinal.push({
          productoId: orig.productoId,
          unidad: orig.unidad,
          descripcion: orig.descripcion,
          cantidad: qty,
          mtoValorUnitario: baseUnit,
          mtoValorVenta: baseTotal,
          mtoBaseIgv: baseTotal,
          porcentajeIgv: orig.porcentajeIgv,
          igv: igvTotal,
          tipAfeIgv: orig.tipAfeIgv,
          totalImpuestos: igvTotal,
          mtoPrecioUnitario: inclUnit,
        });
      }

      // Recalcular totales de cabecera
      const totalBase = detalleFinal
        .map((d) => d.mtoBaseIgv)
        .reduce((sum, x) => sum + x, 0);
      const totalIgv = detalleFinal
        .map((d) => d.igv)
        .reduce((sum, x) => sum + x, 0);

      mtoOperGravadas = this.round2(totalBase);
      totalIGV = this.round2(totalIgv);
    }

    // 7) Calcular subtotales
    const subTotal = this.round2(mtoOperGravadas + totalIGV);
    const mtoImpVenta = this.round2(mtoOperGravadas + totalIGV);

    // 8) Validar tipoOperacion si se envía
    let tipoOperacionIdFinal: number | null = null;
    if (tipoOperacionId != null) {
      const to = await this.prisma.tipoOperacion.findUnique({
        where: { id: tipoOperacionId },
      });
      if (!to) {
        tipoOperacionIdFinal = null;
      } else {
        tipoOperacionIdFinal = tipoOperacionId;
      }
    }

    // 9) Serie y correlativo
    const { serie, correlativo } = await this.obtenerSerieYCorrelativo(
      '07',
      tipDocAfectado,
      empresaId,
    );

    const fecha = new Date(fechaEmision);

    // 10) Crear Nota de Crédito
    const nota = await this.prisma.comprobante.create({
      data: {
        tipoOperacionId: tipoOperacionIdFinal ?? undefined,
        tipoDoc: '07',
        serie,
        correlativo,
        fechaEmision: fecha,
        formaPagoTipo,
        formaPagoMoneda,
        tipoMoneda,
        observaciones: observaciones ?? null,
        clienteId: finalClienteId,
        empresaId,
        sedeId,
        usuarioId: usuarioId ?? undefined,
        mtoOperGravadas,
        mtoIGV: totalIGV,
        medioPago,
        valorVenta: mtoOperGravadas,
        mtoDescuentoGlobal:
          motivoNota.codigo === '04' ? montoDescuentoGlobal : undefined,
        totalImpuestos: totalIGV,
        subTotal,
        mtoImpVenta,
        estadoEnvioSunat: EstadoSunat.PENDIENTE,
        detalles: {
          create: detalleFinal,
        },
        leyendas: {
          create: [{ code: '1000', value: leyenda }],
        },
        tipDocAfectado: tipDocAfectadoFinal,
        numDocAfectado,
        motivoId,
      },
    });

    // 11) Ajuste de stock: únicamente para motivos 01, 06 y 07 (anulaciones y devoluciones)
    if (['01', '06', '07'].includes(motivoNota.codigo)) {
      await this.revertirStock(detalleFinal, {
        empresaId,
        comprobanteId: nota.id,
        concepto: `Nota de Crédito ${motivoNota.descripcion} ${nota.serie}-${nota.correlativo}`,
      });
    }

    // 12) Actualizar estado del comprobante afectado según motivo
    if (['01', '06'].includes(motivoNota.codigo)) {
      // Eliminar pagos del comprobante original — la NC lo anula totalmente
      await this.prisma.pago.deleteMany({
        where: { comprobanteId: afectado.id },
      });

      await this.prisma.comprobante.update({
        where: { id: afectado.id },
        data: {
          estadoEnvioSunat: EstadoSunat.ANULADO,
          estadoPago: 'ANULADO' as any,
          saldo: 0,
        },
      });
    }

    return nota;
  }

  async crearInformal(
    input: any,
    empresaId: number,
    usuarioId?: number,
    sedeId?: number,
  ) {
    const {
      fechaEmision,
      formaPagoTipo,
      formaPagoMoneda,
      tipoMoneda,
      medioPago,
      clienteId,
      leyenda,
      detalles,
      observaciones,
      clienteName,
      tipoDoc,
      tipoOperacionId,
      adelanto,
      fechaRecojo,
      vuelto,
      fechaVencimientoCredito,
      cuotas,
      paymentDetails,
      montoDescuentoGlobal,
    } = input;
    // Resolver cliente
    let finalClienteId: number | null = clienteId ?? null;
    if (clienteName === 'CLIENTES VARIOS') {
      const clienteVarios = await this.prisma.cliente.findFirst({
        where: {
          nombre: 'CLIENTES VARIOS',
          empresaId,
          estado: 'ACTIVO' as any,
        },
        select: { id: true },
      });
      if (!clienteVarios) {
        throw new BadRequestException(
          "No existe el cliente 'CLIENTES VARIOS' ACTIVO para esta empresa",
        );
      }
      finalClienteId = clienteVarios.id;
    } else if (!finalClienteId) {
      throw new BadRequestException('clienteId es requerido');
    }
    const {
      detalleFinal,
      mtoOperGravadas,
      mtoOpExoneradas,
      mtoOpInafectas,
      totalIGV,
    } = await this.cargarProductosYDetalles(detalles, empresaId);
    await this.validarSeriesComprobante(
      detalleFinal,
      empresaId,
      tipoDoc !== 'COT',
    );
    const valorVenta = this.round2(
      mtoOperGravadas + mtoOpExoneradas + mtoOpInafectas,
    );
    const subTotal = this.round2(valorVenta + totalIGV);
    const descuentoGlobal = this.round2(
      Math.max(0, Number(montoDescuentoGlobal ?? 0)),
    );
    const mtoImpVenta = this.round2(Math.max(0, subTotal - descuentoGlobal));
    const fecha = new Date(fechaEmision);

    // Validar tipoOperacionId si existe para evitar error de FK
    let tipoOperacionIdFinal: number | null = null;
    if (tipoOperacionId != null) {
      const to = await this.prisma.tipoOperacion.findUnique({
        where: { id: tipoOperacionId },
      });
      tipoOperacionIdFinal = to ? tipoOperacionId : null;
    }

    // Normalizar medio de pago a enum esperado (YAPE, PLIN, EFECTIVO, TRANSFERENCIA, TARJETA)
    const medioPagoFinal = (medioPago ?? '').toString().toUpperCase();
    const mediosPermitidos = [
      'YAPE',
      'PLIN',
      'EFECTIVO',
      'TRANSFERENCIA',
      'TARJETA',
      'MIXTO',
    ];
    const medioPagoValido = mediosPermitidos.includes(medioPagoFinal)
      ? medioPagoFinal
      : 'EFECTIVO';

    // Determinar estado y saldo según tipo de comprobante y condición de pago
    // PRIORIDAD:
    // 1. NP con adelanto → PAGO_PARCIAL
    // 2. OT con adelanto → PAGO_PARCIAL
    // 3. formaPagoTipo = CREDITO → PENDIENTE_PAGO (independiente del medioPago)
    // 4. medioPago al contado → COMPLETADO
    // 5. resto → PENDIENTE_PAGO
    const pagosAlContado = [
      'EFECTIVO',
      'YAPE',
      'PLIN',
      'TRANSFERENCIA',
      'TARJETA',
      'MIXTO',
    ];
    const esCreditoPorTipo = (formaPagoTipo ?? '').toUpperCase() === 'CREDITO';
    const adelantoNormalizado = adelanto ? Math.max(Number(adelanto), 0) : 0;
    let estadoPagoInicial = 'COMPLETADO' as any;
    let saldoInicial = 0;

    // PRIORIDAD 1: Informales con adelanto → PAGO_PARCIAL
    if (tipoDoc !== 'COT' && adelantoNormalizado > 0) {
      saldoInicial = Math.max(
        0,
        this.round2(mtoImpVenta - adelantoNormalizado),
      );
      estadoPagoInicial =
        saldoInicial > 0 ? ('PAGO_PARCIAL' as any) : ('COMPLETADO' as any);
    }
    // PRIORIDAD 3: formaPagoTipo = CREDITO → PENDIENTE_PAGO sin importar medioPago
    else if (esCreditoPorTipo) {
      estadoPagoInicial = 'PENDIENTE_PAGO' as any;
      saldoInicial = mtoImpVenta;
    }
    // PRIORIDAD 4: medioPago al contado → COMPLETADO
    else if (pagosAlContado.includes(medioPagoValido)) {
      estadoPagoInicial = 'COMPLETADO' as any;
      saldoInicial = 0;
    }
    // PRIORIDAD 5: resto (TRANSFERENCIA, TARJETA sin crédito explícito) → PENDIENTE_PAGO
    else {
      estadoPagoInicial = 'PENDIENTE_PAGO' as any;
      saldoInicial = mtoImpVenta;
    }

    const montoPagadoInicial =
      tipoDoc !== 'COT'
        ? adelantoNormalizado > 0
          ? Math.min(adelantoNormalizado, mtoImpVenta)
          : estadoPagoInicial === 'COMPLETADO'
            ? mtoImpVenta
            : 0
        : 0;
    if (montoPagadoInicial > 0) {
      await this.validarDetallePago(
        paymentDetails,
        medioPagoValido,
        montoPagadoInicial,
        empresaId,
      );
    }

    // Si no viene sedeId, intentar usar la sede principal de la empresa
    let finalSedeId = sedeId;
    if (!finalSedeId) {
      const principal = await this.prisma.sede.findFirst({
        where: { empresaId, esPrincipal: true },
        select: { id: true },
      });
      if (principal) finalSedeId = principal.id;
    }

    // Crédito: normalizar cronograma de cuotas (o una única cuota a partir de
    // la fecha de vencimiento) para persistirlo igual que el path formal.
    // Defensivo: solo cuando llega información de cuotas o fecha, evitando
    // romper integraciones (sync) que crean crédito informal sin cronograma.
    const tieneInfoCredito =
      (Array.isArray(cuotas) && cuotas.length > 0) || !!fechaVencimientoCredito;
    const cuotasCredito =
      esCreditoPorTipo && saldoInicial > 0 && tieneInfoCredito
        ? this.normalizarCuotasCredito(
            saldoInicial,
            cuotas,
            fechaVencimientoCredito,
          )
        : null;

    const dataBase: any = {
      tipoOperacionId: tipoOperacionIdFinal ?? undefined,
      tipoDoc,
      fechaEmision: fecha,
      formaPagoTipo,
      formaPagoMoneda,
      tipoMoneda,
      cuotas: cuotasCredito ?? Prisma.JsonNull,
      observaciones: observaciones ?? null,
      clienteId: finalClienteId,
      empresaId,
      sedeId: finalSedeId,
      usuarioId: usuarioId ?? undefined,
      mtoOperGravadas,
      mtoOperInafectas: mtoOpInafectas,
      mtoOperExoneradas: mtoOpExoneradas,
      medioPago: medioPagoValido,
      paymentDetails: paymentDetails ?? Prisma.JsonNull,
      mtoIGV: totalIGV,
      valorVenta,
      totalImpuestos: totalIGV,
      subTotal,
      mtoDescuentoGlobal: descuentoGlobal > 0 ? descuentoGlobal : 0,
      mtoImpVenta,
      estadoEnvioSunat: 'NO_APLICA' as string,
      estadoPago: estadoPagoInicial,
      saldo: saldoInicial,
      adelanto:
        tipoDoc !== 'COT' && adelantoNormalizado > 0
          ? adelantoNormalizado
          : undefined,
      fechaRecojo:
        (tipoDoc === 'NP' || tipoDoc === 'OT') && fechaRecojo
          ? new Date(fechaRecojo)
          : undefined,
      fechaVencimientoCredito:
        esCreditoPorTipo && fechaVencimientoCredito
          ? new Date(fechaVencimientoCredito)
          : undefined,
      vuelto: vuelto != null ? Number(vuelto) : 0,
      // Campos de cotización
      cotizIncluirImagenes: input.cotizIncluirImagenes ?? false,
      cotizDescuento: input.cotizDescuento ?? 0,
      cotizVigencia: input.cotizVigencia ?? 7,
      cotizFirmante: input.cotizFirmante ?? null,
      cotizTerminos: input.cotizTerminos ?? null,
      cotizTipoPago: input.cotizTipoPago ?? 'CONTADO',
      cotizAdelanto: input.cotizAdelanto ?? 0,
      detalles: { create: this.limpiarDetalleParaPersistencia(detalleFinal) },
      leyendas: { create: [{ code: '1000', value: leyenda }] },
    };
    // Validar receta médica en backend si rubro farmacia/botica
    await this.validarRecetasSiFarmacia(detalles, empresaId);

    if (tipoDoc !== 'COT') {
      await this.validarStockDisponibleParaVenta(detalleFinal, {
        empresaId,
        sedeId: finalSedeId,
        usuarioId,
      });
    }

    const comp = await this.crearComprobanteConReintento(
      dataBase,
      tipoDoc,
      null,
      empresaId,
    );

    if (montoPagadoInicial > 0) {
      await this.registrarPagosDeEmision({
        comprobanteId: comp.id,
        empresaId,
        usuarioId,
        medioPago: medioPagoValido,
        paymentDetails,
        montoPagado: montoPagadoInicial,
        documento: `${tipoDoc}-${comp.serie}-${comp.correlativo}`,
        fecha,
      });
    }

    // Registrar movimientos de kardex
    if (tipoDoc !== 'COT') {
      await this.ajustarStock(detalleFinal, {
        empresaId,
        comprobanteId: comp.id,
        concepto: `Venta ${tipoDoc} ${comp.serie}-${comp.correlativo}`,
        sedeId: finalSedeId,
        usuarioId,
      });
      await this.registrarSeriesVendidas(comp.id, empresaId, finalSedeId);
    }

    // Registrar comisiones del vendedor (no bloqueante)
    if (usuarioId && this.comisionesService && tipoDoc !== 'COT') {
      try {
        await this.comisionesService.registrarComisionesDesdeComprobante({
          comprobanteId: comp.id,
          empresaId,
          vendedorId: usuarioId,
          fechaEmision: fecha,
          detalles: detalleFinal.map((d: any) => ({
            productoId: d.productoId ?? null,
            descripcion: d.descripcion,
            cantidad: d.cantidad,
            mtoPrecioUnitario: d.mtoPrecioUnitario,
          })),
        });
      } catch (err) {
        console.warn(
          '[crearInformal] Error al registrar comisiones:',
          err?.message,
        );
      }
    }

    return comp;
  }

  async actualizarCotizacion(id: number, input: any, empresaId: number) {
    const {
      fechaEmision,
      clienteId,
      leyenda,
      detalles,
      observaciones,
      clienteName,
      cotizVigencia,
      cotizTerminos,
    } = input;

    const comp = await this.prisma.comprobante.findFirst({
      where: { id, empresaId, tipoDoc: 'COT' },
    });
    if (!comp) {
      throw new NotFoundException('Cotización no encontrada');
    }

    // Resolver cliente
    let finalClienteId: number | null = clienteId ?? null;
    if (clienteName === 'CLIENTES VARIOS') {
      const clienteVarios = await this.prisma.cliente.findFirst({
        where: {
          nombre: 'CLIENTES VARIOS',
          empresaId,
          estado: 'ACTIVO' as any,
        },
        select: { id: true },
      });
      if (!clienteVarios) {
        throw new BadRequestException(
          "No existe el cliente 'CLIENTES VARIOS' ACTIVO",
        );
      }
      finalClienteId = clienteVarios.id;
    } else if (!finalClienteId) {
      throw new BadRequestException('clienteId es requerido');
    }

    const {
      detalleFinal,
      mtoOperGravadas,
      mtoOpExoneradas,
      mtoOpInafectas,
      totalIGV,
    } = await this.cargarProductosYDetalles(detalles, empresaId);
    const valorVenta = this.round2(
      mtoOperGravadas + mtoOpExoneradas + mtoOpInafectas,
    );
    const subTotal = this.round2(valorVenta + totalIGV);
    const mtoImpVenta = subTotal;
    const fecha = new Date(fechaEmision);

    return this.prisma.$transaction(async (tx) => {
      // Eliminar detalles y leyendas antiguos
      await tx.detalleComprobante.deleteMany({ where: { comprobanteId: id } });
      await tx.leyenda.deleteMany({ where: { comprobanteId: id } });

      // Actualizar comprobante
      const updated = await tx.comprobante.update({
        where: { id },
        data: {
          fechaEmision: fecha,
          observaciones: observaciones ?? null,
          clienteId: finalClienteId,
          leyendas: {
            create: [
              {
                code: '1000',
                value: leyenda ?? `Son S/ ${mtoImpVenta.toFixed(2)} soles`,
              },
            ],
          },
          mtoOperGravadas,
          mtoOperInafectas: mtoOpInafectas,
          mtoOperExoneradas: mtoOpExoneradas,
          mtoIGV: totalIGV,
          valorVenta,
          totalImpuestos: totalIGV,
          subTotal,
          mtoImpVenta,
          cotizVigencia: cotizVigencia ? Number(cotizVigencia) : null,
          cotizTerminos: cotizTerminos ?? null,
          detalles: {
            createMany: {
              data: detalleFinal.map((d: any) => ({
                productoId: d.productoId,
                unidad: d.unidad,
                descripcion: d.descripcion,
                cantidad: d.cantidad,
                mtoValorUnitario: d.mtoValorUnitario,
                mtoValorVenta: d.mtoValorVenta,
                mtoBaseIgv: d.mtoBaseIgv,
                porcentajeIgv: d.porcentajeIgv,
                igv: d.igv,
                totalImpuestos: d.totalImpuestos,
                mtoPrecioUnitario: d.mtoPrecioUnitario,
                factorIcbper: d.factorIcbper,
                icbper: d.icbper,
                tipAfeIgv: d.tipAfeIgv,
              })),
            },
          },
        },
      });
      return updated;
    });
  }

  private buildCotizacionPruebaWhere(params: {
    empresaId: number;
    sedeId?: number | null;
    usuarioId?: number | null;
    fechaInicio?: string;
    fechaFin?: string;
    search?: string;
  }): Prisma.ComprobanteWhereInput {
    const filters: Prisma.ComprobanteWhereInput[] = [];
    const search = String(params.search || '').trim();

    if (params.sedeId) filters.push({ sedeId: params.sedeId });
    if (params.usuarioId) filters.push({ usuarioId: params.usuarioId });

    if (params.fechaInicio || params.fechaFin) {
      const fechaEmision: Prisma.DateTimeFilter = {};
      if (params.fechaInicio) {
        fechaEmision.gte = new Date(`${params.fechaInicio}T00:00:00.000-05:00`);
      }
      if (params.fechaFin) {
        fechaEmision.lte = new Date(`${params.fechaFin}T23:59:59.999-05:00`);
      }
      filters.push({ fechaEmision });
    }

    if (search) {
      const searchAsNumber = Number(search);
      filters.push({
        OR: [
          { serie: { contains: search, mode: 'insensitive' } },
          ...(Number.isNaN(searchAsNumber)
            ? []
            : [{ correlativo: searchAsNumber }]),
          { cliente: { nombre: { contains: search, mode: 'insensitive' } } },
          { cliente: { nroDoc: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    return {
      empresaId: params.empresaId,
      tipoDoc: 'COT',
      comprobantesDerivados: { none: {} },
      ...(filters.length ? { AND: filters } : {}),
    };
  }

  private async borrarCotizacionesPorIds(
    tx: Prisma.TransactionClient,
    ids: number[],
  ) {
    if (!ids.length) return;

    const movimientos = await tx.movimientoKardex.findMany({
      where: { comprobanteId: { in: ids } },
      select: { id: true },
    });
    const movimientoIds = movimientos.map((item) => item.id);

    if (movimientoIds.length) {
      await tx.movimientoKardexLote.deleteMany({
        where: { movimientoId: { in: movimientoIds } },
      });
    }

    await tx.productoSerie.updateMany({
      where: { comprobanteId: { in: ids } },
      data: { comprobanteId: null, detalleComprobanteId: null },
    });
    await tx.campanaMarketing.updateMany({
      where: { comprobanteId: { in: ids } },
      data: { comprobanteId: null },
    });
    await tx.movimientoKardex.deleteMany({
      where: { comprobanteId: { in: ids } },
    });
    await tx.comisionVendedor.deleteMany({
      where: { comprobanteId: { in: ids } },
    });
    await tx.whatsAppEnvio.deleteMany({
      where: { comprobanteId: { in: ids } },
    });
    await tx.envioDespacho.deleteMany({
      where: { comprobanteId: { in: ids } },
    });
    await tx.pago.deleteMany({ where: { comprobanteId: { in: ids } } });
    await tx.leyenda.deleteMany({ where: { comprobanteId: { in: ids } } });
    await tx.detalleComprobante.deleteMany({
      where: { comprobanteId: { in: ids } },
    });
    await tx.comprobante.deleteMany({ where: { id: { in: ids } } });
  }

  async eliminarCotizacion(id: number, empresaId: number) {
    const cotizacion = await this.prisma.comprobante.findFirst({
      where: { id, empresaId, tipoDoc: 'COT' },
      select: {
        id: true,
        serie: true,
        correlativo: true,
        _count: { select: { comprobantesDerivados: true } },
      },
    });

    if (!cotizacion) throw new NotFoundException('Cotización no encontrada');
    if (cotizacion._count.comprobantesDerivados > 0) {
      throw new BadRequestException(
        'Esta cotización ya fue convertida y no puede eliminarse',
      );
    }

    await this.prisma.$transaction((tx) =>
      this.borrarCotizacionesPorIds(tx, [id]),
    );

    return {
      eliminado: true,
      id,
      numero: `${cotizacion.serie}-${String(cotizacion.correlativo).padStart(8, '0')}`,
    };
  }

  async limpiarCotizacionesPrueba(params: {
    empresaId: number;
    sedeId?: number | null;
    usuarioId?: number | null;
    fechaInicio?: string;
    fechaFin?: string;
    search?: string;
    confirmar?: boolean;
  }) {
    if (!params.confirmar) {
      throw new BadRequestException(
        'Debes confirmar la limpieza de cotizaciones',
      );
    }

    const tieneFiltro = Boolean(
      params.sedeId ||
        params.usuarioId ||
        String(params.fechaInicio || '').trim() ||
        String(params.fechaFin || '').trim() ||
        String(params.search || '').trim(),
    );
    if (!tieneFiltro) {
      throw new BadRequestException(
        'Aplica al menos un filtro antes de limpiar cotizaciones',
      );
    }

    const where = this.buildCotizacionPruebaWhere(params);
    const candidatas = await this.prisma.comprobante.findMany({
      where,
      select: { id: true },
      take: 500,
      orderBy: { id: 'asc' },
    });
    const ids = candidatas.map((item) => item.id);

    await this.prisma.$transaction((tx) =>
      this.borrarCotizacionesPorIds(tx, ids),
    );

    return {
      eliminados: ids.length,
      limiteAplicado: ids.length === 500,
      mensaje:
        ids.length === 500
          ? 'Se eliminaron 500 cotizaciones. Ejecuta la limpieza nuevamente si quedan más resultados.'
          : 'Cotizaciones de prueba eliminadas correctamente',
    };
  }

  async crearOT(
    input: any,
    empresaId: number,
    usuarioId?: number,
    sedeId?: number,
  ) {
    const {
      productoId,
      cantidad,
      precioUnitario,
      adelanto,
      estadoOT,
      clienteId,
      clienteName,
      observaciones,
      fechaEmision,
      descuentoOT,
      descuentoPorcOT,
    } = input;

    // Validar producto
    const producto = await this.prisma.producto.findUnique({
      where: { id: productoId },
    });
    if (!producto) {
      throw new BadRequestException('Producto no encontrado');
    }

    // Resolver cliente
    let finalClienteId: number | null = clienteId ?? null;
    if (clienteName === 'CLIENTES VARIOS') {
      const clienteVarios = await this.prisma.cliente.findFirst({
        where: {
          nombre: 'CLIENTES VARIOS',
          empresaId,
          estado: 'ACTIVO' as any,
        },
        select: { id: true },
      });
      if (!clienteVarios) {
        throw new BadRequestException(
          "No existe el cliente 'CLIENTES VARIOS' ACTIVO para esta empresa",
        );
      }
      finalClienteId = clienteVarios.id;
    } else if (!finalClienteId) {
      throw new BadRequestException('clienteId es requerido');
    }

    // Calcular totales
    const subTotalSinDescuento = this.round2(cantidad * precioUnitario);
    const descuentoMonto = descuentoOT
      ? this.round2(descuentoOT)
      : descuentoPorcOT
        ? this.round2((subTotalSinDescuento * (descuentoPorcOT || 0)) / 100)
        : 0;
    const mtoValorVenta = this.round2(subTotalSinDescuento - descuentoMonto);
    const adelantoNormalizado = adelanto ? Number(adelanto) : 0;
    const saldo = this.round2(mtoValorVenta - adelantoNormalizado);

    // Determinar estado de pago basado en adelanto
    let estadoPagoInicial = 'PENDIENTE_PAGO' as any;
    if (adelantoNormalizado > 0) {
      estadoPagoInicial =
        saldo > 0 ? ('PAGO_PARCIAL' as any) : ('COMPLETADO' as any);
    }

    // Obtener serie y correlativo
    const { serie, correlativo } = await this.obtenerSerieYCorrelativo(
      'OT',
      null,
      empresaId,
    );

    const fecha = fechaEmision ? new Date(fechaEmision) : new Date();

    // Crear comprobante OT
    const comp = await this.prisma.comprobante.create({
      data: {
        tipoDoc: 'OT',
        serie,
        correlativo,
        fechaEmision: fecha,
        clienteId: finalClienteId,
        empresaId,
        sedeId,
        usuarioId: usuarioId ?? undefined,
        mtoOperGravadas: mtoValorVenta,
        mtoIGV: 0,
        valorVenta: mtoValorVenta,
        totalImpuestos: 0,
        subTotal: mtoValorVenta,
        mtoImpVenta: mtoValorVenta,
        formaPagoTipo: 'CREDITO',
        formaPagoMoneda: 'PEN',
        tipoMoneda: 'PEN',
        estadoEnvioSunat: EstadoSunat.NO_APLICA,
        estadoPago: estadoPagoInicial,
        saldo: Math.max(0, saldo),
        estadoOT: estadoOT || 'PENDIENTE',
        adelanto: adelantoNormalizado,
        descuentoOT: descuentoMonto,
        descuentoPorcOT: descuentoPorcOT || 0,
        observaciones: observaciones ?? null,
        detalles: {
          create: [
            {
              productoId,
              unidad: 'UND',
              descripcion: producto.descripcion,
              cantidad,
              mtoValorUnitario: precioUnitario,
              mtoValorVenta,
              mtoBaseIgv: 0,
              porcentajeIgv: 0,
              igv: 0,
              totalImpuestos: 0,
              mtoPrecioUnitario: precioUnitario,
              tipAfeIgv: 10,
            },
          ],
        },
      },
      include: {
        cliente: { select: { id: true, nombre: true, nroDoc: true } },
        detalles: { include: { producto: true } },
      },
    });

    // Crear registro de pago automáticamente si hay adelanto
    if (adelantoNormalizado > 0) {
      await this.prisma.pago.create({
        data: {
          comprobanteId: comp.id,
          empresaId,
          monto: adelantoNormalizado,
          medioPago: 'EFECTIVO', // Por defecto para OT
          observacion: 'Pago adelantado registrado automáticamente',
          referencia: `OT-${serie}-${correlativo}`,
        },
      });
    }

    return comp;
  }

  async actualizarEstadoOT(
    comprobanteId: number,
    input: { estadoOT: string; fechaRecojo?: string },
  ) {
    const comp = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
    });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');

    if (comp.tipoDoc !== 'OT') {
      throw new BadRequestException(
        'Este endpoint solo aplica a órdenes de trabajo (OT)',
      );
    }

    const estadosValidos = ['EN_PROCESO', 'LISTO', 'ENTREGADO'];
    if (!estadosValidos.includes(input.estadoOT)) {
      throw new BadRequestException(
        `Estado debe ser uno de: ${estadosValidos.join(', ')}`,
      );
    }

    if (input.estadoOT === 'ENTREGADO' && (comp.saldo ?? 0) > 0) {
      throw new BadRequestException(
        'No se puede marcar como entregado si hay saldo pendiente',
      );
    }

    const data: any = { estadoOT: input.estadoOT };
    if (input.fechaRecojo) {
      data.fechaRecojo = new Date(input.fechaRecojo);
    }

    return this.prisma.comprobante.update({
      where: { id: comprobanteId },
      data,
    });
  }

  /**
   * Obtiene las estadísticas de uso de comprobantes SUNAT para una empresa
   * Solo cuenta Facturas (01) y Boletas (03) con estado EMITIDO o ANULADO
   */
  async getUsageStats(empresaId: number, sedeId?: number) {
    // Obtener el plan de la empresa
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { plan: true },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const limiteMaximo = empresa.plan?.maxComprobantes ?? 100; // Default 100 if not set

    // Calcular inicio y fin del mes actual
    const now = new Date();
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
    const finMes = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    // Contar comprobantes SUNAT del mes actual
    // Facturas (01), Boletas (03), Notas Crédito (07), Notas Débito (08) con estado EMITIDO o ANULADO
    // + Guías de Remisión (tipoDocumento 09 y 31) con estado EMITIDO o ANULADO
    const ESTADOS_CONTABLES: EstadoSunat[] = [
      EstadoSunat.ENVIADO,
      EstadoSunat.EMITIDO,
      EstadoSunat.REGISTRADO,
      EstadoSunat.ANULADO,
    ];

    const [facturasYBoletas, guiasRemision] = await Promise.all([
      this.prisma.comprobante.count({
        where: {
          empresaId,
          ...(sedeId ? { sedeId } : {}),
          tipoDoc: { in: ['01', '03'] },
          estadoEnvioSunat: { in: ESTADOS_CONTABLES },
          creadoEn: { gte: inicioMes, lte: finMes },
        },
      }),
      this.prisma.guiaRemision.count({
        where: {
          empresaId,
          estadoSunat: { in: ESTADOS_CONTABLES },
          creadoEn: { gte: inicioMes, lte: finMes },
        },
      }),
    ]);

    const comprobantesEmitidos = facturasYBoletas + guiasRemision;

    const esIlimitado = limiteMaximo === 0;
    const porcentajeUso = esIlimitado
      ? 0
      : Math.round((comprobantesEmitidos / limiteMaximo) * 100);
    const puedeEmitir = esIlimitado || comprobantesEmitidos < limiteMaximo;
    const restantes = esIlimitado
      ? null
      : Math.max(0, limiteMaximo - comprobantesEmitidos);

    return {
      comprobantesEmitidos,
      facturasYBoletas,
      guiasRemision,
      limiteMaximo: esIlimitado ? null : limiteMaximo,
      esIlimitado,
      porcentajeUso,
      puedeEmitir,
      restantes,
      mesActual: inicioMes.toISOString().slice(0, 7),
      alerta80: !esIlimitado && porcentajeUso >= 80 && porcentajeUso < 100,
      limiteAlcanzado: !esIlimitado && porcentajeUso >= 100,
      plan: empresa.plan?.nombre || 'Sin plan',
    };
  }

  // ─── Helpers compartidos PDF informal ────────────────────────────────────

  private async cargarComprobanteCompleto(id: number) {
    return this.prisma.comprobante.findUnique({
      where: { id },
      include: {
        cliente: { include: { tipoDocumento: true } },
        empresa: { include: { ubicacion: true, rubro: true } },
        detalles: { include: { producto: { select: { imagenUrl: true } } } },
        tipoDetraccion: true,
        medioPagoDetraccion: true,
        usuario: { select: { nombre: true, celular: true, email: true } },
      },
    });
  }

  private async buildPdfBufferInformal(
    id: number,
  ): Promise<{ buffer: Buffer; key: string }> {
    const full = await this.cargarComprobanteCompleto(id);
    if (!full) throw new NotFoundException('Comprobante no encontrado');

    const tipoDocMap: Record<string, string> = {
      '01': 'FACTURA',
      '03': 'BOLETA',
      '07': 'NOTA DE CRÉDITO',
      '08': 'NOTA DE DÉBITO',
      TICKET: 'TICKET',
      NV: 'NOTA DE VENTA',
      RH: 'RECIBO POR HONORARIOS',
      CP: 'COMPROBANTE DE PAGO',
      NP: 'NOTA DE PEDIDO',
      OT: 'ORDEN DE TRABAJO',
      COT: 'COTIZACIÓN',
    };
    const fecha = new Date(full.fechaEmision as any);
    const pagosAlContado = ['EFECTIVO', 'YAPE', 'PLIN'];
    const formaPago = pagosAlContado.includes(
      (full.medioPago || '').toUpperCase(),
    )
      ? 'CONTADO'
      : 'CRÉDITO';

    const buildLogoDataUrl = (raw?: string | null): string | undefined => {
      if (!raw) return undefined;
      const t = raw.trim();
      if (t.startsWith('data:')) return t;
      if (/^https?:\/\//i.test(t) || t.startsWith('/')) return t;
      return `data:${t.startsWith('/9j/') ? 'image/jpeg' : 'image/png'};base64,${t}`;
    };
    const formatCantidad = (value: any): string => {
      const cantidad = Number(value || 0);
      if (!Number.isFinite(cantidad)) return '0';
      if (Number.isInteger(cantidad)) return String(cantidad);
      return cantidad.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    };

    const productos = full.detalles.map((d: any, i: number) => ({
      index: i + 1,
      cantidad: formatCantidad(d.cantidad),
      unidadMedida: (d.unidad || 'NIU').toUpperCase(),
      descripcion: (d.descripcion || '').toUpperCase(),
      precioUnitario: Number(d.mtoPrecioUnitario || 0).toFixed(2),
      total: Number((d.mtoPrecioUnitario || 0) * d.cantidad).toFixed(2),
      imagenUrl: buildLogoDataUrl(d.producto?.imagenUrl || d.imagenUrl),
      lotes:
        d.lotes?.map((l: any) => ({
          lote: l.lote,
          fechaVencimiento: l.fechaVencimiento
            ? new Date(l.fechaVencimiento).toLocaleDateString('es-PE')
            : '',
        })) || undefined,
    }));

    const mtoImpVenta = Number(full.mtoImpVenta || 0);
    const isDocumentoFiscal = ['01', '03', '07', '08'].includes(full.tipoDoc);
    const descuento = Number((full as any).mtoDescuentoGlobal || 0).toFixed(2);

    // Retención
    const obs = (full.observaciones || '').toUpperCase();
    const hasRetentionText = obs.includes('RETENCIÓN') && obs.includes('3%');
    const retencionMonto = hasRetentionText
      ? Number((mtoImpVenta * 0.03).toFixed(2))
      : 0;
    const shouldShowRetention = hasRetentionText && retencionMonto > 0;

    const ahora = new Date();
    const fechaImpresion =
      ahora.toLocaleDateString('es-PE') +
      ' ' +
      ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

    const razonSocialEmpresa = String(
      full.empresa?.razonSocial || (full.empresa as any)?.nombreComercial || '',
    ).toUpperCase();
    const pdfData: any = {
      nombreComercial: (full.empresa as any)?.nombreComercial
        ? String((full.empresa as any).nombreComercial).toUpperCase()
        : razonSocialEmpresa,
      razonSocial: razonSocialEmpresa,
      ruc: full.empresa?.ruc || '',
      direccion: (full.empresa?.direccion || '').toUpperCase(),
      rubro: full.empresa.rubro?.nombre?.toUpperCase() || '',
      celular: (
        (full.empresa as any).celular ||
        (full.empresa as any).telefono ||
        ''
      ).toString(),
      email: ((full.empresa as any).email || '').toString(),
      logo: buildLogoDataUrl((full.empresa as any).logo),
      tipoDocumento: tipoDocMap[full.tipoDoc] || 'COMPROBANTE',
      serie: full.serie,
      correlativo: String(full.correlativo).padStart(8, '0'),
      fecha: fecha.toLocaleDateString('es-PE'),
      hora: fecha.toLocaleTimeString('es-PE', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      clienteNombre: (full.cliente?.nombre || 'CLIENTES VARIOS').toUpperCase(),
      clienteTipoDoc:
        full.cliente?.tipoDocumento?.codigo === '6' ? 'RUC' : 'DNI',
      clienteNumDoc: full.cliente?.nroDoc || '',
      clienteDireccion: (full.cliente?.direccion || '-').toUpperCase(),
      clienteEmail: (full.cliente as any)?.email || undefined,
      clienteTelefono: (full.cliente as any)?.telefono || undefined,
      productos,
      isDocumentoFiscal,
      mtoOperGravadas: Number(full.mtoOperGravadas || 0).toFixed(2),
      mtoIGV: Number(full.mtoIGV || 0).toFixed(2),
      mtoOperExoneradas: Number((full as any).mtoOperExoneradas || 0).toFixed(
        2,
      ),
      mtoOperInafectas: Number((full as any).mtoOperInafectas || 0).toFixed(2),
      mtoImpVenta: mtoImpVenta.toFixed(2),
      descuento,
      totalEnLetras: numeroALetras(mtoImpVenta).toUpperCase(),
      formaPago,
      medioPago: (full.medioPago || 'EFECTIVO').toUpperCase(),
      vuelto: Number((full as any).vuelto || 0).toFixed(2),
      pagado: (mtoImpVenta + Number((full as any).vuelto || 0)).toFixed(2),
      vendedor: (full.usuario?.nombre || 'ADMIN').toUpperCase(),
      observaciones: full.observaciones
        ? full.observaciones.toUpperCase()
        : undefined,
      shouldShowRetention,
      retencionMonto: retencionMonto.toFixed(2),
      importeNeto: (mtoImpVenta - retencionMonto).toFixed(2),
      qrCode: undefined,
      tipoDetraccion: full.tipoDetraccion
        ? `${full.tipoDetraccion.codigo} - ${full.tipoDetraccion.descripcion} (${full.tipoDetraccion.porcentaje}%)`
        : undefined,
      montoDetraccion: full.montoDetraccion
        ? Number(full.montoDetraccion).toFixed(2)
        : undefined,
      cuentaBancoNacion: full.cuentaBancoNacion || undefined,
      medioPagoDetraccion: full.medioPagoDetraccion
        ? `${full.medioPagoDetraccion.codigo} - ${full.medioPagoDetraccion.descripcion}`
        : undefined,
      yapeNumero: (full.empresa as any).yapeNumero || undefined,
      yapeQrUrl: buildLogoDataUrl((full.empresa as any).yapeQrUrl),
      plinNumero: (full.empresa as any).plinNumero || undefined,
      plinQrUrl: buildLogoDataUrl((full.empresa as any).plinQrUrl),
      usuario: 'ADMIN',
      fechaImpresion,
    };

    let buffer: Buffer;
    if (full.tipoDoc === 'COT') {
      const usuarioNombre = (full as any).usuario?.nombre || '';
      const cotizacionData = {
        ...pdfData,
        celular: (full as any).usuario?.celular || '',
        email: (full as any).usuario?.email || '',
        formaPago: (() => {
          const tipo = (full as any).cotizTipoPago || 'CONTADO';
          const adelanto = (full as any).cotizAdelanto || 0;
          const map: Record<string, string> = {
            CONTADO: 'CONTADO',
            CREDITO_30: 'CRÉDITO 30 DÍAS',
            CREDITO_60: 'CRÉDITO 60 DÍAS',
            CREDITO_90: 'CRÉDITO 90 DÍAS',
          };
          return tipo === 'ADELANTO'
            ? `ADELANTO ${adelanto}%`
            : map[tipo] || tipo;
        })(),
        subTotal: Number(full.subTotal || 0).toFixed(2),
        descuento: full.mtoDescuentoGlobal
          ? Number(full.mtoDescuentoGlobal).toFixed(2)
          : undefined,
        validez: full.cotizVigencia ? `${full.cotizVigencia} días` : '7 días',
        cotizTerminos: full.cotizTerminos || undefined,
        clienteEmail: (full.cliente as any)?.email || '-',
        clienteTelefono: (full.cliente as any)?.telefono || '-',
        bancoNombre: (full.empresa as any).bancoNombre || undefined,
        numeroCuenta: (full.empresa as any).numeroCuenta || undefined,
        cci: (full.empresa as any).cci || undefined,
        monedaCuenta: (full.empresa as any).monedaCuenta || 'SOLES',
        includeProductImages: !!(full as any).cotizIncluirImagenes,
        usuario: usuarioNombre
          ? `${usuarioNombre} ${fechaImpresion}`
          : fechaImpresion,
        sistemaUrl:
          process.env.APP_URL ||
          process.env.FRONTEND_URL ||
          'https://falconext.pe',
        sistemaNombre: process.env.APP_NAME || 'Falconext',
      };
      buffer = await this.pdfGenerator.generarPDFCotizacion(cotizacionData);
    } else {
      buffer = await this.pdfGenerator.generarPDFComprobante(pdfData);
    }

    const key = this.s3Service.generateComprobanteKey(
      full.empresaId,
      full.tipoDoc,
      full.serie,
      full.correlativo,
      'pdf',
    );
    return { buffer, key };
  }

  // ─── Wrapper público para el controller público ───────────────────────────
  async generarBufferPdf(id: number): Promise<{ buffer: Buffer; key: string }> {
    return this.buildPdfBufferInformal(id);
  }

  // ─── Genera PDF, sube a S3 y devuelve URL permanente ─────────────────────
  async generarYSubirPdf(
    id: number,
    context?: { empresaId?: number; rol?: string },
  ): Promise<string> {
    const comprobante = await this.prisma.comprobante.findFirst({
      where: {
        id,
        ...(context?.rol === this.adminSistemaRole || !context?.empresaId
          ? {}
          : { empresaId: context.empresaId }),
      },
      select: { s3PdfUrl: true },
    });

    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');
    if (comprobante.s3PdfUrl) return comprobante.s3PdfUrl;

    let buffer: Buffer;
    let key: string;
    try {
      ({ buffer, key } = await this.buildPdfBufferInformal(id));
    } catch (error: any) {
      // Log detallado para diagnosticar el 500 (antes se perdía en un error genérico).
      this.logger.error(
        `Error generando PDF del comprobante ${id}: ${error?.message}`,
        error?.stack,
      );
      throw new BadRequestException(
        `No se pudo generar el PDF del comprobante: ${error?.message || 'error desconocido'}`,
      );
    }

    if (this.s3Service.isEnabled()) {
      try {
        const url = await this.s3Service.uploadPDF(buffer, key);
        await this.prisma.comprobante.update({
          where: { id },
          data: { s3PdfUrl: url },
        });
        return url;
      } catch (error) {
        this.logger.warn(
          `No se pudo subir PDF a S3: ${error.message}. Usando URL temporal.`,
        );
      }
    }

    return this.generarUrlPdfPublico(id);
  }

  async obtenerXmlComprobante(
    empresaId: number,
    id: number,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const comprobante = await this.prisma.comprobante.findFirst({
      where: { id, empresaId },
      select: {
        tipoDoc: true,
        serie: true,
        correlativo: true,
        sunatXml: true,
      },
    });

    if (!comprobante?.sunatXml) {
      throw new BadRequestException('El comprobante no tiene XML disponible');
    }

    const correlativo = String(comprobante.correlativo).padStart(8, '0');
    return {
      buffer: Buffer.from(comprobante.sunatXml, 'utf8'),
      filename: `${comprobante.serie}-${correlativo}.xml`,
      contentType: 'application/xml',
    };
  }

  async obtenerCdrComprobante(
    empresaId: number,
    id: number,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const comprobante = await this.prisma.comprobante.findFirst({
      where: { id, empresaId },
      select: {
        serie: true,
        correlativo: true,
        sunatCdrZip: true,
      },
    });

    if (!comprobante?.sunatCdrZip) {
      throw new BadRequestException('El comprobante no tiene CDR disponible');
    }

    const buffer = Buffer.from(comprobante.sunatCdrZip, 'base64');
    const isXml = buffer.toString('utf8').trim().startsWith('<');
    const correlativo = String(comprobante.correlativo).padStart(8, '0');

    return {
      buffer,
      filename: `${comprobante.serie}-${correlativo}-CDR.${isXml ? 'xml' : 'zip'}`,
      contentType: isXml ? 'application/xml' : 'application/zip',
    };
  }

  // ─── URL pública con token HMAC (sin S3) ─────────────────────────────────

  private tokenPdf(id: number): string {
    const crypto = require('crypto');
    const secret = process.env.PDF_TOKEN_SECRET || process.env.JWT_SECRET;
    if (
      !secret ||
      (process.env.NODE_ENV === 'production' && secret.length < 32)
    ) {
      throw new Error(
        'PDF_TOKEN_SECRET o JWT_SECRET debe tener al menos 32 caracteres.',
      );
    }
    return crypto
      .createHmac('sha256', secret)
      .update(`pdf:${id}`)
      .digest('hex');
  }

  generarUrlPdfPublico(id: number): string {
    const base = process.env.BACKEND_URL || 'http://localhost:4001';
    const token = this.tokenPdf(id);
    return `${base}/api/comprobante/${id}/pdf-publico?token=${token}`;
  }

  validarTokenPdf(id: number, token: string): boolean {
    return token === this.tokenPdf(id);
  }

  private getPlatformWhatsAppCredentials(): {
    token: string;
    phoneNumberId: string;
  } {
    const token =
      process.env.WHATSAPP_TOKEN || process.env.META_WHATSAPP_TOKEN || '';

    const phoneNumberId =
      process.env.WHATSAPP_PHONE_ID ||
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      process.env.META_WHATSAPP_PHONE_ID ||
      '';

    return { token, phoneNumberId };
  }

  private async getWhatsAppCredentials(empresaId: number): Promise<{
    token: string;
    phoneNumberId: string;
    source: 'PLATFORM' | 'EMPRESA';
  }> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        whatsappProvider: true,
        whatsappApiToken: true,
        whatsappPhoneNumberId: true,
        whatsappActivo: true,
      },
    });

    if (!empresa?.whatsappActivo || empresa?.whatsappProvider === 'DISABLED') {
      throw new BadRequestException(
        'WhatsApp está deshabilitado para esta empresa.',
      );
    }

    if (empresa.whatsappProvider === 'EMPRESA') {
      if (!empresa.whatsappApiToken || !empresa.whatsappPhoneNumberId) {
        throw new BadRequestException(
          'WhatsApp propio no configurado. Agrega token y phone number ID de Meta para esta empresa.',
        );
      }

      return {
        token: empresa.whatsappApiToken,
        phoneNumberId: empresa.whatsappPhoneNumberId,
        source: 'EMPRESA',
      };
    }

    const platform = this.getPlatformWhatsAppCredentials();
    if (!platform.token || !platform.phoneNumberId) {
      throw new BadRequestException(
        'WhatsApp de plataforma no configurado. Agrega WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID en el .env.',
      );
    }

    return { ...platform, source: 'PLATFORM' };
  }

  private formatMetaWhatsAppError(metaPayload: any, fallback: string): string {
    const metaErr = metaPayload?.error || {};
    const type = metaErr?.type;
    const code = metaErr?.code;
    const subcode = metaErr?.error_subcode;
    const message = metaErr?.message || fallback;

    const tags = [
      type ? `type=${type}` : '',
      code !== undefined ? `code=${code}` : '',
      subcode !== undefined ? `subcode=${subcode}` : '',
    ].filter(Boolean);

    return `${tags.length ? `[Meta ${tags.join(', ')}] ` : ''}${message}`;
  }

  // ─── Enviar por WhatsApp (Meta Cloud API) ────────────────────────────────

  async enviarWhatsAppComprobante(
    id: number,
    celular: string,
    context?: { usuarioId?: number; empresaId?: number; rol?: string },
  ): Promise<void> {
    const comp = await this.cargarComprobanteCompleto(id);
    if (!comp) throw new NotFoundException('Comprobante no encontrado');
    if (
      context?.rol !== 'ADMIN_SISTEMA' &&
      context?.empresaId &&
      comp.empresaId !== context.empresaId
    ) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    const { token, phoneNumberId, source } = await this.getWhatsAppCredentials(
      comp.empresaId,
    );

    const tipoDocMap: Record<string, string> = {
      TICKET: 'Ticket',
      NV: 'Nota de Venta',
      RH: 'Recibo por Honorarios',
      CP: 'Comprobante de Pago',
      NP: 'Nota de Pedido',
      OT: 'Orden de Trabajo',
      COT: 'Cotización',
    };
    const tipoPretty = tipoDocMap[comp.tipoDoc] || comp.tipoDoc;
    const serie = comp.serie;
    const correlativo = String(comp.correlativo).padStart(8, '0');
    const monto = `S/ ${Number(comp.mtoImpVenta || 0).toFixed(2)}`;
    const clienteNombre = comp.cliente?.nombre || 'Cliente';
    const empresaNombre = comp.empresa.razonSocial;
    // Comprobantes SUNAT (BOLETA/FACTURA) ya tienen PDF en S3 — usar esa URL directamente.
    // Informales (Ticket, NV, etc.) se generan al vuelo con el endpoint HMAC.
    const pdfUrl = comp.s3PdfUrl || this.generarUrlPdfPublico(id);

    const numero = celular.replace(/\D/g, '').replace(/^0+/, '');
    const to = numero.startsWith('51') ? numero : `51${numero}`;
    const filename = `${tipoPretty.replace(/ /g, '_')}_${serie}-${correlativo}.pdf`;
    const caption = `Hola ${clienteNombre}, aquí está tu ${tipoPretty} ${serie}-${correlativo} por ${monto}.\n\nGracias por tu preferencia — ${empresaNombre}.`;

    // ── Paso 1: Obtener el buffer del PDF ────────────────────────────────────
    // Comprobantes SUNAT → descargar desde S3. Informales → generar con Puppeteer.
    let pdfBuffer: Buffer;
    if (comp.s3PdfUrl) {
      const s3Res = await fetch(comp.s3PdfUrl);
      if (!s3Res.ok)
        throw new BadRequestException('No se pudo descargar el PDF desde S3');
      pdfBuffer = Buffer.from(await s3Res.arrayBuffer());
    } else {
      ({ buffer: pdfBuffer } = await this.buildPdfBufferInformal(id));
    }

    const apiBase = `https://graph.facebook.com/v25.0/${phoneNumberId}`;
    const authHeader = `Bearer ${token}`;

    // ── Paso 2: Subir el PDF a los servidores de Meta ────────────────────────
    // Así Meta nunca necesita descargar desde una URL pública nuestra.
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', 'application/pdf');
    formData.append(
      'file',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      filename,
    );

    const uploadRes = await fetch(`${apiBase}/media`, {
      method: 'POST',
      headers: { Authorization: authHeader },
      body: formData,
    });

    if (!uploadRes.ok) {
      const uploadErr: any = await uploadRes.json().catch(() => ({}));
      const errorCode = uploadErr?.error?.code;
      const errorType = uploadErr?.error?.type;
      const errorSubcode = uploadErr?.error?.error_subcode;
      const formattedUploadError = this.formatMetaWhatsAppError(
        uploadErr,
        'No se pudo subir el PDF a WhatsApp',
      );

      if (
        errorType === 'OAuthException' ||
        errorCode === 190 ||
        errorSubcode === 463
      ) {
        throw new BadRequestException(
          `Error de autenticación en WhatsApp Cloud API. ${formattedUploadError}`,
        );
      }

      throw new BadRequestException(formattedUploadError);
    }

    const { id: mediaId } = (await uploadRes.json()) as { id: string };

    // ── Paso 3: Enviar el documento usando el media ID ────────────────────────
    const sendRes = await fetch(`${apiBase}/messages`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { id: mediaId, filename, caption },
      }),
    });

    if (!sendRes.ok) {
      const sendErr: any = await sendRes.json().catch(() => ({}));
      const errorCode = sendErr?.error?.code;
      const errorType = sendErr?.error?.type;
      const errorSubcode = sendErr?.error?.error_subcode;
      const formattedSendError = this.formatMetaWhatsAppError(
        sendErr,
        `Error al enviar WhatsApp (HTTP ${sendRes.status})`,
      );

      if (
        errorType === 'OAuthException' ||
        errorCode === 190 ||
        errorSubcode === 463
      ) {
        throw new BadRequestException(
          `Error de autenticación en WhatsApp Cloud API. ${formattedSendError}`,
        );
      }

      throw new BadRequestException(formattedSendError);
    }

    const sendPayload = (await sendRes.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
    } | null;
    const mensajeId = sendPayload?.messages?.[0]?.id;
    if (context?.usuarioId) {
      await this.prisma.whatsAppEnvio.create({
        data: {
          comprobanteId: id,
          empresaId: comp.empresaId,
          usuarioId: context.usuarioId,
          numeroDestino: to,
          estado: 'ENVIADO',
          mensajeId,
          costoUSD: 0.01,
          incluyeXML: false,
        },
      });
    }

    this.logger.log(
      `✅ WhatsApp comprobante enviado (${source}) comprobanteId=${id} destino=${to}`,
    );
  }

  // ─── Enviar por email ─────────────────────────────────────────────────────

  async enviarEmailComprobante(
    id: number,
    destinatario: string,
    context?: { empresaId?: number; rol?: string },
  ): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      throw new BadRequestException(
        'Correo no configurado. Agrega RESEND_API_KEY en el .env del backend.',
      );
    }

    const comp = await this.cargarComprobanteCompleto(id);
    if (!comp) throw new NotFoundException('Comprobante no encontrado');
    if (
      context?.rol !== this.adminSistemaRole &&
      context?.empresaId &&
      comp.empresaId !== context.empresaId
    ) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    // Comprobantes SUNAT ya tienen PDF en S3 — descargarlo directamente.
    // Informales se generan en memoria con Puppeteer.
    let buffer: Buffer;
    if (comp.s3PdfUrl) {
      const s3Res = await fetch(comp.s3PdfUrl);
      if (!s3Res.ok)
        throw new BadRequestException('No se pudo descargar el PDF desde S3');
      buffer = Buffer.from(await s3Res.arrayBuffer());
    } else {
      ({ buffer } = await this.buildPdfBufferInformal(id));
    }

    const tipoDocMap: Record<string, string> = {
      TICKET: 'Ticket',
      NV: 'Nota de Venta',
      RH: 'Recibo por Honorarios',
      CP: 'Comprobante de Pago',
      NP: 'Nota de Pedido',
      OT: 'Orden de Trabajo',
      COT: 'Cotización',
    };
    const tipoPretty = tipoDocMap[comp.tipoDoc] || comp.tipoDoc;
    const serie = comp.serie;
    const correlativo = String(comp.correlativo).padStart(8, '0');
    const monto = `S/ ${Number(comp.mtoImpVenta || 0).toFixed(2)}`;
    const empresaNombre = comp.empresa.razonSocial;
    const empresaRuc = comp.empresa.ruc ?? '';
    const empresaDireccion = comp.empresa.direccion ?? undefined;
    const clienteNombre = comp.cliente?.nombre || 'Cliente';
    const fecha = new Date(comp.fechaEmision).toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    const pdfUrl = comp.s3PdfUrl || this.generarUrlPdfPublico(id);

    const productos = (comp.detalles ?? []).map((item: any) => ({
      descripcion: item.descripcion,
      cantidad: Number(item.cantidad),
      unidad: item.unidad || undefined,
      precioUnitario: Number(
        item.mtoPrecioUnitario || item.mtoValorUnitario || 0,
      ).toFixed(2),
      total: Number(item.mtoValorVenta || 0).toFixed(2),
    }));

    const formaPago = (() => {
      if (comp.tipoDoc === 'COT') {
        const tipo = (comp as any).cotizTipoPago || 'CONTADO';
        const adelanto = (comp as any).cotizAdelanto || 0;
        const map: Record<string, string> = {
          CONTADO: 'Contado',
          CREDITO_30: 'Crédito 30 días',
          CREDITO_60: 'Crédito 60 días',
          CREDITO_90: 'Crédito 90 días',
        };
        return tipo === 'ADELANTO'
          ? `Adelanto ${adelanto}%`
          : map[tipo] || tipo;
      }
      return (comp as any).medioPago || undefined;
    })();

    const mtoOperGravadas = comp.mtoOperGravadas
      ? Number(comp.mtoOperGravadas).toFixed(2)
      : undefined;
    const mtoIGV = comp.mtoIGV ? Number(comp.mtoIGV).toFixed(2) : undefined;
    const descuento =
      comp.mtoDescuentoGlobal && Number(comp.mtoDescuentoGlobal) > 0
        ? Number(comp.mtoDescuentoGlobal).toFixed(2)
        : undefined;
    const empresaEmail =
      (comp as any).usuario?.email || (comp.empresa as any).email || undefined;
    const sistemaUrl =
      process.env.APP_URL || process.env.FRONTEND_URL || 'https://falconext.pe';
    const sistemaNombre = process.env.APP_NAME || 'Falconext';

    const { Resend } = await import('resend');
    const { render } = await import('@react-email/render');
    const { ComprobanteEmail } = await import('./emails/ComprobanteEmail.js');

    const html = await render(
      (ComprobanteEmail as any)({
        empresaNombre,
        empresaRuc,
        empresaDireccion,
        empresaEmail,
        tipoPretty,
        serie,
        correlativo,
        fecha,
        clienteNombre,
        monto,
        pdfUrl,
        productos,
        formaPago,
        mtoOperGravadas,
        mtoIGV,
        descuento,
        sistemaUrl,
        sistemaNombre,
      }),
    );

    const resend = new Resend(resendKey);
    const fromEmail =
      process.env.RESEND_FROM_EMAIL ||
      process.env.MAIL_FROM ||
      'facturacion@falconext.pe';
    const { error } = await resend.emails.send({
      from: `${empresaNombre} <${fromEmail}>`,
      to: destinatario,
      subject: `${tipoPretty} ${serie}-${correlativo} — ${monto}`,
      html,
      attachments: [
        {
          filename: `${tipoPretty.replace(/ /g, '_')}_${serie}-${correlativo}.pdf`,
          content: buffer,
          contentType: 'application/pdf',
        },
      ],
    });

    if (error) {
      throw new BadRequestException(`Error al enviar correo: ${error.message}`);
    }
  }
}
