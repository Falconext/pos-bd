import { BadRequestException } from '@nestjs/common';
import { ComprobanteService } from './comprobante.service';

// expandirKitsParaStock decide qué productos salen (o vuelven) del stock cuando
// se vende un kit como una línea. Se prueba directo, con solo el combo en Prisma.
describe('kit con productos quitados → stock', () => {
  const combo = {
    id: 7,
    nombre: 'DETALLE TE AMO',
    items: [
      { productoId: 1, cantidad: 12 },
      { productoId: 2, cantidad: 1 },
      { productoId: 3, cantidad: 1 },
    ],
  };
  const service: any = Object.create(ComprobanteService.prototype);
  service.prisma = { combo: { findMany: jest.fn().mockResolvedValue([combo]) } };
  const expandir = (detalles: any[], opciones?: any) => service.expandirKitsParaStock(detalles, 1, opciones);

  it('kit completo descuenta todos sus productos', async () => {
    const r = await expandir([{ productoId: null, comboId: 7, cantidad: 2 }]);
    expect(r.map((d: any) => [d.productoId, d.cantidad])).toEqual([[1, 24], [2, 2], [3, 2]]);
  });

  it('lo quitado no sale del stock', async () => {
    const r = await expandir([{ productoId: null, comboId: 7, cantidad: 2, kitQuitados: [3] }]);
    expect(r.map((d: any) => [d.productoId, d.cantidad])).toEqual([[1, 24], [2, 2]]);
  });

  it('no deja vender un kit sin ningún producto', async () => {
    await expect(expandir([{ productoId: null, comboId: 7, cantidad: 1, kitQuitados: [1, 2, 3] }])).rejects.toThrow(BadRequestException);
  });

  it('al editar, un kit borrado del catálogo no bloquea', async () => {
    service.prisma.combo.findMany.mockResolvedValueOnce([]);
    const r = await expandir([{ productoId: null, comboId: 9, cantidad: 1 }, { productoId: 5, cantidad: 1 }], { ignorarKitsInexistentes: true });
    expect(r.map((d: any) => d.productoId)).toEqual([5]);
  });
});
