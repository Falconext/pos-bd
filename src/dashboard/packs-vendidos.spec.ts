import { agruparPacksVendidos, ComboInfo, LineaPack } from './packs-vendidos';

const combo = (id: number, nombre: string, activo = true): ComboInfo => ({
  id,
  nombre,
  imagenUrl: null,
  activo,
  precioCombo: 100,
});

const linea = (p: Partial<LineaPack>): LineaPack => ({
  comboId: 1,
  comprobanteId: 1,
  tipoDoc: '03',
  cantidad: 1,
  mtoPrecioUnitario: 100,
  tipoMoneda: 'PEN',
  tipoCambio: null,
  fechaEmision: new Date('2026-10-10T15:00:00Z'),
  ...p,
});

describe('agruparPacksVendidos', () => {
  it('ordena por packs vendidos y cuenta ventas distintas', () => {
    const r = agruparPacksVendidos(
      [
        linea({ comboId: 1, comprobanteId: 10, cantidad: 2 }),
        linea({ comboId: 2, comprobanteId: 11, cantidad: 1 }),
        linea({ comboId: 2, comprobanteId: 12, cantidad: 3 }),
      ],
      [combo(1, 'Pack peluche'), combo(2, 'Ramo de rosas')],
    );
    expect(r.map((x) => [x.nombre, x.cantidad, x.ventas])).toEqual([
      ['Ramo de rosas', 4, 2],
      ['Pack peluche', 2, 1],
    ]);
    expect(r[0].participacion).toBe(66.7);
    expect(r[0].total).toBe(400);
  });

  it('el pack activo que no se vendió sale con cero; el inactivo sin ventas, no', () => {
    const r = agruparPacksVendidos([linea({ comboId: 1 })], [combo(1, 'A'), combo(2, 'B'), combo(3, 'C', false)]);
    expect(r.map((x) => [x.nombre, x.cantidad])).toEqual([
      ['A', 1],
      ['B', 0],
    ]);
  });

  it('una devolución parcial con nota de crédito resta packs y plata', () => {
    const r = agruparPacksVendidos(
      [
        linea({ comprobanteId: 10, cantidad: 3 }),
        linea({ comprobanteId: 20, tipoDoc: '07', cantidad: 1 }),
      ],
      [combo(1, 'A')],
    );
    expect(r[0]).toMatchObject({ cantidad: 2, total: 200, ventas: 1 });
  });

  it('una venta en dólares se suma en soles con su tipo de cambio', () => {
    const r = agruparPacksVendidos(
      [linea({ mtoPrecioUnitario: 10, tipoMoneda: 'USD', tipoCambio: 3.8 })],
      [combo(1, 'A')],
    );
    expect(r[0].total).toBe(38);
  });

  it('la última venta es la más reciente', () => {
    const r = agruparPacksVendidos(
      [
        linea({ comprobanteId: 1, fechaEmision: new Date('2026-10-01T15:00:00Z') }),
        linea({ comprobanteId: 2, fechaEmision: new Date('2026-10-15T15:00:00Z') }),
      ],
      [combo(1, 'A')],
    );
    expect(r[0].ultimaVenta?.toISOString()).toBe('2026-10-15T15:00:00.000Z');
  });
});
