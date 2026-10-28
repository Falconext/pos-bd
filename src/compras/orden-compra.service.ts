import { NOTA_SIN_CONVERTIR } from '../comprobante/convertidos';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseFechaSoloDia } from '../common/utils/fecha';
import { ComprasService } from './compras.service';
import { PdfGeneratorService } from '../comprobante/pdf-generator.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import {
  avisoDeLlegada,
  pedidosQueEsperan,
  productosRecibidos,
  type PedidoListo,
  documentoDe,
} from './pedidos-por-entregar';
import {
  consolidarVentas,
  type ComponenteKit,
  type ProductoParaComprar,
} from './consolidar-ventas';
import {
  cantidadSugerida,
  etiquetaVariante,
  type FilaPedidoMarca,
} from './pedido-por-marca';
import {
  ActualizarOrdenCompraDto,
  CrearOrdenCompraDto,
  RecibirOrdenCompraDto,
} from './dto/orden-compra.dto';

const IGV_RATE = 0.18;

/** Notas informales que se pueden juntar en una orden (preventa). */
const TIPOS_PREVENTA = ['NV', 'NP', 'TICKET'];

/**
 * Órdenes de Compra: el pedido formal al proveedor ANTES de la compra.
 * Flujo: BORRADOR/EMITIDA → (PDF al proveedor) → al llegar la mercadería,
 * "recibir" crea la Compra real (stock + cuentas por pagar) y deja la orden
 * en RECIBIDA enlazada a esa compra.
 */
