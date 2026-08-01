import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ComprasService } from './compras.service';
import { PdfGeneratorService } from '../comprobante/pdf-generator.service';
import {
  ActualizarOrdenCompraDto,
  CrearOrdenCompraDto,
  RecibirOrdenCompraDto,
} from './dto/orden-compra.dto';

const IGV_RATE = 0.18;

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
  ) {}

  static formatNumero(numero: number): string {
    return `OC-${String(numero).padStart(6, '0')}`;
  }

  private calcularTotales(
    detalles: { cantidad: number; precioUnitario: number }[],
    aplicaIgv: boolean,
  ) {
    const subtotal = detalles.reduce(
      (s, d) => s + Number(d.cantidad) * Number(d.precioUnitario),
      0,
    );
    const igv = aplicaIgv ? subtotal * IGV_RATE : 0;
    return {
      subtotal: Number(subtotal.toFixed(2)),
      igv: Number(igv.toFixed(2)),
      total: Number((subtotal + igv).toFixed(2)),
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
    const totales = this.calcularTotales(dto.detalles, aplicaIgv);

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
        fechaEmision: dto.fechaEmision ? new Date(dto.fechaEmision) : new Date(),
        fechaEntrega: dto.fechaEntrega ? new Date(dto.fechaEntrega) : null,
        moneda: dto.moneda || 'PEN',
        tipoCambio: dto.tipoCambio ?? 1,
        ...totales,
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
            subtotal: Number(
              (Number(d.cantidad) * Number(d.precioUnitario)).toFixed(2),
            ),
          })),
        },
      },
      include: { detalles: true, proveedor: true },
    });
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
          _count: { select: { detalles: true } },
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
            producto: { select: { id: true, codigo: true, descripcion: true } },
          },
        },
        proveedor: true,
        usuario: { select: { nombre: true } },
        sede: { select: { nombre: true } },
        compra: { select: { id: true, serie: true, numero: true } },
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
    const totales = this.calcularTotales(dto.detalles, aplicaIgv);

    await this.prisma.detalleOrdenCompra.deleteMany({
      where: { ordenCompraId: id },
    });
    return this.prisma.ordenCompra.update({
      where: { id },
      data: {
        proveedorId: dto.proveedorId,
        sedeId: dto.sedeId ?? null,
        fechaEmision: dto.fechaEmision ? new Date(dto.fechaEmision) : undefined,
        fechaEntrega: dto.fechaEntrega ? new Date(dto.fechaEntrega) : null,
        moneda: dto.moneda || 'PEN',
        tipoCambio: dto.tipoCambio ?? 1,
        ...totales,
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
        tipoCambio: Number(orden.tipoCambio ?? 1),
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
          incluyeIgv: false,
        })),
      } as any,
      reqSedeId,
    );

    await this.prisma.ordenCompra.update({
      where: { id },
      data: { estado: 'RECIBIDA', compraId: (compra as any).id },
    });

    return { ordenId: id, compra };
  }

  /** PDF imprimible de la orden para enviar al proveedor. */
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

    const filas = orden.detalles
      .map(
        (d: any, i: number) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${esc(d.producto?.codigo ?? '')}</td>
          <td>${esc(d.descripcion)}</td>
          <td class="num">${Number(d.cantidad)}</td>
          <td class="num">${fmt(d.precioUnitario)}</td>
          <td class="num">${fmt(d.subtotal)}</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
      body { margin: 28px; color: #111827; font-size: 11.5px; }
      .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
      h1 { font-size: 15px; margin: 0; }
      .muted { color: #6b7280; }
      .doc { border: 2px solid #111827; border-radius: 10px; padding: 10px 18px; text-align: center; }
      .doc .t { font-size: 12px; font-weight: bold; letter-spacing: 1px; }
      .doc .n { font-size: 16px; font-weight: 900; margin-top: 2px; }
      .box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin-top: 14px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
      .lbl { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th { background: #111827; color: #fff; text-align: left; padding: 7px 9px; font-size: 10px; text-transform: uppercase; }
      td { padding: 6px 9px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
      .num { text-align: right; white-space: nowrap; }
      th.num { text-align: right; }
      .totales { margin-left: auto; width: 240px; margin-top: 10px; }
      .totales div { display: flex; justify-content: space-between; padding: 4px 0; }
      .totales .tt { border-top: 2px solid #111827; font-weight: 900; font-size: 14px; padding-top: 6px; }
      .obs { margin-top: 14px; }
    </style></head><body>
      <div class="top">
        <div>
          <h1>${esc(empresa?.nombreComercial || empresa?.razonSocial)}</h1>
          <div class="muted">RUC ${esc(empresa?.ruc)} · ${esc(empresa?.direccion ?? '')}</div>
        </div>
        <div class="doc">
          <div class="t">ORDEN DE COMPRA</div>
          <div class="n">${esc(orden.numeroFormato)}</div>
          <div class="muted">${fmtFecha(orden.fechaEmision)}</div>
        </div>
      </div>

      <div class="box">
        <div class="grid">
          <div><div class="lbl">Proveedor</div><strong>${esc(orden.proveedor?.nombre)}</strong></div>
          <div><div class="lbl">RUC / Doc.</div>${esc(orden.proveedor?.nroDoc ?? '—')}</div>
          <div><div class="lbl">Fecha de entrega</div>${fmtFecha(orden.fechaEntrega)}</div>
          <div><div class="lbl">Condiciones de pago</div>${esc(orden.condicionesPago ?? '—')}</div>
          <div><div class="lbl">Lugar de entrega</div>${esc(orden.lugarEntrega ?? orden.sede?.nombre ?? '—')}</div>
          <div><div class="lbl">Solicitado por</div>${esc(orden.usuario?.nombre ?? '—')}</div>
        </div>
      </div>

      <table>
        <thead><tr><th class="num">#</th><th>Código</th><th>Descripción</th><th class="num">Cant.</th><th class="num">P. Unit.</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>

      <div class="totales">
        <div><span class="muted">Subtotal</span><span>${fmt(orden.subtotal)}</span></div>
        <div><span class="muted">IGV (18%)</span><span>${fmt(orden.igv)}</span></div>
        <div class="tt"><span>TOTAL</span><span>${fmt(orden.total)}</span></div>
      </div>

      ${orden.observaciones ? `<div class="obs"><div class="lbl">Observaciones</div>${esc(orden.observaciones)}</div>` : ''}
    </body></html>`;

    const buffer = await this.pdfGenerator.generarPdfDesdeHtml(html);
    return { buffer, filename: `${orden.numeroFormato}.pdf` };
  }
}
