import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ComprobanteService } from './comprobante.service';
import { EnviarSunatService } from './enviar-sunat.service';

/**
 * Regularizar boletas y facturas emitidas con la afectación de IGV equivocada.
 *
 * FRUTA PURA (Ley de Amazonía, 30-10): el POS web convertía notas de venta
 * exoneradas en boletas y facturas gravadas (`tipoAfectacionIGV` '10' fijo).
 * 46 comprobantes llegaron a SUNAT con IGV que la empresa no debía. Ya
 * emitidos no se editan: se anulan con nota de crédito (motivo 01) y se
 * vuelven a emitir con la afectación de la nota de venta.
 *
 * La reemisión es una conversión de la MISMA nota: así el sistema no vuelve
 * a descontar stock (lo descontó la nota) ni a cobrar (la plata entró con la
 * nota). Si el cobro estaba en el comprobante anulado, la nota de crédito lo
 * borra; se copia tal cual al nuevo, con su fecha, para que la caja del día
 * original no cambie.
 *
 * Todo lo que emite va a SUNAT y no se deshace: `ejecutar` exige `confirmar`
 * y procesa uno por uno, parando en el primer rechazo.
 */

/** Afectaciones sin IGV (exonerado e inafecto, onerosos). */
const SIN_IGV = [20, 30];

export interface LineaARegularizar {
  descripcion: string;
  cantidad: number;
  precio: number;
  afectacionEmitida: number;
  afectacionNota: number;
}

export interface ComprobanteARegularizar {
  id: number;
  documento: string;
  tipoDoc: string;
  fecha: Date;
  total: number;
  igv: number;
  nota: string;
  notaId: number;
  cliente: string;
  lineas: LineaARegularizar[];
  /** Facturado junto con otras notas: no se regulariza solo, hay que verlo a mano. */
  conNotasExtra: boolean;
}

/**
 * Las líneas cuya afectación en el comprobante no es la de la nota de venta
 * de origen. Puro, para probarlo: empareja por producto y, en ítems libres,
 * por descripción.
 */
export function lineasConAfectacionErrada(
  emitidas: { productoId: number | null; descripcion: string; cantidad: number; mtoPrecioUnitario: number; tipAfeIgv: number }[],
  deLaNota: { productoId: number | null; descripcion: string; tipAfeIgv: number }[],
): LineaARegularizar[] {
  const errores: LineaARegularizar[] = [];
  for (const l of emitidas) {
    const origen = deLaNota.find((n) =>
      l.productoId != null ? n.productoId === l.productoId : n.productoId == null && n.descripcion === l.descripcion,
    );
    if (!origen) continue;
    if (Number(l.tipAfeIgv) === 10 && SIN_IGV.includes(Number(origen.tipAfeIgv))) {
      errores.push({
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad),
        precio: Number(l.mtoPrecioUnitario),
        afectacionEmitida: Number(l.tipAfeIgv),
        afectacionNota: Number(origen.tipAfeIgv),
      });
    }
  }
  return errores;
}

@Injectable()
export class RegularizarAfectacionService {
  private readonly logger = new Logger(RegularizarAfectacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comprobantes: ComprobanteService,
    private readonly enviarSunat: EnviarSunatService,
  ) {}