@Injectable()
export class OrdenCompraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comprasService: ComprasService,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  static formatNumero(numero: number): string {
    return `OC-${String(numero).padStart(6, '0')}`;
  }

  /**
   * Totales de la orden. El IGV solo va sobre las líneas de productos
   * gravados: los exonerados/inafectos (farmacia, agro…) suman tal cual, con
   * o sin "IGV incluido" (misma regla que ComprasService al recibirla).
   */
  private async calcularTotales(
    empresaId: number,
    detalles: { productoId?: number | null; cantidad: number; precioUnitario: number }[],
    aplicaIgv: boolean,
    igvIncluido = false,
  ) {
    const gravadoPorProducto = aplicaIgv
      ? await this.comprasService.afectacionGravadaPorProducto(empresaId, detalles)
      : new Map<number, boolean>();
    let subtotal = 0;
    let total = 0;
    for (const d of detalles) {
      const bruto = Number(d.cantidad) * Number(d.precioUnitario);
      const gravado =
        aplicaIgv && (gravadoPorProducto.get(Number(d.productoId)) ?? true);
      if (!gravado) {
        subtotal += bruto;
        total += bruto;
      } else if (igvIncluido) {
        // Los precios ya traen el IGV embebido: el total es la suma tal cual
        // y el IGV se extrae (misma lógica que incluyeIgv en Compras)
        subtotal += bruto / (1 + IGV_RATE);
        total += bruto;
      } else {
        subtotal += bruto;
        total += bruto * (1 + IGV_RATE);
      }
    }
    const subtotalR = Number(subtotal.toFixed(2));
    const totalR = Number(total.toFixed(2));
    return {
      subtotal: subtotalR,
      igv: Number((totalR - subtotalR).toFixed(2)),
      total: totalR,
    };
  }

  async crear(
    empresaId: number,
    usuarioId: number,
    dto: CrearOrdenCompraDto,
    reqSedeId?: number,
  ) {
    if (!dto.detalles?.length) {
      throw new BadRequestException('La orden debe tener al menos un ítem');
    }
    const proveedor = await this.prisma.cliente.findFirst({
      where: { id: dto.proveedorId, empresaId },
      select: { id: true },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');

    const aplicaIgv = dto.aplicaIgv !== false;
    const igvIncluido = aplicaIgv && dto.igvIncluido === true;
    const totales = await this.calcularTotales(
      empresaId,
      dto.detalles,
      aplicaIgv,
      igvIncluido,
    );

    const origenIds = await this.origenesValidos(empresaId, dto.comprobanteOrigenIds);

    const ultimo = await this.prisma.ordenCompra.aggregate({
      where: { empresaId },
      _max: { numero: true },
    });
    const numero = (ultimo._max.numero ?? 0) + 1;

    return this.prisma.ordenCompra.create({
      data: {
        empresaId,
        sedeId: dto.sedeId ?? reqSedeId ?? null,
        proveedorId: dto.proveedorId,
        usuarioId,
        numero,
        fechaEmision: dto.fechaEmision ? parseFechaSoloDia(dto.fechaEmision) : new Date(),
        fechaEntrega: dto.fechaEntrega ? parseFechaSoloDia(dto.fechaEntrega) : null,
        moneda: dto.moneda || 'PEN',
        tipoCambio: dto.tipoCambio ?? 1,
        ...totales,
        igvIncluido,
        estado: dto.estado ?? 'EMITIDA',
        observaciones: dto.observaciones || null,
        condicionesPago: dto.condicionesPago || null,
        lugarEntrega: dto.lugarEntrega || null,
        detalles: {
          create: dto.detalles.map((d) => ({
            productoId: d.productoId ?? null,
            descripcion: d.descripcion,
            cantidad: d.cantidad,
            precioUnitario: d.precioUnitario,
            // Tamaño de la caja pedida. Solo se guarda si de verdad es una caja:
            // un 1 guardado es ruido que después hay que distinguir de null.
            unidadesPorPaquete:
              Number(d.unidadesPorPaquete) > 1
                ? Math.trunc(Number(d.unidadesPorPaquete))
                : null,
            subtotal: Number(
              (Number(d.cantidad) * Number(d.precioUnitario)).toFixed(2),
            ),
          })),
        },
        ...(origenIds.length
          ? { origenes: { create: origenIds.map((comprobanteId) => ({ comprobanteId })) } }
          : {}),
      },
      include: { detalles: true, proveedor: true },
    });
  }

  /** Solo notas de la misma empresa: un id ajeno no se enlaza. */
  private async origenesValidos(empresaId: number, ids?: number[]): Promise<number[]> {
    const unicos = [...new Set((ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!unicos.length) return [];
    const propias = await this.prisma.comprobante.findMany({
      where: { id: { in: unicos }, empresaId },
      select: { id: true },
    });
    return propias.map((c) => c.id);
  }

  /**
   * Notas de venta → una orden de compra. Suma lo vendido en las notas
   * elegidas (kits abiertos en componentes, paquetes en unidades) y devuelve
   * las líneas para precargar la orden, con el costo y el stock de la sede.
   * No crea nada: la orden se guarda recién cuando el usuario elige el
   * proveedor y confirma.
   */
  /**
   * Todos los productos de una marca (cada variante en su fila) con stock de la
   * sede, mínimo, lo vendido en los últimos `dias` y una cantidad sugerida.
   * También propone el proveedor de la última orden con productos de la marca.
   * No guarda nada: el front arma la orden con lo que el usuario confirme.
   */
  async sugeridoPorMarca(empresaId: number, marcaId: number, dias = 30, sedeId?: number) {
    if (!Number.isInteger(marcaId) || marcaId <= 0) throw new BadRequestException('Elige una marca');
    const marca = await this.prisma.marca.findFirst({
      where: { id: marcaId, empresaId },
      select: { id: true, nombre: true },
    });
    if (!marca) throw new NotFoundException('Marca no encontrada');
    const periodo = Math.min(Math.max(Math.trunc(Number(dias) || 30), 1), 365);

    const seleccion = {
      id: true,
      descripcion: true,
      stock: true,
      stockMinimo: true,
      costoPromedio: true,
      tipoAfectacionIGV: true,
      valoresAtributos: true,
    } as const;
    const padres = await this.prisma.producto.findMany({
      where: { empresaId, marcaId, estado: 'ACTIVO', productoPadreId: null },
      select: {
        ...seleccion,
        variantes: { where: { estado: 'ACTIVO' }, select: seleccion, orderBy: { id: 'asc' } },
      },
      orderBy: { descripcion: 'asc' },
    });
    // Un modelo con variantes se pide por variante (cada tono), no el modelo.
    const productos = padres.flatMap((p) =>
      p.variantes.length
        ? p.variantes.map((v) => ({ ...v, descripcion: p.descripcion }))
        : [{ ...p, valoresAtributos: null }],
    );
    const ids = productos.map((p) => p.id);
    if (!ids.length) return { marca, dias: periodo, proveedorSugerido: null, items: [] };

    const stocksSede = sedeId
      ? await this.prisma.productoStock.findMany({
          where: { sedeId, productoId: { in: ids } },
          select: { productoId: true, stock: true, stockMinimo: true },
        })
      : [];
    const porSede = new Map(stocksSede.map((s) => [s.productoId, s]));

    // Lo vendido es lo que salió del almacén por un comprobante no anulado:
    // así una nota de venta convertida en boleta no se cuenta dos veces.
    const desde = new Date(Date.now() - periodo * 86400000);
    const salidas = await this.prisma.movimientoKardex.groupBy({
      by: ['productoId'],
      where: {
        empresaId,
        productoId: { in: ids },
        tipoMovimiento: 'SALIDA',
        comprobanteId: { not: null },
        comprobante: { estadoEnvioSunat: { not: 'ANULADO' } },
        fecha: { gte: desde },
        ...(sedeId ? { sedeId } : {}),
      },
      _sum: { cantidad: true },
    });
    const vendidos = new Map(salidas.map((s) => [s.productoId, Number(s._sum.cantidad ?? 0)]));

    const items: FilaPedidoMarca[] = productos.map((p) => {
      const sede = porSede.get(p.id);
      const stock = Number(sede ? sede.stock : p.stock) || 0;
      const stockMinimo = Number(sede?.stockMinimo || p.stockMinimo || 0);
      const vendido = vendidos.get(p.id) ?? 0;
      return {
        productoId: p.id,
        descripcion: p.descripcion,
        variante: etiquetaVariante(p.valoresAtributos),
        stock,
        stockMinimo,
        vendidos: vendido,
        costo: Number(p.costoPromedio ?? 0),
        tipoAfectacionIGV: p.tipoAfectacionIGV ?? null,
        sugerido: cantidadSugerida(stock, stockMinimo, vendido),
      };
    });

    const ultima = await this.prisma.ordenCompra.findFirst({
      where: {
        empresaId,
        estado: { not: 'ANULADA' },
        detalles: { some: { productoId: { in: ids } } },
      },
      orderBy: { id: 'desc' },
      select: { proveedor: { select: { id: true, nombre: true, nroDoc: true } } },
    });

    return { marca, dias: periodo, proveedorSugerido: ultima?.proveedor ?? null, items };
  }

  async desdeVentas(empresaId: number, comprobanteIds: number[], sedeId?: number) {
    const ventas = await this.prisma.comprobante.findMany({
      where: { id: { in: comprobanteIds }, empresaId },
      select: {
        id: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        estadoEnvioSunat: true,
        cliente: { select: { nombre: true } },
        detalles: {
          select: { productoId: true, descripcion: true, cantidad: true, unidadesPorPaquete: true, comboId: true, kitQuitados: true },
        },
        ordenesCompra: {
          where: { ordenCompra: { estado: { not: 'ANULADA' } } },
          select: { ordenCompra: { select: { id: true, numero: true } } },
        },
      },
      orderBy: { id: 'asc' },
    });
    if (!ventas.length) throw new NotFoundException('No se encontraron las notas elegidas');

    const usables = ventas.filter(
      (v) => TIPOS_PREVENTA.includes(v.tipoDoc) && v.estadoEnvioSunat !== 'ANULADO',
    );
    const descartadas = ventas
      .filter((v) => !usables.includes(v))
      .map((v) => ({
        documento: documentoDe(v),
        motivo: v.estadoEnvioSunat === 'ANULADO' ? 'Anulada' : 'No es nota de venta ni de pedido',
      }));
    if (!usables.length) {
      throw new BadRequestException('Ninguna de las notas elegidas se puede pedir (anuladas o de otro tipo)');
    }

    const comboIds = [...new Set(usables.flatMap((v) => v.detalles.map((d) => Number(d.comboId)).filter((n) => n > 0)))];
    const combos = comboIds.length
      ? await this.prisma.comboItem.findMany({
          where: { comboId: { in: comboIds } },
          select: { comboId: true, productoId: true, cantidad: true },
        })
      : [];
    const kits = new Map<number, ComponenteKit[]>();
    for (const c of combos) {
      kits.set(c.comboId, [...(kits.get(c.comboId) ?? []), { productoId: c.productoId, cantidad: c.cantidad }]);
    }

    const productoIds = [
      ...new Set([
        ...usables.flatMap((v) => v.detalles.map((d) => Number(d.productoId)).filter((n) => n > 0)),
        ...combos.map((c) => c.productoId),
      ]),
    ];
    const filas = productoIds.length
      ? await this.prisma.producto.findMany({
          where: { id: { in: productoIds }, empresaId },
          select: {
            id: true,
            codigo: true,
            descripcion: true,
            costoPromedio: true,
            tipoAfectacionIGV: true,
            stock: true,
            atributosTecnicos: true,
            // Las cajas del producto, para poder pedir "5 cajas de 6" en la orden.
            codigosBarras: {
              where: { unidadesPorPaquete: { gt: 1 } },
              select: { codigo: true, alias: true, unidadesPorPaquete: true },
            },
            ...(sedeId ? { stocks: { where: { sedeId }, select: { stock: true } } } : {}),
          },
        })
      : [];
    const productos = new Map<number, ProductoParaComprar>();
    for (const p of filas as any[]) {
      productos.set(p.id, {
        id: p.id,
        codigo: p.codigo,
        descripcion: p.descripcion,
        costo: Number(Number(p.costoPromedio ?? 0).toFixed(2)),
        gravado: this.comprasService.esAfectacionGravada(p.tipoAfectacionIGV),
        stock: Number(sedeId ? (p.stocks?.[0]?.stock ?? 0) : p.stock) || 0,
        seCompra: String(p.atributosTecnicos?.tipoProducto || '').toUpperCase() !== 'SERVICIO',
      });
    }
    const paquetes = new Map((filas as any[]).map((p) => [p.id, p.codigosBarras ?? []]));

    const { lineas, omitidas } = consolidarVentas(
      usables.map((v) => ({
        id: v.id,
        documento: documentoDe(v),
        cliente: v.cliente?.nombre ?? null,
        detalles: v.detalles,
      })),
      productos,
      kits,
    );

    return {
      comprobanteIds: usables.map((v) => v.id),
      notas: usables.map((v) => ({
        id: v.id,
        documento: documentoDe(v),
        cliente: v.cliente?.nombre ?? null,
        // Ya pedida en otra orden vigente: se avisa para no comprar dos veces.
        ordenes: v.ordenesCompra.map((o) => OrdenCompraService.formatNumero(o.ordenCompra.numero)),
      })),
      descartadas,
      omitidas,
      lineas: lineas.map((l) => ({ ...l, paquetes: l.productoId ? paquetes.get(l.productoId) ?? [] : [] })),
    };
  }

  async listar(
    empresaId: number,
    query: {
      search?: string;
      estado?: string;
      fechaInicio?: string;
      fechaFin?: string;
      page?: string | number;
      limit?: string | number;
    },
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const where: any = { empresaId };
    if (query.estado && query.estado !== 'TODOS') where.estado = query.estado;
    if (query.fechaInicio || query.fechaFin) {
      where.fechaEmision = {
        ...(query.fechaInicio
          ? { gte: new Date(`${query.fechaInicio}T00:00:00-05:00`) }
          : {}),
        ...(query.fechaFin
          ? { lte: new Date(`${query.fechaFin}T23:59:59-05:00`) }
          : {}),
      };
    }
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { proveedor: { nombre: { contains: s, mode: 'insensitive' } } },
        { proveedor: { nroDoc: { contains: s } } },
        ...(Number(s.replace(/^OC-?0*/i, ''))
          ? [{ numero: Number(s.replace(/^OC-?0*/i, '')) }]
          : []),
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.ordenCompra.findMany({
        where,
        orderBy: { numero: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          proveedor: { select: { nombre: true, nroDoc: true } },
          usuario: { select: { nombre: true } },
          sede: { select: { nombre: true } },
          compra: { select: { id: true, serie: true, numero: true } },
          _count: { select: { detalles: true, origenes: true } },
        },
      }),
      this.prisma.ordenCompra.count({ where }),
    ]);

    return {
      data: data.map((o) => ({
        ...o,
        numeroFormato: OrdenCompraService.formatNumero(o.numero),
      })),
      total,
    };
  }

  async obtener(empresaId: number, id: number) {
    const orden = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
      include: {
        detalles: {
          include: {
            producto: {
              select: {
                id: true,
                codigo: true,
                descripcion: true,
                tipoAfectacionIGV: true,
                // Las cajas configuradas del producto: al reabrir una orden
                // pedida por cajas, la pantalla tiene que poder volver a
                // ofrecer la misma presentación.
                codigosBarras: {
                  where: { unidadesPorPaquete: { gt: 1 } },
                  select: { codigo: true, alias: true, unidadesPorPaquete: true },
                },
              },
            },
          },
        },
        proveedor: true,
        usuario: { select: { nombre: true } },
        sede: { select: { nombre: true } },
        compra: { select: { id: true, serie: true, numero: true } },
        origenes: {
          select: { comprobante: { select: { id: true, serie: true, correlativo: true } } },
        },
      },
    });
    if (!orden) throw new NotFoundException('Orden de compra no encontrada');
    return {
      ...orden,
      numeroFormato: OrdenCompraService.formatNumero(orden.numero),
    };
  }

  async actualizar(
    empresaId: number,
    id: number,
    dto: ActualizarOrdenCompraDto,
  ) {
    const orden = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
      select: { id: true, estado: true },
    });
    if (!orden) throw new NotFoundException('Orden de compra no encontrada');
    if (orden.estado === 'RECIBIDA' || orden.estado === 'ANULADA') {
      throw new BadRequestException(
        `No se puede editar una orden ${orden.estado === 'RECIBIDA' ? 'ya recibida' : 'anulada'}`,
      );
    }
    if (!dto.detalles?.length) {
      throw new BadRequestException('La orden debe tener al menos un ítem');
    }
    const aplicaIgv = dto.aplicaIgv !== false;
    const igvIncluido = aplicaIgv && dto.igvIncluido === true;
    const totales = await this.calcularTotales(
      empresaId,
      dto.detalles,
      aplicaIgv,
      igvIncluido,
    );

    await this.prisma.detalleOrdenCompra.deleteMany({
      where: { ordenCompraId: id },
    });
    return this.prisma.ordenCompra.update({
      where: { id },
      data: {
        proveedorId: dto.proveedorId,
        sedeId: dto.sedeId ?? null,
        fechaEmision: dto.fechaEmision ? parseFechaSoloDia(dto.fechaEmision) : undefined,
        fechaEntrega: dto.fechaEntrega ? parseFechaSoloDia(dto.fechaEntrega) : null,
        moneda: dto.moneda || 'PEN',
        tipoCambio: dto.tipoCambio ?? 1,
        ...totales,
        igvIncluido,
        ...(dto.estado ? { estado: dto.estado } : {}),
        observaciones: dto.observaciones || null,
        condicionesPago: dto.condicionesPago || null,
        lugarEntrega: dto.lugarEntrega || null,
        detalles: {
          create: dto.detalles.map((d) => ({
            productoId: d.productoId ?? null,
            descripcion: d.descripcion,
            cantidad: d.cantidad,
            precioUnitario: d.precioUnitario,
            // Tamaño de la caja pedida. Solo se guarda si de verdad es una caja:
            // un 1 guardado es ruido que después hay que distinguir de null.
            unidadesPorPaquete:
              Number(d.unidadesPorPaquete) > 1
                ? Math.trunc(Number(d.unidadesPorPaquete))
                : null,
            subtotal: Number(
              (Number(d.cantidad) * Number(d.precioUnitario)).toFixed(2),
            ),
          })),
        },
      },
      include: { detalles: true, proveedor: true },
    });
  }

  async anular(empresaId: number, id: number) {
    const orden = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
      select: { id: true, estado: true },
    });
    if (!orden) throw new NotFoundException('Orden de compra no encontrada');
    if (orden.estado === 'RECIBIDA') {
      throw new BadRequestException(
        'No se puede anular una orden ya recibida (anula la compra asociada primero)',
      );
    }
    return this.prisma.ordenCompra.update({
      where: { id },
      data: { estado: 'ANULADA' },
    });
  }

  /**
   * Recibe la mercadería: crea la Compra real desde los ítems de la orden
   * (reutilizando TODO el flujo de compras: stock, kardex, cuentas por pagar,
   * pagos) y deja la orden RECIBIDA enlazada a la compra.
   */
  async recibir(
    empresaId: number,
    usuarioId: number,
    id: number,
    dto: RecibirOrdenCompraDto,
    reqSedeId?: number,
  ) {
    const orden = await this.prisma.ordenCompra.findFirst({
      where: { id, empresaId },
      include: { detalles: true },
    });
    if (!orden) throw new NotFoundException('Orden de compra no encontrada');
    if (orden.estado === 'RECIBIDA') {
      throw new BadRequestException('La orden ya fue recibida');
    }
    if (orden.estado === 'ANULADA') {
      throw new BadRequestException('La orden está anulada');
    }

    // ¿La orden se emitió sin IGV? No hay columna `aplicaIgv`: se deduce del
    // monto guardado, el mismo criterio que ya usa el PDF de la orden. Si el
    // proveedor no cobra IGV (RUS, exonerado) la compra tampoco debe sumarlo.
    const ordenSinIgv = Number(orden.igv ?? 0) <= 0;

    const compra = await this.comprasService.crear(
      empresaId,
      usuarioId,
      {
        proveedorId: orden.proveedorId,
        tipoDoc: dto.tipoDoc || 'FACTURA',
        serie: dto.serie,
        numero: dto.numero,
        fechaEmision: dto.fechaEmision,
        fechaVencimiento: dto.fechaVencimiento,
        moneda: orden.moneda,
        // El TC que manda es el de la factura al recibir; si no, el de la orden.
        tipoCambio:
          dto.tipoCambio != null
            ? Number(dto.tipoCambio)
            : Number(orden.tipoCambio ?? 1),
        observaciones: `Generada desde la orden de compra ${OrdenCompraService.formatNumero(orden.numero)}`,
        sedeId: dto.sedeId ?? orden.sedeId ?? undefined,
        formaPago: dto.formaPago,
        montoPagadoInicial: dto.montoPagadoInicial,
        metodoPagoInicial: dto.metodoPagoInicial,
        detalles: orden.detalles.map((d) => ({
          productoId: d.productoId ?? undefined,
          descripcion: d.descripcion,
          cantidad: Number(d.cantidad),
          precioUnitario: Number(d.precioUnitario),
          incluyeIgv: orden.igvIncluido,
          // Lo que se pactó en la orden manda sobre la afectación del producto.
          // Sin esto, una orden emitida SIN IGV se convertía en una compra que
          // sí lo sumaba: S/ 72 acordados entraban como S/ 84.96, y el saldo
          // por pagar al proveedor nacía mal.
          ...(ordenSinIgv ? { gravado: false } : {}),
        })),
      } as any,
      reqSedeId,
    );

    await this.prisma.ordenCompra.update({
      where: { id },
      data: { estado: 'RECIBIDA', compraId: (compra as any).id },
    });

    // Cierre del flujo: avisar qué pedidos quedaron listos para entregar.
    // Sin esto, la Nota de Pedido de hace tres semanas se queda esperando
    // hasta que el cliente llama a reclamar. No bloquea la recepción: si el
    // aviso falla, la mercadería igual entró.
    const pedidosListos = await this.pedidosListosTrasRecibir(
      empresaId,
      orden.detalles,
    );
    const aviso = avisoDeLlegada(
      id,
      OrdenCompraService.formatNumero(orden.numero),
      pedidosListos,
    );
    if (aviso) {
      try {
        await this.notificaciones.notificarAdminsEmpresa({
          empresaId,
          tipo: 'INFO',
          titulo: aviso.titulo,
          mensaje: aviso.mensaje,
          metaData: aviso.metaData,
        });
      } catch (error) {
        console.warn('[orden-compra] No se pudo avisar los pedidos listos:', (error as any)?.message);
      }
    }

    return { ordenId: id, compra, pedidosListos };
  }


  /**
   * Notas de Pedido sin entregar que incluyen algo de lo que acaba de llegar.
   *
   * Mismo criterio que el "comprometido" del inventario: se excluyen las
   * anuladas, las ya convertidas a comprobante formal y las que se emitieron
   * descontando stock (esas ya salieron del almacén).
   */
  private async pedidosListosTrasRecibir(
    empresaId: number,
    lineas: { productoId: number | null }[],
  ): Promise<PedidoListo[]> {
    const productoIds = productosRecibidos(lineas as any);
    if (productoIds.length === 0) return [];
    const pedidos = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        tipoDoc: 'NP',
        estadoEnvioSunat: { not: 'ANULADO' as any },
        ...NOTA_SIN_CONVERTIR,
        movimientosKardex: { none: { tipoMovimiento: 'SALIDA' as any } },
        detalles: { some: { productoId: { in: productoIds } } },
      },
      select: {
        id: true,
        serie: true,
        correlativo: true,
        cliente: { select: { nombre: true } },
        detalles: {
          select: { productoId: true, descripcion: true, cantidad: true },
        },
      },
      orderBy: { id: 'asc' },
    });
    return pedidosQueEsperan(
      lineas as any,
      pedidos.map((p: any) => ({
        id: p.id,
        serie: p.serie,
        correlativo: p.correlativo,
        cliente: p.cliente?.nombre ?? null,
        detalles: p.detalles,
      })),
    );
  }

  /** PDF imprimible de la orden para enviar al proveedor (formato A4 con logo). */
  async pdf(
    empresaId: number,
    id: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const orden = await this.obtener(empresaId, id);
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        razonSocial: true,
        nombreComercial: true,
        ruc: true,
        direccion: true,
        logo: true,
      },
    });

    const esc = (v: any) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const fmtFecha = (d?: Date | string | null) =>
      d
        ? new Date(d).toLocaleDateString('es-PE', {
            timeZone: 'America/Lima',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })
        : '—';
    const mon = orden.moneda === 'USD' ? 'US$' : 'S/';
    const fmt = (n: any) => `${mon} ${Number(n ?? 0).toFixed(2)}`;
    const prov: any = orden.proveedor ?? {};
    const logo = String(empresa?.logo || '').trim();

    // Total con IGV por línea (misma regla que el modal y que calcularTotales):
    // exonerados/inafectos y "IGV incluido" van tal cual; los gravados suman 18%.
    const aplicaIgvPdf = Number(orden.igv ?? 0) > 0;
    const igvInclPdf = Boolean(orden.igvIncluido);
    const esGravadoPdf = (taf: any) => {
      const n = Number(String(taf ?? '10').trim() || '10');
      return n >= 10 && n <= 17;
    };
    const totalConIgvLinea = (d: any) => {
      const bruto = Number(d.subtotal ?? Number(d.cantidad) * Number(d.precioUnitario));
      if (!aplicaIgvPdf) return bruto;
      const grav = d.producto ? esGravadoPdf(d.producto.tipoAfectacionIGV) : true;
      if (!grav || igvInclPdf) return bruto;
      return bruto * (1 + IGV_RATE);
    };
    // La columna extra solo tiene sentido con precios SIN IGV; con "IGV incluido"
    // el monto de la línea ya es con IGV y duplicaría la columna Subtotal.
    const mostrarColIgv = aplicaIgvPdf && !igvInclPdf;
    // Filas reales + relleno hasta un mínimo para que la tabla ocupe la hoja
    const MIN_FILAS = 14;
    // Si la línea se pidió por cajas, al proveedor se le muestra en CAJAS: es
    // lo que él despacha y lo que las dos partes acordaron. Antes el PDF decía
    // "12 unidades a S/ 6.00" donde el pedido era "2 cajas a S/ 36", que es la
    // misma plata pero no es lo que nadie habló.
    const filaEnCajas = (d: any) => {
      const u = Number(d.unidadesPorPaquete) || 1;
      if (u <= 1) {
        return {
          cantidad: String(Number(d.cantidad)),
          precio: fmt(d.precioUnitario),
          detalle: '',
        };
      }
      const cajas = Number(d.cantidad) / u;
      return {
        cantidad: `${Number(cajas.toFixed(3))} caja(s)`,
        precio: fmt(Number(d.precioUnitario) * u),
        detalle: `<br><span class="sub">× ${u} unidades = ${Number(d.cantidad)} unidades · ${fmt(d.precioUnitario)} c/u</span>`,
      };
    };
    const filasReales = orden.detalles.map((d: any, i: number) => {
      const c = filaEnCajas(d);
      return `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${esc(d.producto?.codigo ?? '')}</td>
          <td>${esc(d.descripcion)}${c.detalle}</td>
          <td class="num">${c.cantidad}</td>
          <td class="num">${c.precio}</td>
          <td class="num">${fmt(d.subtotal)}</td>
          ${mostrarColIgv ? `<td class="num">${fmt(totalConIgvLinea(d))}</td>` : ''}
        </tr>`;
    });
    const filasVacias = Array.from(
      { length: Math.max(0, MIN_FILAS - filasReales.length) },
      (_, i) => `
        <tr class="empty">
          <td class="num">${filasReales.length + i + 1}</td>
          <td></td><td></td><td></td><td></td><td></td>${mostrarColIgv ? '<td></td>' : ''}
        </tr>`,
    );
    const filas = [...filasReales, ...filasVacias].join('');

    const contacto = (tel?: string | null, mail?: string | null) =>
      [tel ? `Tel: ${esc(tel)}` : '', mail ? esc(mail) : '']
        .filter(Boolean)
        .join(' · ');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
      body { margin: 26px 30px; color: #111827; font-size: 11px; }
      .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
      h1 { font-size: 30px; font-weight: 900; letter-spacing: -0.5px; margin: 0 0 10px; color: #1f2937; }
      .metaline { display: flex; gap: 28px; font-size: 12px; }
      .metaline .lbl { font-weight: 800; }
      .brand { text-align: right; max-width: 260px; }
      .brand img { max-height: 64px; max-width: 200px; object-fit: contain; margin-bottom: 6px; }
      .brand .n { font-weight: 900; font-size: 12.5px; }
      .brand .d { color: #4b5563; font-size: 10.5px; line-height: 1.45; }
      .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #d1d5db; margin-top: 18px; }
      .col { padding: 0; }
      .col + .col { border-left: 1px solid #d1d5db; }
      .colhead { background: #2f3b52; color: #fff; font-weight: 800; font-size: 11px; letter-spacing: .8px; padding: 7px 12px; text-transform: uppercase; }
      .colbody { padding: 10px 12px 12px; line-height: 1.7; }
      .colbody .name { font-weight: 800; font-size: 12px; }
      .colbody .muted { color: #4b5563; }
      .secthead { background: #2f3b52; color: #fff; font-weight: 800; font-size: 11px; letter-spacing: .8px; padding: 7px 12px; text-transform: uppercase; margin-top: 18px; border: 1px solid #2f3b52; border-bottom: none; }
      table { width: 100%; border-collapse: collapse; }
      thead th { background: #e6e9ef; color: #1f2937; text-align: left; padding: 7px 9px; font-size: 10px; text-transform: uppercase; border: 1px solid #d1d5db; }
      td { padding: 6px 9px; border: 1px solid #d1d5db; vertical-align: top; }
      tr.empty td { height: 22px; }
      .num { text-align: right; white-space: nowrap; }
      /* Equivalencia en unidades debajo del producto, para que el proveedor
         vea las cajas y el almacén sepa cuántas unidades entran. */
      .sub { font-size: 9px; color: #6b7280; }
      thead th.num { text-align: right; }
      .tot td { border: 1px solid #d1d5db; font-weight: 800; }
      .tot .lblcell { text-align: right; text-transform: uppercase; font-size: 10.5px; }
      .tot.final td { background: #e6e9ef; font-size: 12.5px; font-weight: 900; }
      .comments { border: 1px solid #d1d5db; border-top: none; min-height: 84px; padding: 10px 12px; line-height: 1.6; color: #374151; }
      .foot { margin-top: 16px; display: flex; justify-content: flex-end; align-items: center; gap: 8px; color: #9ca3af; font-size: 10px; }
      .foot img { max-height: 26px; opacity: .85; }
    </style></head><body>
      <div class="top">
        <div>
          <h1>Orden de compra / Servicio</h1>
          <div class="metaline">
            <div><span class="lbl">N.º:</span> ${esc(orden.numeroFormato)}</div>
            <div><span class="lbl">Fecha:</span> ${fmtFecha(orden.fechaEmision)}</div>
          </div>
        </div>
        <div class="brand">
          ${logo ? `<img src="${logo}" alt="logo" />` : ''}
          <div class="n">${esc(empresa?.nombreComercial || empresa?.razonSocial)}</div>
          <div class="d">RUC ${esc(empresa?.ruc)}${empresa?.direccion ? `<br/>${esc(empresa.direccion)}` : ''}</div>
        </div>
      </div>

      <div class="cols">
        <div class="col">
          <div class="colhead">Vendedor (Proveedor)</div>
          <div class="colbody">
            <div class="name">${esc(prov.nombre)}</div>
            <div class="muted">${prov.nroDoc ? `RUC/Doc: ${esc(prov.nroDoc)}` : ''}</div>
            ${prov.direccion ? `<div class="muted">${esc(prov.direccion)}</div>` : ''}
            ${contacto(prov.telefono, prov.email) ? `<div class="muted">${contacto(prov.telefono, prov.email)}</div>` : ''}
          </div>
        </div>
        <div class="col">
          <div class="colhead">Comprador</div>
          <div class="colbody">
            <div class="name">${esc(empresa?.razonSocial)}</div>
            <div class="muted">RUC: ${esc(empresa?.ruc)}</div>
            <div class="muted">Entrega: ${fmtFecha(orden.fechaEntrega)}${orden.lugarEntrega || orden.sede?.nombre ? ` · ${esc(orden.lugarEntrega ?? orden.sede?.nombre)}` : ''}</div>
            <div class="muted">Cond. de pago: ${esc(orden.condicionesPago ?? '—')} · Solicita: ${esc(orden.usuario?.nombre ?? '—')}</div>
          </div>
        </div>
      </div>

      <div class="secthead">Producto o servicio</div>
      <table>
        <thead><tr><th class="num" style="width:34px">N.º</th><th style="width:80px">Código</th><th>Descripción</th><th class="num" style="width:70px">Cant.</th><th class="num" style="width:90px">P. Unitario${orden.igvIncluido ? ' (con IGV)' : ''}</th>${mostrarColIgv ? '<th class="num" style="width:90px">Subtotal</th><th class="num" style="width:95px">Total c/IGV</th>' : '<th class="num" style="width:95px">Total</th>'}</tr></thead>
        <tbody>${filas}
          <tr class="tot"><td colspan="${mostrarColIgv ? 5 : 4}" style="border:none"></td><td class="lblcell">Subtotal</td><td class="num">${fmt(orden.subtotal)}</td></tr>
          <tr class="tot"><td colspan="${mostrarColIgv ? 5 : 4}" style="border:none"></td><td class="lblcell">IGV (18%)</td><td class="num">${fmt(orden.igv)}</td></tr>
          <tr class="tot final"><td colspan="${mostrarColIgv ? 5 : 4}" style="border:none"></td><td class="lblcell">Total</td><td class="num">${fmt(orden.total)}</td></tr>
        </tbody>
      </table>

      <div class="secthead">Comentarios o instrucciones especiales</div>
      <div class="comments">${esc(orden.observaciones ?? '')}</div>

      <div class="foot">
        ${logo ? `<img src="${logo}" alt="logo" />` : `<span>${esc(empresa?.nombreComercial || empresa?.razonSocial)}</span>`}
      </div>
    </body></html>`;

    const buffer = await this.pdfGenerator.generarPdfDesdeHtml(html);
    return { buffer, filename: `${orden.numeroFormato}.pdf` };
  }
}
