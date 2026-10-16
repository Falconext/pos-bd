import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  calcularPrecioNuevo,
  costoConIgv,
  esGravado,
  utilidadSobreCosto,
  type ModoReprecio,
  type OperacionReprecio,
} from '../common/utils/reprecio-masivo';

export interface FiltroReprecio {
  productoIds?: number[];
  categoriaId?: number;
  marcaId?: number;
  search?: string;
  sedeId?: number;
}

export interface OperacionDto {
  listaPrecioId: number;
  operacion: OperacionReprecio;
  modo: ModoReprecio;
  valor: number;
  /** Precios fijados a mano por fila, que mandan sobre el cálculo general. */
  overrides?: { productoId: number; precioNuevo: number }[];
}

/**
 * Reprecio masivo de una lista.
 *
 * Previsualizar y aplicar comparten el mismo cálculo a propósito: si fueran dos
 * caminos, lo que el empresario ve antes de confirmar podría no ser lo que se
 * guarda, y esta es justo la pantalla donde eso no se perdona.
 */
@Injectable()
export class ReprecioMasivoService {
  constructor(private readonly prisma: PrismaService) {}

  private async validarLista(empresaId: number, listaPrecioId: number) {
    const lista = await this.prisma.listaPrecio.findFirst({
      where: { id: listaPrecioId, empresaId },
      select: { id: true, nombre: true },
    });
    if (!lista) throw new NotFoundException('Lista de precio no encontrada');
    return lista;
  }

  /**
   * Las filas con su precio actual, el nuevo y la utilidad que deja cada uno.
   *
   * El precio actual es el de la LISTA; si el producto todavía no tiene precio
   * ahí, se usa el del producto como punto de partida (es lo que hoy se cobra
   * bajo esa lista, por el fallback de la resolución).
   */
  async previsualizar(
    empresaId: number,
    filtro: FiltroReprecio,
    op: OperacionDto,
  ) {
    await this.validarLista(empresaId, op.listaPrecioId);

    const where: any = { empresaId, estado: { not: 'PLACEHOLDER' as any } };
    if (filtro.productoIds?.length) where.id = { in: filtro.productoIds };
    if (filtro.categoriaId) where.categoriaId = filtro.categoriaId;
    if (filtro.marcaId) where.marcaId = filtro.marcaId;
    if (filtro.search?.trim()) {
      where.descripcion = { contains: filtro.search.trim(), mode: 'insensitive' };
    }

    const productos = await this.prisma.producto.findMany({
      where,
      select: {
        id: true,
        codigo: true,
        descripcion: true,
        precioUnitario: true,
        costoPromedio: true,
        tipoAfectacionIGV: true,
        igvPorcentaje: true,
        stocks: filtro.sedeId
          ? { where: { sedeId: filtro.sedeId }, select: { costoPromedio: true } }
          : false,
      },
      orderBy: { descripcion: 'asc' },
      take: 1000,
    });
    if (productos.length === 0) return { filas: [], total: 0 };

    const items = await this.prisma.listaPrecioItem.findMany({
      where: {
        listaPrecioId: op.listaPrecioId,
        productoId: { in: productos.map((p) => p.id) },
        presentacionCodigo: '',
      },
      select: { productoId: true, precioUnitario: true },
    });
    const precioEnLista = new Map(
      items.map((i) => [i.productoId, Number(i.precioUnitario)]),
    );
    const manuales = new Map(
      (op.overrides || []).map((o) => [Number(o.productoId), Number(o.precioNuevo)]),
    );

    const filas = productos.map((p) => {
      // El costo de la sede manda sobre el global cuando existe.
      const costoSede = (p as any).stocks?.[0]?.costoPromedio;
      const costoNeto = costoSede != null ? Number(costoSede) : Number(p.costoPromedio ?? 0);
      const costo = costoConIgv(
        costoNeto,
        esGravado(p.tipoAfectacionIGV),
        Number(p.igvPorcentaje ?? 18),
      );

      const tieneEnLista = precioEnLista.has(p.id);
      const precioActual = tieneEnLista
        ? precioEnLista.get(p.id)!
        : Number(p.precioUnitario ?? 0);

      const manual = manuales.get(p.id);
      const precioNuevo = manual != null && Number.isFinite(manual) && manual > 0
        ? Math.round(manual * 100) / 100
        : calcularPrecioNuevo({
            precioActual,
            costoConIgv: costo,
            operacion: op.operacion,
            modo: op.modo,
            valor: op.valor,
          });

      return {
        productoId: p.id,
        codigo: p.codigo,
        descripcion: p.descripcion,
        costoNeto: Number(costoNeto.toFixed(2)),
        costoConIgv: costo,
        precioActual: Math.round(precioActual * 100) / 100,
        precioNuevo,
        utilidadActual: utilidadSobreCosto(precioActual, costo),
        utilidadNueva: precioNuevo != null ? utilidadSobreCosto(precioNuevo, costo) : null,
        // Sin costo no se puede calcular utilidad; se avisa en vez de mostrar 0.
        sinCosto: costo <= 0,
        // Una fila sin precio nuevo no se va a tocar: hay que decirlo, no
        // dejarla pasar como si se hubiera repreciado.
        seAplica: precioNuevo != null && precioNuevo !== precioActual,
      };
    });

    return { filas, total: filas.length };
  }

