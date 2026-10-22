import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KardexService } from '../kardex/kardex.service';
import { ProductoLoteService } from '../producto/producto-lote.service';
import { costoDeSede } from '../kardex/costo-sede';
import { usaLotes } from '../common/utils/rubro-features';
import { etiquetaDeMotivo } from '../producto/motivo-ajuste-stock';
import {
  DocumentoInvalido,
  DocumentoLeido,
  LineaDocumento,
  ProblemaLinea,
  TipoDocumento,
  conceptoKardex,
  leerDocumento,
  loteObligatorioPara,
  motivosDe,
  numeroVisible,
} from './reglas';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Lo que se sabe de un producto para decidir si la línea se puede aplicar. */
interface ProductoLinea {
  id: number;
  codigo: string;
  descripcion: string;
  productoPadreId: number | null;
  esServicio: boolean;
  tieneVariantes: boolean;
  stockSede: number;
  costo: number;
  lotes: { id: number; lote: string; stockActual: number; activo: boolean; fechaVencimiento: Date }[];
}

@Injectable()
export class InventarioDocumentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kardex: KardexService,
    private readonly lotes: ProductoLoteService,
  ) {}

  /** Lo que la pantalla necesita saber antes de empezar. */
  async contexto(empresaId: number) {
    const rubro = await this.rubroDe(empresaId);
    const obligatorio = loteObligatorioPara(rubro);
    const etiquetas = (tipo: TipoDocumento) =>
      motivosDe(tipo).map((codigo) => ({ codigo, etiqueta: etiquetaDeMotivo(codigo) }));
    return {
      lotePermitido: obligatorio || usaLotes(rubro),
      loteObligatorio: obligatorio,
      motivos: { ENTRADA: etiquetas('ENTRADA'), SALIDA: etiquetas('SALIDA') },
    };
  }

  async listar(
    empresaId: number,
    filtros: { tipo?: string; sedeId?: number; page?: number; limit?: number; buscar?: string },
  ) {
    const page = Math.max(1, Number(filtros.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filtros.limit) || 20));
    const tipo = String(filtros.tipo ?? '').toUpperCase();
    const where: Prisma.DocumentoInventarioWhereInput = {
      empresaId,
      ...(tipo === 'ENTRADA' || tipo === 'SALIDA' ? { tipo } : {}),
      ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
    };
    // "NE-12", "ns 000012" o "12" buscan por número; lo demás, por producto.
    const buscar = String(filtros.buscar ?? '').trim();
    if (buscar) {
      const m = buscar.match(/^(?:(NE|NS)[\s-]*)?0*(\d+)$/i);
      if (m) {
        where.numero = Number(m[2]);
        if (m[1]) where.tipo = m[1].toUpperCase() === 'NE' ? 'ENTRADA' : 'SALIDA';
      } else {
        where.items = { some: { producto: { descripcion: { contains: buscar, mode: 'insensitive' } } } };
      }
    }
    const [total, docs] = await Promise.all([
      this.prisma.documentoInventario.count({ where }),
      this.prisma.documentoInventario.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { items: { select: { cantidad: true } } },
      }),
    ]);
    const nombres = await this.nombres(empresaId, docs);
    return {
      total,
      page,
      limit,
      data: docs.map((d) => ({
        id: d.id,
        tipo: d.tipo,
        numero: numeroVisible(d.tipo, d.numero),
        fecha: d.fecha,
        motivo: d.motivo,
        motivoEtiqueta: etiquetaDeMotivo(d.motivo),
        detalle: d.detalle,
        sede: nombres.sedes.get(d.sedeId) ?? '',
        responsable: d.usuarioId ? nombres.usuarios.get(d.usuarioId) ?? '' : '',
        productos: d.items.length,
        unidades: r3(d.items.reduce((s, it) => s + Number(it.cantidad), 0)),
      })),
    };
  }

  async obtener(empresaId: number, id: number, sedeId?: number) {
    const d = await this.prisma.documentoInventario.findFirst({
      where: { id, empresaId, ...(sedeId ? { sedeId } : {}) },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: {
            producto: {
              select: {
                id: true,
                codigo: true,
                descripcion: true,
                valoresAtributos: true,
                unidadMedida: { select: { codigo: true, nombre: true } },
              },
            },
          },
        },
      },
    });
    if (!d) throw new NotFoundException('No se encontró ese documento.');
    const nombres = await this.nombres(empresaId, [d]);
    return {
      id: d.id,
      tipo: d.tipo,
      numero: numeroVisible(d.tipo, d.numero),
      fecha: d.fecha,
      motivo: d.motivo,
      motivoEtiqueta: etiquetaDeMotivo(d.motivo),
      detalle: d.detalle,
      sede: nombres.sedes.get(d.sedeId) ?? '',
      responsable: d.usuarioId ? nombres.usuarios.get(d.usuarioId) ?? '' : '',
      items: d.items.map((it) => ({
        productoId: it.productoId,
        codigo: it.producto.codigo,
        descripcion: it.producto.descripcion,
        variante: Object.values((it.producto.valoresAtributos as Record<string, string>) ?? {}).join(' / ') || null,
        unidad: it.producto.unidadMedida?.codigo ?? '',
        cantidad: Number(it.cantidad),
        costoUnitario: it.costoUnitario != null ? Number(it.costoUnitario) : null,
        lote: it.lote,
        fechaVencimiento: it.fechaVencimiento,
      })),
    };
  }

  /**
   * Registra el documento y mueve el stock.
   *
   * Primero se revisa TODO —que cada producto sea del negocio, que haya stock
   * para sacar, que el lote exista— y recién después se toca algo. Así un
   * error en la fila 12 no deja aplicadas las 11 anteriores.
   */
  async crear(empresaId: number, usuarioId: number | undefined, sedeId: number, body: unknown) {
    let doc: DocumentoLeido;
    try {
      doc = leerDocumento(body);
    } catch (e) {
      throw this.comoHttp(e);
    }
    const sede = await this.prisma.sede.findFirst({ where: { id: sedeId, empresaId }, select: { id: true } });
    if (!sede) throw new BadRequestException('La sede no es de este negocio.');

    const rubro = await this.rubroDe(empresaId);
    const reglas = { obligatorio: loteObligatorioPara(rubro), permitido: loteObligatorioPara(rubro) || usaLotes(rubro) };
    const productos = await this.cargarProductos(empresaId, sedeId, doc.lineas);
    const problemas = this.revisar(doc, productos, reglas);
    if (problemas.length) {
      throw this.comoHttp(
        new DocumentoInvalido(
          problemas.length === 1 ? `Fila ${problemas[0].linea}: ${problemas[0].mensaje}` : `Hay ${problemas.length} filas por corregir.`,
          problemas,
        ),
      );
    }

    const creado = await this.numerar(empresaId, sedeId, usuarioId, doc);
    const concepto = conceptoKardex(doc.tipo, doc.motivo, creado.numero);
    const items = await this.prisma.documentoInventarioItem.findMany({
      where: { documentoId: creado.id },
      orderBy: { id: 'asc' },
    });

    // Lo que falle acá ya no es un dato mal puesto (eso se revisó arriba): es
    // algo que cambió en el medio, como otra venta que se llevó el último lote.
    // Se aplica lo demás y se avisa qué fila quedó sin mover.
    const noAplicadas: ProblemaLinea[] = [];
    for (let i = 0; i < doc.lineas.length; i++) {
      const l = doc.lineas[i];
      const p = productos.get(l.productoId)!;
      try {
        const movId = await this.aplicar(empresaId, sedeId, usuarioId, doc, l, p, concepto);
        if (movId) {
          await this.prisma.documentoInventarioItem.update({
            where: { id: items[i].id },
            data: { movimientoKardexId: movId },
          });
        }
      } catch (e: any) {
        noAplicadas.push({ linea: i + 1, productoId: l.productoId, mensaje: e?.response?.message ?? e?.message ?? 'No se pudo mover el stock.' });
      }
    }
    if (noAplicadas.length) {
      await this.prisma.documentoInventario.update({
        where: { id: creado.id },
        data: {
          detalle: [doc.detalle, `Sin aplicar: ${noAplicadas.map((x) => `fila ${x.linea} (${x.mensaje})`).join('; ')}`]
            .filter(Boolean)
            .join(' · '),
        },
      });
    }
    return { ...(await this.obtener(empresaId, creado.id)), noAplicadas };
  }

  // ─────────────────────────────────────────────────────────────────────

  private async rubroDe(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { rubro: { select: { nombre: true } } },
    });
    return e?.rubro?.nombre ?? '';
  }

  private async nombres(empresaId: number, docs: { sedeId: number; usuarioId: number | null }[]) {
    const [sedes, usuarios] = await Promise.all([
      this.prisma.sede.findMany({
        where: { empresaId, id: { in: [...new Set(docs.map((d) => d.sedeId))] } },
        select: { id: true, nombre: true },
      }),
      this.prisma.usuario.findMany({
        where: { id: { in: [...new Set(docs.map((d) => d.usuarioId).filter((x): x is number => !!x))] } },
        select: { id: true, nombre: true },
      }),
    ]);
    return {
      sedes: new Map(sedes.map((s) => [s.id, s.nombre])),
      usuarios: new Map(usuarios.map((u) => [u.id, u.nombre])),
    };
  }

  private async cargarProductos(empresaId: number, sedeId: number, lineas: LineaDocumento[]) {
    const ids = [...new Set(lineas.map((l) => l.productoId))];
    const filas = await this.prisma.producto.findMany({
      where: { id: { in: ids }, empresaId },
      select: {
        id: true,
        codigo: true,
        descripcion: true,
        productoPadreId: true,
        costoPromedio: true,
        atributosTecnicos: true,
        _count: { select: { variantes: { where: { estado: 'ACTIVO' } } } },
        stocks: { where: { sedeId }, select: { stock: true, costoPromedio: true } },
        lotes: {
          select: { id: true, lote: true, stockActual: true, activo: true, fechaVencimiento: true },
        },
      },
    });
    return new Map<number, ProductoLinea>(
      filas.map((p) => [
        p.id,
        {
          id: p.id,
          codigo: p.codigo,
          descripcion: p.descripcion,
          productoPadreId: p.productoPadreId,
          esServicio: String((p.atributosTecnicos as any)?.tipoProducto ?? '').toUpperCase() === 'SERVICIO',
          tieneVariantes: p._count.variantes > 0,
          stockSede: r3(Number(p.stocks[0]?.stock ?? 0)),
          costo: costoDeSede(p.stocks[0]?.costoPromedio, p.costoPromedio),
          lotes: p.lotes.map((l) => ({ ...l, stockActual: Number(l.stockActual) })),
        },
      ]),
    );
  }

  /** Todo lo que impide aplicar una línea, en palabras del que la cargó. */
  private revisar(
    doc: DocumentoLeido,
    productos: Map<number, ProductoLinea>,
    reglas: { obligatorio: boolean; permitido: boolean },
  ): ProblemaLinea[] {
    const problemas: ProblemaLinea[] = [];
    const hoy = new Date();
    doc.lineas.forEach((l, i) => {
      const linea = i + 1;
      const p = productos.get(l.productoId);
      const di = (mensaje: string) => problemas.push({ linea, productoId: l.productoId, mensaje });
      if (!p) return di('Ese producto no existe en este negocio.');
      if (p.esServicio) return di(`${p.descripcion} es un servicio: no tiene stock.`);
      if (p.tieneVariantes) return di(`${p.descripcion} tiene tallas o colores: elige cuál.`);

      const lotesActivos = p.lotes.filter((x) => x.activo);
      const porLote = reglas.obligatorio || lotesActivos.length > 0;
      if (l.lote && !reglas.permitido && !lotesActivos.length) {
        return di('Este negocio no trabaja con lotes: quita el lote de la fila.');
      }

      if (doc.tipo === 'ENTRADA') {
        if (porLote && !l.lote) {
          return di(`${p.descripcion} se maneja por lotes: indica el lote${reglas.obligatorio ? ' y su vencimiento' : ''}.`);
        }
        if (l.lote) {
          const existente = p.lotes.find((x) => x.lote === l.lote);
          if (!existente && !l.vence) return di(`El lote ${l.lote} es nuevo: indica su fecha de vencimiento.`);
        }
        return;
      }

      // SALIDA
      if (l.lote) {
        const lote = p.lotes.find((x) => x.lote === l.lote);
        if (!lote || (!lote.activo && lote.stockActual <= 0)) return di(`${p.descripcion} no tiene un lote ${l.lote} con stock.`);
        if (lote.stockActual < l.cantidad) {
          return di(`El lote ${l.lote} tiene ${r3(lote.stockActual)}; no se pueden sacar ${l.cantidad}.`);
        }
      } else if (porLote && lotesActivos.length) {
        // Sin lote elegido sale por el que vence primero, pero solo de los
        // vigentes: un vencido se da de baja eligiéndolo a propósito.
        const vigentes = lotesActivos.filter((x) => x.fechaVencimiento >= hoy);
        const enVigentes = r3(vigentes.reduce((s, x) => s + x.stockActual, 0));
        if (enVigentes < l.cantidad) {
          const vencidos = lotesActivos.filter((x) => x.fechaVencimiento < hoy && x.stockActual > 0);
          return di(
            vencidos.length
              ? `En lotes vigentes hay ${enVigentes}. Para sacar lo vencido elige el lote (${vencidos.map((x) => x.lote).join(', ')}).`
              : `En sus lotes hay ${enVigentes}; no se pueden sacar ${l.cantidad}.`,
          );
        }
      }
      if (p.stockSede < l.cantidad) {
        di(`${p.descripcion}: en esta sede hay ${p.stockSede}; no se pueden sacar ${l.cantidad}.`);
      }
    });
    return problemas;
  }

  /**
   * Crea el documento con el siguiente número del negocio. Si dos personas
   * guardan a la vez, el índice único hace fallar a una y se reintenta con el
   * número que sigue.
   */
  private async numerar(empresaId: number, sedeId: number, usuarioId: number | undefined, doc: DocumentoLeido) {
    for (let intento = 0; intento < 5; intento++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const ultimo = await tx.documentoInventario.aggregate({
            where: { empresaId, tipo: doc.tipo },
            _max: { numero: true },
          });
          return tx.documentoInventario.create({
            data: {
              empresaId,
              sedeId,
              usuarioId: usuarioId ?? null,
              tipo: doc.tipo,
              numero: (ultimo._max.numero ?? 0) + 1,
              motivo: doc.motivo,
              detalle: doc.detalle ?? null,
              items: {
                create: doc.lineas.map((l) => ({
                  productoId: l.productoId,
                  cantidad: l.cantidad,
                  costoUnitario: l.costoUnitario ?? null,
                  lote: l.lote ?? null,
                  fechaVencimiento: l.vence ? new Date(`${l.vence}T12:00:00Z`) : null,
                })),
              },
            },
            select: { id: true, numero: true },
          });
        });
      } catch (e: any) {
        if (e?.code !== 'P2002' || intento === 4) throw e;
      }
    }
    throw new Error('inalcanzable');
  }

  /** Mueve el stock de una línea. Devuelve el movimiento del kardex. */
  private async aplicar(
    empresaId: number,
    sedeId: number,
    usuarioId: number | undefined,
    doc: DocumentoLeido,
    l: LineaDocumento,
    p: ProductoLinea,
    concepto: string,
  ): Promise<number | null> {
    const entrada = doc.tipo === 'ENTRADA';
    const base = {
      productoId: p.id,
      empresaId,
      sedeId,
      concepto,
      cantidad: l.cantidad,
      usuarioId,
      observacion: doc.detalle,
    };

    if (entrada && l.lote) {
      const existente = p.lotes.find((x) => x.lote === l.lote);
      if (!existente) {
        // Lote nuevo: lo crea el servicio de lotes, que ya mueve la sede y
        // deja su propio kardex. Se le pone el concepto del documento.
        await this.lotes.crearLote({
          productoId: p.id,
          empresaId,
          sedeId,
          lote: l.lote,
          fechaVencimiento: new Date(`${l.vence}T12:00:00Z`),
          stockInicial: l.cantidad,
          costoUnitario: l.costoUnitario,
          usuarioId: usuarioId ?? (undefined as any),
        });
        const mov = await this.prisma.movimientoKardex.findFirst({
          where: { productoId: p.id, empresaId, concepto: `Apertura Lote: ${l.lote}` },
          orderBy: { id: 'desc' },
          select: { id: true },
        });
        if (mov) {
          await this.prisma.movimientoKardex.update({
            where: { id: mov.id },
            data: { concepto: `${concepto} · Lote ${l.lote}`, usuarioId: usuarioId ?? null, observacion: doc.detalle ?? null },
          });
        }
        return mov?.id ?? null;
      }
      // Un lote que se quedó en cero se apagó solo; si vuelve mercadería
      // (una devolución) se vuelve a prender.
      if (!existente.activo && existente.stockActual <= 0) {
        await this.prisma.productoLote.update({ where: { id: existente.id }, data: { activo: true } });
      }
      const mov = await this.kardex.registrarMovimiento({
        ...base,
        tipoMovimiento: 'INGRESO',
        concepto: `${concepto} · Lote ${l.lote}`,
        costoUnitario: l.costoUnitario,
        lote: l.lote,
        fechaVencimiento: existente.fechaVencimiento,
      });
      await this.lotes.aumentarStockLote(existente.id, l.cantidad, mov.id);
      return mov.id;
    }

    if (entrada) {
      const mov = await this.kardex.registrarMovimiento({ ...base, tipoMovimiento: 'INGRESO', costoUnitario: l.costoUnitario });
      return mov.id;
    }

    // SALIDA: se valoriza al costo de la sede, para que el reporte de Mermas
    // sepa cuánta plata se fue.
    const lote = l.lote ? p.lotes.find((x) => x.lote === l.lote) : undefined;
    const mov = await this.kardex.registrarMovimiento({
      ...base,
      tipoMovimiento: 'SALIDA',
      concepto: lote ? `${concepto} · Lote ${lote.lote}` : concepto,
      costoUnitario: p.costo || undefined,
      lote: lote?.lote,
      fechaVencimiento: lote?.fechaVencimiento,
    });
    if (lote || p.lotes.some((x) => x.activo)) {
      await this.lotes.descontarStockLote(p.id, l.cantidad, mov.id, lote?.id);
    }
    return mov.id;
  }

  private comoHttp(e: unknown) {
    if (e instanceof DocumentoInvalido) {
      return new BadRequestException({ message: e.message, problemas: e.problemas });
    }
    return e as Error;
  }
}
