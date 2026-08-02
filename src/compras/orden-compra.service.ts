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

    // Filas reales + relleno hasta un mínimo para que la tabla ocupe la hoja
    const MIN_FILAS = 14;
    const filasReales = orden.detalles.map(
      (d: any, i: number) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${esc(d.producto?.codigo ?? '')}</td>
          <td>${esc(d.descripcion)}</td>
          <td class="num">${Number(d.cantidad)}</td>
          <td class="num">${fmt(d.precioUnitario)}</td>
          <td class="num">${fmt(d.subtotal)}</td>
        </tr>`,
    );
    const filasVacias = Array.from(
      { length: Math.max(0, MIN_FILAS - filasReales.length) },
      (_, i) => `
        <tr class="empty">
          <td class="num">${filasReales.length + i + 1}</td>
          <td></td><td></td><td></td><td></td><td></td>
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
          <h1>Orden de compra</h1>
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
        <thead><tr><th class="num" style="width:34px">N.º</th><th style="width:80px">Código</th><th>Descripción</th><th class="num" style="width:70px">Cant.</th><th class="num" style="width:95px">P. Unitario</th><th class="num" style="width:95px">Total</th></tr></thead>
        <tbody>${filas}
          <tr class="tot"><td colspan="4" style="border:none"></td><td class="lblcell">Subtotal</td><td class="num">${fmt(orden.subtotal)}</td></tr>
          <tr class="tot"><td colspan="4" style="border:none"></td><td class="lblcell">IGV (18%)</td><td class="num">${fmt(orden.igv)}</td></tr>
          <tr class="tot final"><td colspan="4" style="border:none"></td><td class="lblcell">Total</td><td class="num">${fmt(orden.total)}</td></tr>
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
