import { BadRequestException } from '@nestjs/common';
import { validarLimitesPrecioVenta } from './limites-precio-venta';

/**
 * Piso y techo de venta.
 *
 * El POS ya avisa al editar la línea, pero esa validación es de comodidad: un
 * vendedor con permiso para tocar precios puede mandar cualquier número por la
 * API, y "se vendió bajo costo" recién se descubre al cuadrar el mes.
 */
describe('Límites de precio de venta', () => {
  const prismaCon = (productos: any[]) =>
    ({ producto: { findMany: async () => productos } }) as any;

  const yogurt = {
    id: 8403,
    descripcion: 'Yogurt Laive durazno',
    precioMinimoVenta: 5,
    precioMaximoVenta: 12,
    tipoAfectacionIGV: '10', // gravado
    igvPorcentaje: 18,
  };

  // El POS manda el VALOR unitario (sin IGV); el límite está expresado como
  // precio de venta (con IGV), así que el helper arma la línea al revés.
  const linea = (precioVenta: number, productoId = 8403) => ({
    productoId,
    nuevoValorUnitario: precioVenta / 1.18,
  });

  it('deja pasar un precio dentro del rango', async () => {
    await expect(
      validarLimitesPrecioVenta(prismaCon([yogurt]), 23, [linea(8)]),
    ).resolves.toBeUndefined();
  });

  it('rechaza por debajo del mínimo', async () => {
    await expect(
      validarLimitesPrecioVenta(prismaCon([yogurt]), 23, [linea(3)]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza por encima del máximo', async () => {
    await expect(
      validarLimitesPrecioVenta(prismaCon([yogurt]), 23, [linea(20)]),
    ).rejects.toThrow(BadRequestException);
  });

  it('el mensaje dice el producto y el límite, no solo "precio inválido"', async () => {
    // Si no, el cajero no sabe a cuánto SÍ puede venderlo.
    await expect(
      validarLimitesPrecioVenta(prismaCon([yogurt]), 23, [linea(3)]),
    ).rejects.toThrow(/Yogurt Laive durazno.*5\.00/s);
  });

  it('acepta los bordes exactos', async () => {
    await expect(
      validarLimitesPrecioVenta(prismaCon([yogurt]), 23, [linea(5), linea(12)]),
    ).resolves.toBeUndefined();
  });

  it('tolera un centavo: el precio de un pack repartido entre unidades redondea', async () => {
    // 38 / 6 = 6.333…; con tolerancia cero una venta legítima quedaba trabada.
    await expect(
      validarLimitesPrecioVenta(prismaCon([yogurt]), 23, [linea(4.995)]),
    ).resolves.toBeUndefined();
  });

  it('un producto exonerado no suma IGV al comparar', async () => {
    // Si se le sumara 18% al valor, una venta al mínimo exacto pasaría por
    // encima del máximo sin motivo.
    const exonerado = { ...yogurt, tipoAfectacionIGV: '20' };
    await expect(
      validarLimitesPrecioVenta(prismaCon([exonerado]), 23, [
        { productoId: 8403, nuevoValorUnitario: 12 } as any,
      ]),
    ).resolves.toBeUndefined();
  });

  it('respeta un IGV distinto de 18 si la empresa lo tiene configurado', async () => {
    const conIgv10 = { ...yogurt, igvPorcentaje: 10, precioMaximoVenta: 11 };
    await expect(
      validarLimitesPrecioVenta(prismaCon([conIgv10]), 23, [
        { productoId: 8403, nuevoValorUnitario: 10 } as any, // 10 * 1.10 = 11
      ]),
    ).resolves.toBeUndefined();
  });

  it('un producto sin límites no restringe nada', async () => {
    const libre = { ...yogurt, precioMinimoVenta: null, precioMaximoVenta: null };
    await expect(
      validarLimitesPrecioVenta(prismaCon([libre]), 23, [linea(0.01)]),
    ).resolves.toBeUndefined();
  });

  it('ignora las líneas sin producto de catálogo (ítem libre, servicio suelto)', async () => {
    await expect(
      validarLimitesPrecioVenta(prismaCon([]), 23, [
        { descripcion: 'Instalación', mtoPrecioUnitario: 1 } as any,
      ]),
    ).resolves.toBeUndefined();
  });

  it('ignora un producto de otra empresa: findMany ya lo filtró', async () => {
    // El filtro por empresaId vive en la consulta; si no vuelve, no se valida
    // (y tampoco se filtra información de la otra empresa en el mensaje).
    await expect(
      validarLimitesPrecioVenta(prismaCon([]), 23, [linea(1, 999999)]),
    ).resolves.toBeUndefined();
  });

  it('sin líneas no consulta nada', async () => {
    const prisma = {
      producto: {
        findMany: async () => {
          throw new Error('no debería consultarse');
        },
      },
    } as any;
    await expect(
      validarLimitesPrecioVenta(prisma, 23, []),
    ).resolves.toBeUndefined();
  });

  it('cae a `precioUnitario` cuando la ruta no manda valor sin IGV (sync, importación)', async () => {
    await expect(
      validarLimitesPrecioVenta(prismaCon([yogurt]), 23, [
        { productoId: 8403, precioUnitario: 2 } as any,
      ]),
    ).rejects.toThrow(BadRequestException);
  });
});
