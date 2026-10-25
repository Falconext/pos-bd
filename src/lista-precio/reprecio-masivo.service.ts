import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  calcularPrecioNuevo,
  calcularPrecioPack,
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

    // Los packs que tienen precio PROPIO en esta lista se mueven con su
    // unidad (ver calcularPrecioPack). Los que no lo tienen ya cobran el
    // precio de paquete del producto, que no es parte de la lista.
    const itemsPack = await this.prisma.listaPrecioItem.findMany({
      where: {
        listaPrecioId: op.listaPrecioId,
        productoId: { in: productos.map((p) => p.id) },
        presentacionCodigo: { not: '' },
      },
      select: { productoId: true, presentacionCodigo: true, precioUnitario: true },
    });
    const presentaciones = itemsPack.length
      ? await this.prisma.productoCodigoBarras.findMany({
          where: {
            empresaId,
            productoId: { in: [...new Set(itemsPack.map((i) => i.productoId))] },
            codigo: { in: [...new Set(itemsPack.map((i) => i.presentacionCodigo))] },
          },
          select: { productoId: true, codigo: true, unidadesPorPaquete: true, alias: true },
        })
      : [];
    const presentacion = new Map(presentaciones.map((x) => [`${x.productoId}|${x.codigo}`, x]));
    const filaUnidad = new Map(filas.map((f) => [f.productoId, f]));

    const filasPack = itemsPack.flatMap((i) => {
      const pres = presentacion.get(`${i.productoId}|${i.presentacionCodigo}`);
      const unidad = filaUnidad.get(i.productoId);
      // Si la presentación ya no existe no se sabe cuántas unidades trae:
      // mejor no tocar ese precio que inventarle una cantidad.
      if (!pres || !unidad || (pres.unidadesPorPaquete ?? 1) < 2) return [];
      const unidades = pres.unidadesPorPaquete;
      const costoPack = Math.round(unidad.costoConIgv * unidades * 100) / 100;
      const precioActual = Math.round(Number(i.precioUnitario) * 100) / 100;
      const precioNuevo = calcularPrecioPack({
        precioActual,
        costoUnidadConIgv: unidad.costoConIgv,
        unidades,
        operacion: op.operacion,
        modo: op.modo,
        valor: op.valor,
      });
      return [{
        productoId: i.productoId,
        presentacionCodigo: i.presentacionCodigo,
        presentacion: pres.alias?.trim() || `x${unidades}`,
        unidades,
        codigo: unidad.codigo,
        descripcion: unidad.descripcion,
        costoNeto: Math.round(unidad.costoNeto * unidades * 100) / 100,
        costoConIgv: costoPack,
        precioActual,
        precioNuevo,
        utilidadActual: utilidadSobreCosto(precioActual, costoPack),
        utilidadNueva: precioNuevo != null ? utilidadSobreCosto(precioNuevo, costoPack) : null,
        sinCosto: unidad.sinCosto,
        seAplica: precioNuevo != null && precioNuevo !== precioActual,
        // Con "fijar precio S/" el pack no cambia a propósito; la pantalla lo dice.
        packPrecioFijo: op.operacion === 'REEMPLAZAR' && op.modo === 'MONTO',
      }];
    });

    // Cada pack va justo debajo de su unidad, para leerlos juntos.
    const ordenadas = filas.flatMap((f) => [
      { ...f, presentacionCodigo: '' },
      ...filasPack.filter((k) => k.productoId === f.productoId),
    ]);
    return { filas: ordenadas, total: ordenadas.length };
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
      },
      select: { productoId: true, presentacionCodigo: true, precioUnitario: true },
    });
    const clave = (productoId: number, presentacionCodigo?: string) => `${productoId}|${presentacionCodigo || ''}`;
    const anteriorEnLista = new Map(
      yaEnLista.map((i) => [clave(i.productoId, i.presentacionCodigo), Number(i.precioUnitario)]),
    );

    const detalle = aplicables.map((f) => {
      const k = clave(f.productoId, f.presentacionCodigo);
      return {
        productoId: f.productoId,
        presentacionCodigo: f.presentacionCodigo || '',
        // null = no tenía precio propio en la lista. Deshacer = borrar el item,
        // no escribirle el precio del producto, que lo dejaría "clavado".
        precioAnterior: anteriorEnLista.has(k) ? anteriorEnLista.get(k)! : null,
        precioNuevo: f.precioNuevo!,
      };
    });

    await this.prisma.$transaction([
      ...aplicables.map((f) =>
        this.prisma.listaPrecioItem.upsert({
          where: {
            listaPrecioId_productoId_presentacionCodigo: {
              listaPrecioId: op.listaPrecioId,
              productoId: f.productoId,
              presentacionCodigo: f.presentacionCodigo || '',
            },
          },
          create: {
            listaPrecioId: op.listaPrecioId,
            productoId: f.productoId,
            presentacionCodigo: f.presentacionCodigo || '',
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
   *
   * Solo se puede deshacer del más nuevo al más viejo. Un lote posterior sobre
   * los mismos productos guardó como "precio anterior" el que dejó este lote;
   * si se deshiciera este primero, el posterior quedaría figurando como vigente
   * en el historial mientras su efecto ya no está en ningún precio, y al
   * deshacerlo después no tendría nada que restaurar. El empresario vería un
   * historial que no coincide con lo que cobra.
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
    await this.exigirQueSeaElUltimo(empresaId, lote, detalle);

    const aRestaurar = detalle.filter((d) => d.precioAnterior != null);
    const aBorrar = detalle.filter((d) => d.precioAnterior == null);

    const operaciones: any[] = [
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
                OR: aBorrar.map((d) => ({
                  productoId: d.productoId,
                  presentacionCodigo: d.presentacionCodigo || '',
                })),
              },
            }),
          ]
        : []),
      this.prisma.reprecioLote.update({
        where: { id: lote.id },
        data: { revertidoEn: new Date() },
      }),
    ];

    const resultado = await this.prisma.$transaction(operaciones);

    // Se informa lo que REALMENTE se tocó, no lo que se pensaba tocar: si una
    // fila ya no existe, `updateMany` afecta 0 y decir "13 restaurados" sería
    // mentirle al empresario sobre el estado de sus precios.
    const restaurados = resultado
      .slice(0, aRestaurar.length)
      .reduce((suma: number, r: any) => suma + (r?.count ?? 0), 0);
    const eliminados = aBorrar.length
      ? ((resultado[aRestaurar.length] as any)?.count ?? 0)
      : 0;

    return { ok: true, restaurados, eliminados };
  }

  /**
   * Rechaza el deshacer si otro reprecio posterior ya pisó alguno de estos
   * productos. Se compara por producto y no por lista: dos reprecios sobre
   * categorías distintas de la misma lista no se estorban, y bloquearlos sería
   * una traba sin motivo.
   */
  private async exigirQueSeaElUltimo(
    empresaId: number,
    lote: { id: number; listaPrecioId: number; creadoEn: Date },
    detalle: any[],
  ) {
    const mios = new Set(detalle.map((d) => Number(d.productoId)));
    if (mios.size === 0) return;

    const posteriores = await this.prisma.reprecioLote.findMany({
      where: {
        empresaId,
        listaPrecioId: lote.listaPrecioId,
        revertidoEn: null,
        id: { not: lote.id },
        creadoEn: { gt: lote.creadoEn },
      },
      orderBy: { creadoEn: 'asc' },
      select: { creadoEn: true, detalle: true },
    });

    const choca = posteriores.find((p) =>
      (((p.detalle as any[]) || []) as any[]).some((d) =>
        mios.has(Number(d.productoId)),
      ),
    );
    if (!choca) return;

    const fecha = choca.creadoEn.toLocaleString('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    throw new BadRequestException(
      `Después de este hiciste otro reprecio sobre los mismos productos (${fecha}). ` +
        'Deshaz ese primero y luego este.',
    );
  }
}
