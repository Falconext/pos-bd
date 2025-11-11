import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Prisma, EstadoSunat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KardexService } from '../kardex/kardex.service';
import { InventarioNotificacionesService } from '../notificaciones/inventario-notificaciones.service';

@Injectable()
export class ComprobanteService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => KardexService))
    private readonly kardexService: KardexService,
    private readonly inventarioNotificaciones: InventarioNotificacionesService,
  ) {}

  async listarTipoOperacion() {
    return this.prisma.tipoOperacion.findMany({ orderBy: { codigo: 'asc' } });
  }

  async listar(params: {
    empresaId: number;
    tipoComprobante: 'FORMAL' | 'INFORMAL';
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
      tipoComprobante,
      search,
      page = 1,
      limit = 10,
      sort = 'fechaEmision',
      order = 'desc',
      fechaInicio,
      fechaFin,
      estado,
      tipoDoc,
      estadoPago,
    } = params;
    const skip = (page - 1) * limit;

    const tiposFormales = ['01', '03', '07', '08'];
    const tiposInformales = ['TICKET', 'NV', 'RH', 'CP', 'NP', 'OT'];
    const tiposPermitidos =
      tipoComprobante === 'FORMAL' ? tiposFormales : tiposInformales;

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

    const where: any = {
      empresaId,
      tipoDoc: { in: tipoDoc ? [tipoDoc] : tiposPermitidos },
      ...(search
        ? {
            OR: [
              { serie: { contains: search, mode: 'insensitive' } },
              ...(Number.isNaN(+search)
                ? []
                : [{ correlativo: parseInt(search, 10) }]),
              {
                cliente: { nroDoc: { contains: search, mode: 'insensitive' } },
              },
              {
                cliente: { nombre: { contains: search, mode: 'insensitive' } },
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
      ...(tipoComprobante === 'FORMAL' && estado
        ? { estadoEnvioSunat: estado }
        : {}),
      ...(tipoComprobante === 'INFORMAL' && estadoPago
        ? { estadoPago: estadoPago as any }
        : {}),
    };

    const [rawItems, totalDb] = await Promise.all([
      this.prisma.comprobante.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort]: order } as any,
        include: {
          cliente: {
            select: { id: true, nombre: true, nroDoc: true, persona: true },
          },
          detalles: {
            select: {
              producto: { select: { id: true, descripcion: true } },
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
        },
      }),
      this.prisma.comprobante.count({ where }),
    ]);

    const tipoLabels: Record<string, string> = {
      '01': 'FACTURA',
      '03': 'BOLETA',
      '07': 'NOTA DE CREDITO',
      '08': 'NOTA DE DEBITO',
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
  }

  async siguienteCorrelativo(
    empresaId: number,
    tipoDoc: string,
    tipDocAfectado?: string,
  ) {
    const tiposValidos = [
      '01',
      '03',
      '07',
      '08',
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
    return { serie, correlativo };
  }

  async detalle(empresaId: number, serie: string, correlativo: number) {
    const comp = await this.prisma.comprobante.findFirst({
      where: { empresaId, serie, correlativo },
      include: { cliente: true, detalles: { include: { producto: true } } },
    });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');
    return comp;
  }

  async obtenerPorId(empresaId: number, id: number) {
    const comp = await this.prisma.comprobante.findFirst({
      where: { empresaId, id },
      include: { cliente: true, detalles: { include: { producto: true } } },
    });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');
    return comp;
  }

  async anularComprobante(comprobanteId: number) {
    const comp = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      include: { detalles: true },
    });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');
    const isInformal = ['TICKET', 'NV', 'RH', 'CP', 'NP', 'OT'].includes(
      comp.tipoDoc,
    );
    const isFormal = ['01', '03', '08'].includes(comp.tipoDoc);

    // Revertir stock para todos los tipos de comprobantes que afectan inventario
    // (tanto formales como informales, excluyendo notas de crédito que ya manejan su propio stock)
    if ((isInformal || isFormal) && comp.detalles && comp.tipoDoc !== '07') {
      await this.revertirStock(comp.detalles, {
        empresaId: comp.empresaId,
        comprobanteId: comp.id,
        concepto: `Anulación ${comp.tipoDoc} ${comp.serie}-${comp.correlativo}`,
      });
    }

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

  private async obtenerSerieYCorrelativo(
    tipoDoc: string,
    tipDocAfectado: string | null,
    empresaId: number,
  ) {
    let serie: string;
    switch (tipoDoc) {
      case '01':
        serie = 'F0A1';
        break;
      case '03':
        serie = 'B0A1';
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
      default:
        throw new BadRequestException('Tipo de documento no reconocido');
    }
    const ultimo = await this.prisma.comprobante.findFirst({
      where: { empresaId, tipoDoc, serie },
      orderBy: { correlativo: 'desc' },
    });
    const correlativo = ultimo ? Number(ultimo.correlativo) + 1 : 1;
    return { serie, correlativo };
  }

  private async cargarProductosYDetalles(detalles: any[], empresaId: number) {
    // Normalizar IDs a números
    const productIds = detalles.map((d) => {
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
        estado: 'ACTIVO' as any,
      },
      include: { unidadMedida: true },
    });

    if (productos.length !== detalles.length) {
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

      const detalleError =
        productosInactivos.length > 0
          ? `Productos encontrados pero inactivos o con otros problemas: ${productosInactivos.map((p) => `ID ${p.id} (${p.descripcion}) - Estado: ${p.estado}, EmpresaId: ${p.empresaId}`).join('; ')}`
          : `Productos no encontrados: IDs ${productosFaltantes.join(', ')}`;

      throw new BadRequestException(detalleError);
    }
    let mtoOperGravadas = 0;
    let totalIGV = 0;
    const detalleFinal = detalles.map((item: any) => {
      const prod = productos.find((p) => p.id === item.productoId)!;
      const cantidad = item.cantidad;
      const descripcion = item.descripcion ?? (prod as any).descripcion;
      const descuentoPct = parseFloat(item.descuento ?? 0) || 0;
      const precioConIgv =
        item.nuevoValorUnitario != null
          ? item.nuevoValorUnitario
          : Number((prod as any).precioUnitario);
      const igvPct = Number((prod as any).igvPorcentaje);
      const valorUnitario = precioConIgv / (1 + igvPct / 100);
      const mtoValorVenta = valorUnitario * cantidad;
      const igvMonto = precioConIgv * cantidad - mtoValorVenta;
      const montoDescuento = precioConIgv * cantidad * (descuentoPct / 100);
      const mtoTotalVenta = precioConIgv * cantidad - montoDescuento;
      mtoOperGravadas += mtoValorVenta;
      totalIGV += igvMonto;
      return {
        productoId: (prod as any).id,
        unidad: (prod as any).unidadMedida.codigo,
        descripcion,
        cantidad,
        mtoPrecioUnitario: this.round2(precioConIgv),
        mtoValorUnitario: this.round2(valorUnitario),
        mtoValorVenta: this.round2(mtoValorVenta),
        mtoBaseIgv: this.round2(mtoValorVenta),
        porcentajeIgv: igvPct,
        igv: this.round2(igvMonto),
        tipAfeIgv: 10,
        totalImpuestos: this.round2(igvMonto),
      };
    });
    return {
      productos,
      detalleFinal,
      mtoOperGravadas: this.round2(mtoOperGravadas),
      totalIGV: this.round2(totalIGV),
    };
  }

  private async ajustarStock(detalles: any[], data?: {
    empresaId: number;
    comprobanteId: number;
    concepto: string;
    usuarioId?: number;
  }) {
    for (const item of detalles) {
      const producto = await this.prisma.producto.findUnique({
        where: { id: item.productoId },
        select: { stock: true, costoPromedio: true },
      });
      if (!producto) continue;

      // Registrar movimiento de kardex si se proporcionan los datos
      if (data && this.kardexService) {
        try {
          // Usar el costo promedio del producto en lugar del precio de venta
          const costoUnitario = Number(producto.costoPromedio) || 0;
          
          await this.kardexService.registrarMovimiento({
            productoId: item.productoId,
            empresaId: data.empresaId,
            tipoMovimiento: 'SALIDA',
            concepto: data.concepto,
            cantidad: item.cantidad,
            comprobanteId: data.comprobanteId,
            costoUnitario: costoUnitario,
            usuarioId: data.usuarioId,
          });

          // Notificar inmediatamente si el producto quedó en 0 o bajo mínimo
          await this.inventarioNotificaciones.verificarProductoDespuesVenta(
            item.productoId,
            data.empresaId,
          );
        } catch (error) {
          // Log el error pero no fallar la operación principal
          console.error('Error al registrar movimiento de kardex:', error);
        }
      }
    }
  }

  private async revertirStock(detalles: any[], data?: {
    empresaId: number;
    comprobanteId: number;
    concepto: string;
    usuarioId?: number;
  }) {
    for (const item of detalles) {
      if (item.productoId) {
        const producto = await this.prisma.producto.findUnique({
          where: { id: item.productoId },
          select: { stock: true, costoPromedio: true },
        });
        if (producto) {
          // Registrar movimiento de kardex si se proporcionan los datos
          if (data && this.kardexService) {
            try {
              // Usar el costo promedio del producto
              const costoUnitario = Number(producto.costoPromedio) || 0;
              
              await this.kardexService.registrarMovimiento({
                productoId: item.productoId,
                empresaId: data.empresaId,
                tipoMovimiento: 'INGRESO',
                concepto: data.concepto,
                cantidad: item.cantidad,
                comprobanteId: data.comprobanteId,
                costoUnitario: costoUnitario,
                usuarioId: data.usuarioId,
              });
            } catch (error) {
              console.error('Error al registrar movimiento de kardex:', error);
            }
          }
        }
      }
    }
  }

  async crearFormal(
    input: any,
    empresaId: number,
    formalTipo: '01' | '03' | '07' | '08',
    usuarioId?: number,
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

    // Si es nota de crédito, usar lógica especializada
    if (formalTipo === '07') {
      return this.crearNotaCredito(input, empresaId);
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

    const { detalleFinal, mtoOperGravadas, totalIGV } =
      await this.cargarProductosYDetalles(detalles, empresaId);

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

    const { serie, correlativo } = await this.obtenerSerieYCorrelativo(
      formalTipo,
      tipDocAfectado ?? null,
      empresaId,
    );
    const subTotal = this.round2(mtoOperGravadas + totalIGV);
    const mtoImpVenta = subTotal;

    const fecha = new Date(fechaEmision);
    const dataBase: any = {
      tipoOperacionId: tipoOperacionIdFinal ?? undefined,
      tipoDoc: formalTipo,
      serie,
      correlativo,
      fechaEmision: fecha,
      formaPagoTipo,
      formaPagoMoneda,
      tipoMoneda,
      observaciones: observaciones ?? null,
      clienteId: finalClienteId,
      empresaId,
      usuarioId: usuarioId ?? undefined,
      mtoOperGravadas,
      medioPago,
      mtoIGV: totalIGV,
      valorVenta: mtoOperGravadas,
      totalImpuestos: totalIGV,
      subTotal,
      mtoImpVenta,
      estadoEnvioSunat: 'PENDIENTE' as string,
      ...(formalTipo === '08'
        ? {
            tipDocAfectado: tipDocAfectado ?? null,
            numDocAfectado: numDocAfectado ?? null,
            motivoId: motivoId ?? null,
          }
        : {}),
      detalles: { create: detalleFinal },
      leyendas: { create: [{ code: '1000', value: leyenda }] },
    };

    const comprobante = await this.prisma.comprobante.create({
      data: dataBase,
    });
    
    // Registrar movimientos de kardex
    await this.ajustarStock(detalles, {
      empresaId,
      comprobanteId: comprobante.id,
      concepto: `Venta ${formalTipo === '01' ? 'Factura' : formalTipo === '03' ? 'Boleta' : 'Nota de Débito'} ${comprobante.serie}-${comprobante.correlativo}`,
    });
    
    return comprobante;
  }

  async crearNotaCredito(input: any, empresaId: number) {
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
    console.log("QUE ES ESTO DEL MOTIVO",motivoNota)
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
    const afectado = await this.prisma.comprobante.findFirst({
      where: {
        empresaId,
        tipoDoc: tipDocAfectado,
        serie: serieAF,
        correlativo: Number(corrAF),
      },
      include: { detalles: true },
    });

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
        const igvPct = orig.porcentajeIgv;
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
        tipDocAfectado,
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

    return nota;
  }

  async crearInformal(input: any, empresaId: number, usuarioId?: number) {
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
    const { detalleFinal, mtoOperGravadas, totalIGV } =
      await this.cargarProductosYDetalles(detalles, empresaId);
    const { serie, correlativo } = await this.obtenerSerieYCorrelativo(
      tipoDoc,
      null,
      empresaId,
    );
    const subTotal = this.round2(mtoOperGravadas + totalIGV);
    const mtoImpVenta = subTotal;
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
    ];
    const medioPagoValido = mediosPermitidos.includes(medioPagoFinal)
      ? medioPagoFinal
      : 'EFECTIVO';

    // Determinar estado y saldo según tipo de comprobante y medio de pago
    // PRIORIDAD:
    // 1. NP (Nota de Pedido) con adelanto → PAGO_PARCIAL (saldo = total - adelanto)
    // 2. OT (Orden de Trabajo) con adelanto → PAGO_PARCIAL (saldo = total - adelanto)
    // 3. Otros: según medio de pago (contado=COMPLETADO, crédito=PENDIENTE_PAGO)
    const pagosAlContado = ['EFECTIVO', 'YAPE', 'PLIN'];
    let estadoPagoInicial = 'COMPLETADO' as any;
    let saldoInicial = 0;

    // PRIORIDAD 1: NP con adelanto → siempre PAGO_PARCIAL
    if (
      tipoDoc === 'NP' &&
      adelanto !== undefined &&
      adelanto !== null &&
      Number(adelanto) > 0
    ) {
      const adelantoNormalizado = Number(adelanto);
      saldoInicial = Math.max(
        0,
        this.round2(mtoImpVenta - adelantoNormalizado),
      );
      estadoPagoInicial =
        saldoInicial > 0 ? ('PAGO_PARCIAL' as any) : ('COMPLETADO' as any);
    }
    // PRIORIDAD 2: OT (Orden de Trabajo) con adelanto → siempre PAGO_PARCIAL
    else if (tipoDoc === 'OT' && adelanto && Number(adelanto) > 0) {
      const adelantoNormalizado = Number(adelanto);
      saldoInicial = Math.max(
        0,
        this.round2(mtoImpVenta - adelantoNormalizado),
      );
      estadoPagoInicial =
        saldoInicial > 0 ? ('PAGO_PARCIAL' as any) : ('COMPLETADO' as any);
    }
    // PRIORIDAD 3: Otros tipos - basados en medio de pago
    else if (pagosAlContado.includes(medioPagoValido)) {
      // Pagos al contado (EFECTIVO, YAPE, PLIN) → COMPLETADO
      estadoPagoInicial = 'COMPLETADO' as any;
      saldoInicial = 0;
    } else {
      // Pagos a crédito (TRANSFERENCIA, TARJETA) → PENDIENTE_PAGO
      estadoPagoInicial = 'PENDIENTE_PAGO' as any;
      saldoInicial = mtoImpVenta;
    }

    const dataBase: any = {
      tipoOperacionId: tipoOperacionIdFinal ?? undefined,
      tipoDoc,
      serie,
      correlativo,
      fechaEmision: fecha,
      formaPagoTipo,
      formaPagoMoneda,
      tipoMoneda,
      observaciones: observaciones ?? null,
      clienteId: finalClienteId,
      empresaId,
      usuarioId: usuarioId ?? undefined,
      mtoOperGravadas,
      medioPago: medioPagoValido,
      mtoIGV: totalIGV,
      valorVenta: mtoOperGravadas,
      totalImpuestos: totalIGV,
      subTotal,
      mtoImpVenta,
      estadoEnvioSunat: 'NO_APLICA' as string,
      estadoPago: estadoPagoInicial,
      saldo: saldoInicial,
      adelanto: tipoDoc === 'NP' && adelanto ? Number(adelanto) : undefined,
      fechaRecojo:
        tipoDoc === 'NP' && fechaRecojo ? new Date(fechaRecojo) : undefined,
      detalles: { create: detalleFinal },
      leyendas: { create: [{ code: '1000', value: leyenda }] },
    };
    const comp = await this.prisma.comprobante.create({ data: dataBase });

    // Crear registro de pago automáticamente si hay adelanto
    if (
      (tipoDoc === 'NP' || tipoDoc === 'OT') &&
      adelanto &&
      Number(adelanto) > 0
    ) {
      const adelantoNormalizado = Number(adelanto);
      await this.prisma.pago.create({
        data: {
          comprobanteId: comp.id,
          empresaId,
          monto: adelantoNormalizado,
          medioPago: medioPagoValido,
          observacion: 'Pago adelantado registrado automáticamente',
          referencia: `${tipoDoc}-${serie}-${correlativo}`,
        },
      });
    }

    // Registrar movimientos de kardex
    await this.ajustarStock(detalles, {
      empresaId,
      comprobanteId: comp.id,
      concepto: `Venta ${tipoDoc} ${comp.serie}-${comp.correlativo}`,
    });
    
    return comp;
  }

  async crearOT(input: any, empresaId: number, usuarioId?: number) {
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
}
