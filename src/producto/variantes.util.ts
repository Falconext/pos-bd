import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

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

export async function sincronizarVariantes(prisma: PrismaClient, productoPadre: any, sedes: any[]) {
    if (!productoPadre.opcionesAtributos) return;
    
    const combinaciones = generarCombinacionesVariantes(productoPadre.opcionesAtributos as any[]);
    if (combinaciones.length === 0) return;

    // Buscar variantes existentes
    const variantesActuales = await prisma.producto.findMany({
        where: { productoPadreId: productoPadre.id }
    });

    for (const combo of combinaciones) {
        // Checar si existe
        const existe = variantesActuales.find(v => {
            if (!v.valoresAtributos) return false;
            // comparar keys y values
            const valAttr = v.valoresAtributos as any;
            return Object.keys(combo).every(k => valAttr[k] === combo[k]) &&
                   Object.keys(valAttr).every(k => valAttr[k] === combo[k]);
        });

        if (!existe) {
            // Crear nueva variante
            // Generar codigo
            const count = await prisma.producto.count({ where: { empresaId: productoPadre.empresaId } });
            const codigoUnico = `${productoPadre.codigo}-V${count + 1}`;

            const nuevaVar = await prisma.producto.create({
                data: {
                    empresaId: productoPadre.empresaId,
                    productoPadreId: productoPadre.id,
                    codigo: codigoUnico,
                    descripcion: `${productoPadre.descripcion} - ${Object.values(combo).join(' ')}`,
                    unidadMedidaId: productoPadre.unidadMedidaId,
                    tipoAfectacionIGV: productoPadre.tipoAfectacionIGV,
                    precioUnitario: productoPadre.precioUnitario,
                    valorUnitario: productoPadre.valorUnitario,
                    igvPorcentaje: productoPadre.igvPorcentaje,
                    categoriaId: productoPadre.categoriaId,
                    marcaId: productoPadre.marcaId,
                    estado: 'ACTIVO',
                    stock: 0,
                    valoresAtributos: combo,
                    porcentajeVenta: productoPadre.porcentajeVenta,
                    porcentajeProvision: productoPadre.porcentajeProvision,
                }
            });

            if (sedes.length > 0) {
                await prisma.productoStock.createMany({
                    data: sedes.map(s => ({
                        productoId: nuevaVar.id,
                        sedeId: s.id,
                        stock: 0,
                        stockMinimo: 0,
                    }))
                });
            }
        }
    }
}
