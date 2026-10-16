import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Hace respetar el piso y el techo de venta de cada producto.
 *
 * La validación del POS es por comodidad del cajero; esta es la que manda. Un
 * vendedor con permiso para editar precios puede mandar cualquier número por
 * la API, y "vendí bajo costo" se descubre recién al cerrar el mes.
 *
 * Solo mira las líneas que tienen producto de catálogo: los ítems libres y los
 * servicios sueltos no tienen piso definido y no se tocan.
 *
 * Los importados (histórico ya emitido) NO se validan: son hechos del pasado,
 * y rechazarlos dejaría al empresario sin poder registrar lo que ya vendió.
 */
export async function validarLimitesPrecioVenta(
  prisma: PrismaService,
  empresaId: number,
  detalles: Array<{
    productoId?: number | null;
    descripcion?: string | null;
    /** Valor unitario SIN IGV, que es como lo manda el POS. */
    nuevoValorUnitario?: number | string | null;
    /** Alias que usan otras rutas (sync, importación). */
    mtoPrecioUnitario?: number | string | null;
    precioUnitario?: number | string | null;
  }>,
): Promise<void> {
  const ids = [
    ...new Set(
      (detalles || [])
        .map((d) => Number(d?.productoId))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (ids.length === 0) return;

  const productos = await prisma.producto.findMany({
    where: { id: { in: ids }, empresaId },
    select: {
      id: true,
      descripcion: true,
      precioMinimoVenta: true,
      precioMaximoVenta: true,
      // El límite se expresa como PRECIO DE VENTA (con IGV), que es lo que el
      // empresario escribe en la ficha; la línea viaja como valor sin IGV.
      tipoAfectacionIGV: true,
      igvPorcentaje: true,
    },
  });
  const porId = new Map(productos.map((p) => [p.id, p]));

  for (const d of detalles || []) {
    const producto = porId.get(Number(d?.productoId));
    if (!producto) continue;

    // Catálogo 07 de SUNAT: solo las afectaciones "10..17" son gravadas; las
    // exoneradas/inafectas/exportación no suman IGV al precio de venta.
    const gravado = /^1\d$/.test(String(producto.tipoAfectacionIGV ?? ''));
    const tasa = gravado ? Number(producto.igvPorcentaje ?? 18) / 100 : 0;

    const valorSinIgv = Number(d?.nuevoValorUnitario ?? NaN);
    const precio = Number.isFinite(valorSinIgv)
      ? valorSinIgv * (1 + tasa)
      : Number(d?.mtoPrecioUnitario ?? d?.precioUnitario ?? NaN);
    if (!Number.isFinite(precio)) continue;

    const nombre = producto.descripcion || d?.descripcion || 'el producto';
    const min =
      producto.precioMinimoVenta != null
        ? Number(producto.precioMinimoVenta)
        : null;
    const max =
      producto.precioMaximoVenta != null
        ? Number(producto.precioMaximoVenta)
        : null;

    // Se compara con un centavo de tolerancia: el precio de una línea puede
    // venir de repartir el precio de un paquete entre sus unidades, y ahí el
    // redondeo dejaba la venta trabada por medio centavo.
    if (min != null && min > 0 && precio < min - 0.01) {
      throw new BadRequestException(
        `${nombre} no se puede vender a ${precio.toFixed(2)}: el precio mínimo es ${min.toFixed(2)}.`,
      );
    }
    if (max != null && max > 0 && precio > max + 0.01) {
      throw new BadRequestException(
        `${nombre} no se puede vender a ${precio.toFixed(2)}: el precio máximo es ${max.toFixed(2)}.`,
      );
    }
  }
}