  /** Lo que hay que regularizar en la empresa. No emite nada. */
  async planear(empresaId: number): Promise<ComprobanteARegularizar[]> {
    const formales = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        tipoDoc: { in: ['01', '03'] },
        estadoEnvioSunat: 'EMITIDO',
        comprobanteOrigenId: { not: null },
        detalles: { some: { tipAfeIgv: 10 } },
      },
      orderBy: [{ fechaEmision: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        fechaEmision: true,
        mtoImpVenta: true,
        mtoIGV: true,
        comprobanteOrigenId: true,
        cliente: { select: { nombre: true } },
        detalles: { select: { productoId: true, descripcion: true, cantidad: true, mtoPrecioUnitario: true, tipAfeIgv: true } },
        origenesExtra: { select: { origenId: true } },
        comprobanteOrigen: {
          select: { serie: true, correlativo: true, detalles: { select: { productoId: true, descripcion: true, tipAfeIgv: true } } },
        },
      },
    });

    const plan: ComprobanteARegularizar[] = [];
    for (const f of formales) {
      if (!f.comprobanteOrigen) continue;
      const lineas = lineasConAfectacionErrada(f.detalles as any, f.comprobanteOrigen.detalles as any);
      if (!lineas.length) continue;
      plan.push({
        id: f.id,
        documento: `${f.serie}-${f.correlativo}`,
        tipoDoc: f.tipoDoc,
        fecha: f.fechaEmision,
        total: Number(f.mtoImpVenta),
        igv: Number(f.mtoIGV),
        nota: `${f.comprobanteOrigen.serie}-${f.comprobanteOrigen.correlativo}`,
        notaId: f.comprobanteOrigenId as number,
        cliente: f.cliente?.nombre ?? '',
        lineas,
        conNotasExtra: f.origenesExtra.length > 0,
      });
    }
    return plan;
  }

  /**
   * Anula con nota de crédito y vuelve a emitir, uno por uno. Para en el
   * primer error: lo emitido hasta ahí queda hecho y se informa.
   */
  async ejecutar(empresaId: number, ids: number[], confirmar: boolean, adminNombre = 'Sistema', adminEmail = 'sistema@krezka') {
    if (confirmar !== true) {
      throw new BadRequestException('Confirma la regularización: emite notas de crédito y comprobantes en SUNAT y no se deshace.');
    }
    const plan = await this.planear(empresaId);
    const elegidos = plan.filter((p) => ids.includes(p.id));
    if (elegidos.length !== ids.length) {
      throw new BadRequestException('Alguno de los comprobantes ya no está pendiente de regularizar. Vuelve a cargar la lista.');
    }
    const motivo = await this.prisma.motivoNota.findUnique({ where: { tipo_codigo: { tipo: 'CREDITO' as any, codigo: '01' } } });
    if (!motivo) throw new NotFoundException('No está el motivo 01 (anulación de la operación) de nota de crédito.');

    const hechos: { documento: string; notaCredito: string; nuevo: string }[] = [];
    for (const p of elegidos) {
      if (p.conNotasExtra) {
        return { hechos, detenidoEn: p.documento, error: 'Se facturó junto con otras notas: regularízalo a mano.' };
      }
      try {
        hechos.push(await this.regularizarUno(empresaId, p.id, motivo.id, adminNombre, adminEmail));
      } catch (e: any) {
        this.logger.error(`Regularización ${p.documento}: ${e?.message}`);
        return { hechos, detenidoEn: p.documento, error: String(e?.message ?? e) };
      }
    }
    return { hechos, detenidoEn: null, error: null };
  }

  private async regularizarUno(empresaId: number, id: number, motivoId: number, adminNombre: string, adminEmail: string) {
    const f = await this.prisma.comprobante.findFirst({
      where: { id, empresaId },
      include: {
        detalles: true,
        cliente: { select: { id: true } },
        comprobanteOrigen: { include: { detalles: true } },
      },
    });
    if (!f || !f.comprobanteOrigen) throw new NotFoundException('Comprobante no encontrado');
    const documento = `${f.serie}-${f.correlativo}`;
    const pagos = await this.prisma.pago.findMany({ where: { comprobanteId: f.id } });
    const usuarioId = f.usuarioId ?? undefined;
    const sedeId = f.sedeId ?? undefined;
    const ahora = new Date().toISOString();
    const comun = {
      fechaEmision: ahora,
      tipoMoneda: f.tipoMoneda,
      formaPagoTipo: f.formaPagoTipo,
      formaPagoMoneda: f.formaPagoMoneda,
      tipoOperacionId: f.tipoOperacionId,
      clienteId: f.cliente?.id ?? f.clienteId,
    };

    // 1) Nota de crédito por anulación, a SUNAT. Si SUNAT la rechaza, se para
    //    aquí: el comprobante sigue vigente y no se reemite nada.
    const nc: any = await this.comprobantes.crearFormal(
      {
        ...comun,
        medioPago: f.medioPago,
        tipDocAfectado: f.tipoDoc,
        numDocAfectado: documento,
        motivoId,
        observaciones: `Anula ${documento}: se emitió con IGV y la venta es exonerada. Se reemite con la afectación correcta.`,
      },
      empresaId,
      '07',
      usuarioId,
      sedeId,
      { regularizacion: true },
    );
    await this.exigirAceptado(nc.id, `Nota de crédito de ${documento}`);

    // 2) Reemisión: conversión de la misma nota, con la afectación de la nota.
    const nuevo: any = await this.comprobantes.crearFormal(
      {
        ...comun,
        medioPago: f.medioPago,
        comprobanteOrigenId: f.comprobanteOrigenId,
        observaciones: [f.observaciones, `Reemplaza a ${documento} (anulado con ${nc.serie}-${nc.correlativo}).`]
          .filter((s) => s && String(s).trim())
          .join('\n'),
        detalles: f.detalles.map((d) => {
          const origen = f.comprobanteOrigen!.detalles.find((n) =>
            d.productoId != null ? n.productoId === d.productoId : n.productoId == null && n.descripcion === d.descripcion,
          );
          return {
            productoId: d.productoId,
            descripcion: d.descripcion,
            cantidad: Number(d.cantidad),
            unidad: d.unidad,
            ...(d.productoId == null ? { unidadVenta: d.unidad } : {}),
            nuevoValorUnitario: Number(d.mtoPrecioUnitario),
            tipoAfectacionIGV: String(origen?.tipAfeIgv ?? d.tipAfeIgv),
          };
        }),
      },
      empresaId,
      f.tipoDoc as '01' | '03',
      usuarioId,
      sedeId,
      { regularizacion: true },
    );
    await this.exigirAceptado(nuevo.id, `Reemisión de ${documento}`);

    // 3) Cobros: si vivían en el comprobante anulado, la nota de crédito los
    //    borró. Van al nuevo tal cual, con su fecha original.
    //    Siempre se reemplaza lo que haya registrado la emisión: el nuevo
    //    queda con exactamente los cobros que tenía el anulado (ninguno, si la
    //    plata entró con la nota).
    await this.prisma.$transaction([
      this.prisma.pago.deleteMany({ where: { comprobanteId: nuevo.id } }),
      ...(pagos.length
        ? [
            this.prisma.pago.createMany({
              data: pagos.map(({ id: _id, comprobanteId: _c, ...resto }) => ({ ...resto, comprobanteId: nuevo.id })),
            }),
          ]
        : []),
    ]);

    await this.prisma.empresaLog.create({
      data: {
        empresaId,
        accion: 'REGULARIZACION_IGV',
        detalle: `${documento} anulado con ${nc.serie}-${nc.correlativo} y reemitido como ${nuevo.serie}-${nuevo.correlativo}`,
        autorNombre: adminNombre,
        autorEmail: adminEmail,
      },
    });
    return { documento, notaCredito: `${nc.serie}-${nc.correlativo}`, nuevo: `${nuevo.serie}-${nuevo.correlativo}` };
  }

  /** Envía a SUNAT y exige que quede EMITIDO; si no, corta la regularización. */
  private async exigirAceptado(comprobanteId: number, que: string) {
    try {
      await this.enviarSunat.execute(comprobanteId);
    } catch (e: any) {
      throw new BadRequestException(`${que}: SUNAT no lo aceptó (${e?.message ?? e}).`);
    }
    const c = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      select: { estadoEnvioSunat: true, serie: true, correlativo: true },
    });
    if (c?.estadoEnvioSunat !== 'EMITIDO') {
      throw new BadRequestException(`${que} (${c?.serie}-${c?.correlativo}) quedó ${c?.estadoEnvioSunat}: revísalo antes de seguir.`);
    }
  }
}
