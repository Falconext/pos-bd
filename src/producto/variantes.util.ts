import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export type VarianteConfig = {
  valoresAtributos: Record<string, string>;
  codigo?: string;
  precioUnitario?: number;
  stock?: number;
  imagenUrl?: string | null;
  codigoBarras?: string | null;
  estado?: 'ACTIVO' | 'INACTIVO';
};

export function generarCombinacionesVariantes(opcionesAtributos: any[]): any[] {
  if (!opcionesAtributos || opcionesAtributos.length === 0) return [];

  const results: any[] = [];

  function helper(arr: any[], idx: number, currentCombo: any) {
    if (idx === arr.length) {
      if (Object.keys(currentCombo).length > 0) {
        results.push({ ...currentCombo });
      }
      return;
    }
    const opcion = arr[idx];
    if (!opcion.nombre || !opcion.valores || opcion.valores.length === 0) {
      helper(arr, idx + 1, currentCombo);
    } else {
      for (const val of opcion.valores) {
        helper(arr, idx + 1, { ...currentCombo, [opcion.nombre]: val });
      }
    }
  }

  helper(opcionesAtributos, 0, {});
  return results;
}

const comboKey = (combo: Record<string, string>) =>
  Object.entries(combo)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');

const normalizeCodeToken = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 4)
    .toUpperCase();

const hasOwn = (value: unknown, key: string) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, key),
  );

const normalizeNullableStringUpdate = (value: unknown) => {
  if (typeof value !== 'string') return value === null ? null : undefined;
  const clean = value.trim();
  return clean ? clean : null;
};

export async function sincronizarVariantes(
  prisma: PrismaClient,
  productoPadre: any,
  sedes: any[],
  variantesConfig: VarianteConfig[] = [],
  sedeConStockId?: number,
) {
  if (!productoPadre.opcionesAtributos) return;

  const combinaciones = generarCombinacionesVariantes(
    productoPadre.opcionesAtributos as any[],
  );
  if (combinaciones.length === 0) return;

  // Buscar variantes existentes
  const variantesActuales = await prisma.producto.findMany({
    where: { productoPadreId: productoPadre.id },
  });
  const configByKey = new Map(
    variantesConfig.map((config) => [
      comboKey(config.valoresAtributos || {}),
      config,
    ]),
  );
  const combinacionesKeys = new Set(
    combinaciones.map((combo) => comboKey(combo)),
  );
  const sedePrincipalId = sedes.find((s) => s.esPrincipal)?.id;
  const stockSedeId = sedeConStockId ?? sedePrincipalId ?? sedes[0]?.id;

  for (const combo of combinaciones) {
    const currentKey = comboKey(combo);
    const config = configByKey.get(currentKey);
    // Checar si existe
    const existe = variantesActuales.find((v) => {
      if (!v.valoresAtributos) return false;
      // comparar keys y values
      const valAttr = v.valoresAtributos as any;
      return (
        Object.keys(combo).every((k) => valAttr[k] === combo[k]) &&
        Object.keys(valAttr).every((k) => valAttr[k] === combo[k])
      );
    });

    // Si no llega config para esta combinación, NO resetear el precio al del padre:
    // preservar el precio de la variante existente (evita aplanar precios por payloads incompletos).
    const precioUnitario =
      config?.precioUnitario != null
        ? Number(config.precioUnitario)
        : existe
          ? Number(
              (existe as any).precioUnitario ?? productoPadre.precioUnitario,
            )
          : Number(productoPadre.precioUnitario);
    const valorUnitario = Number(
      (
        precioUnitario /
        (1 + Number(productoPadre.igvPorcentaje || 18) / 100)
      ).toFixed(2),
    );
    // Si no llega config para esta combinación, NO resetear el stock a 0:
    // preservar el stock de la variante existente (evita borrar stock por payloads incompletos).
    const stock =
      config?.stock != null
        ? Number(config.stock)
        : existe
          ? Number((existe as any).stock ?? 0)
          : 0;
    const codigoSugerido = `${productoPadre.codigo}-${Object.values(combo)
      .map((value) => normalizeCodeToken(String(value)))
      .filter(Boolean)
      .join('-')}`;
    const codigo = String(config?.codigo || codigoSugerido).slice(0, 60);
    const descripcion = `${productoPadre.descripcion} - ${Object.values(combo).join(' / ')}`;

    const data = {
      codigo,
      descripcion,
      unidadMedidaId: productoPadre.unidadMedidaId,
      tipoAfectacionIGV: productoPadre.tipoAfectacionIGV,
      precioUnitario: new Decimal(precioUnitario),
      valorUnitario: new Decimal(valorUnitario),
      igvPorcentaje: productoPadre.igvPorcentaje,
      categoriaId: productoPadre.categoriaId,
      marcaId: productoPadre.marcaId,
      estado: config?.estado || 'ACTIVO',
      stock,
      valoresAtributos: combo,
      porcentajeVenta: productoPadre.porcentajeVenta,
      porcentajeProvision: productoPadre.porcentajeProvision,
      imagenUrl: hasOwn(config, 'imagenUrl')
        ? normalizeNullableStringUpdate(config?.imagenUrl)
        : undefined,
      codigoBarras: hasOwn(config, 'codigoBarras')
        ? normalizeNullableStringUpdate(config?.codigoBarras)
        : undefined,
      publicarEnTienda: productoPadre.publicarEnTienda ?? true,
    };

    let varianteId = existe?.id;
    if (!existe) {
      // Crear nueva variante
      const nuevaVar = await prisma.producto.create({
        data: {
          empresaId: productoPadre.empresaId,
          productoPadreId: productoPadre.id,
          ...data,
        },
      });
      varianteId = nuevaVar.id;
    } else {
      await prisma.producto.update({
        where: { id: existe.id },
        data,
      });
    }

    if (varianteId && sedes.length > 0) {
      await Promise.all(
        sedes.map((s) =>
          prisma.productoStock.upsert({
            where: {
              productoId_sedeId: { productoId: varianteId, sedeId: s.id },
            },
            update: {
              stock: s.id === stockSedeId ? stock : 0,
              stockMinimo: 0,
            },
            create: {
              productoId: varianteId,
              sedeId: s.id,
              stock: s.id === stockSedeId ? stock : 0,
              stockMinimo: 0,
            },
          }),
        ),
      );
    }
  }

  const variantesFueraDeMatriz = variantesActuales.filter((variante) => {
    if (!variante.valoresAtributos) return false;
    return !combinacionesKeys.has(comboKey(variante.valoresAtributos as any));
  });
  if (variantesFueraDeMatriz.length > 0) {
    await prisma.producto.updateMany({
      where: {
        id: { in: variantesFueraDeMatriz.map((variante) => variante.id) },
      },
      data: { estado: 'INACTIVO' },
    });
  }

  if (variantesConfig.length > 0) {
    const stockTotal = variantesConfig.reduce(
      (sum, config) => sum + Number(config.stock || 0),
      0,
    );
    await prisma.producto.update({
      where: { id: productoPadre.id },
      data: { stock: stockTotal },
    });
    if (stockSedeId) {
      await prisma.productoStock.upsert({
        where: {
          productoId_sedeId: {
            productoId: productoPadre.id,
            sedeId: stockSedeId,
          },
        },
        update: { stock: stockTotal },
        create: {
          productoId: productoPadre.id,
          sedeId: stockSedeId,
          stock: stockTotal,
          stockMinimo: 0,
        },
      });
      await prisma.productoStock.updateMany({
        where: {
          productoId: productoPadre.id,
          sedeId: { not: stockSedeId },
        },
        data: { stock: 0 },
      });
    }
  }
}