  /**
   * Aplica el reprecio y guarda el lote para poder deshacerlo.
   *
   * Se vuelve a calcular desde cero en vez de confiar en lo que mande el
   * frontend: lo que llega es la intención (operación, valor, overrides), no el
   * resultado. Si el catálogo cambió entre la previsualización y el guardado,
   * se guarda lo correcto y no una foto vieja.
   */
  async aplicar(
    empresaId: number,
    usuarioId: number | undefined,
    filtro: FiltroReprecio,
    op: OperacionDto,
  ) {
    const lista = await this.validarLista(empresaId, op.listaPrecioId);
    const { filas } = await this.previsualizar(empresaId, filtro, op);
    const aplicables = filas.filter((f) => f.seAplica && f.precioNuevo != null);
    if (aplicables.length === 0) {
      throw new BadRequestException(
        'No hay ningún precio que cambiar con esos valores.',
      );
    }

    const yaEnLista = await this.prisma.listaPrecioItem.findMany({
      where: {
        listaPrecioId: op.listaPrecioId,
        productoId: { in: aplicables.map((f) => f.productoId) },
        presentacionCodigo: '',
      },
      select: { productoId: true, precioUnitario: true },
    });
    const anteriorEnLista = new Map(
      yaEnLista.map((i) => [i.productoId, Number(i.precioUnitario)]),
    );

    const detalle = aplicables.map((f) => ({
      productoId: f.productoId,
      presentacionCodigo: '',
      // null = no tenía precio propio en la lista. Deshacer = borrar el item,
      // no escribirle el precio del producto, que lo dejaría "clavado".
      precioAnterior: anteriorEnLista.has(f.productoId)
        ? anteriorEnLista.get(f.productoId)!
        : null,
      precioNuevo: f.precioNuevo!,
    }));

    await this.prisma.$transaction([
      ...aplicables.map((f) =>
        this.prisma.listaPrecioItem.upsert({
          where: {
            listaPrecioId_productoId_presentacionCodigo: {
              listaPrecioId: op.listaPrecioId,
              productoId: f.productoId,
              presentacionCodigo: '',
            },
          },
          create: {
            listaPrecioId: op.listaPrecioId,
            productoId: f.productoId,
            presentacionCodigo: '',
            precioUnitario: f.precioNuevo!,
          },
          update: { precioUnitario: f.precioNuevo! },
        }),
      ),
      this.prisma.reprecioLote.create({
        data: {
          empresaId,
          listaPrecioId: op.listaPrecioId,
          usuarioId: usuarioId ?? null,
          operacion: op.operacion,
          modo: op.modo,
          valor: op.valor,
          detalle: detalle as any,
          totalItems: detalle.length,
        },
      }),
    ]);

    return {
      ok: true,
      lista: lista.nombre,
      aplicados: detalle.length,
      omitidos: filas.length - detalle.length,
    };
  }

  /** Los últimos lotes, para el panel de historial. */
  async lotes(empresaId: number, limit = 10) {
    const lotes = await this.prisma.reprecioLote.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
      take: Math.min(Math.max(1, limit), 50),
      select: {
        id: true,
        listaPrecioId: true,
        operacion: true,
        modo: true,
        valor: true,
        totalItems: true,
        creadoEn: true,
        revertidoEn: true,
      },
    });
    const listas = await this.prisma.listaPrecio.findMany({
      where: { id: { in: lotes.map((l) => l.listaPrecioId) } },
      select: { id: true, nombre: true },
    });
    const nombre = new Map(listas.map((l) => [l.id, l.nombre]));
    return lotes.map((l) => ({ ...l, listaNombre: nombre.get(l.listaPrecioId) ?? '—' }));
  }

  /**
   * Deshace un lote: devuelve cada producto a su precio anterior, y borra los
   * items que el lote había creado.
   */
  async revertir(empresaId: number, loteId: number) {
    const lote = await this.prisma.reprecioLote.findFirst({
      where: { id: loteId, empresaId },
    });
    if (!lote) throw new NotFoundException('Reprecio no encontrado');
    if (lote.revertidoEn) {
      throw new BadRequestException('Ese reprecio ya se deshizo.');
    }

    const detalle = (lote.detalle as any[]) || [];
    const aRestaurar = detalle.filter((d) => d.precioAnterior != null);
    const aBorrar = detalle.filter((d) => d.precioAnterior == null);

    await this.prisma.$transaction([
      ...aRestaurar.map((d) =>
        this.prisma.listaPrecioItem.updateMany({
          where: {
            listaPrecioId: lote.listaPrecioId,
            productoId: d.productoId,
            presentacionCodigo: d.presentacionCodigo || '',
          },
          data: { precioUnitario: d.precioAnterior },
        }),
      ),
      ...(aBorrar.length
        ? [
            this.prisma.listaPrecioItem.deleteMany({
              where: {
                listaPrecioId: lote.listaPrecioId,
                presentacionCodigo: '',
                productoId: { in: aBorrar.map((d) => d.productoId) },
              },
            }),
          ]
        : []),
      this.prisma.reprecioLote.update({
        where: { id: lote.id },
        data: { revertidoEn: new Date() },
      }),
    ]);

    return { ok: true, restaurados: aRestaurar.length, eliminados: aBorrar.length };
  }
}
