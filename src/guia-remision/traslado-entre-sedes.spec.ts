import { BadRequestException } from '@nestjs/common';
import { esTrasladoEntreSedes, firmaTraslado, itemsDelTraslado } from './traslado-entre-sedes';

describe('traslado entre sedes (guía motivo 04)', () => {
  it('solo es traslado con motivo 04 y las dos sedes', () => {
    expect(esTrasladoEntreSedes({ tipoTraslado: '04', sedeOrigenId: 1, sedeDestinoId: 2 })).toBe(true);
    expect(esTrasladoEntreSedes({ tipoTraslado: '04', sedeOrigenId: 1 })).toBe(false);
    expect(esTrasladoEntreSedes({ tipoTraslado: '01', sedeOrigenId: 1, sedeDestinoId: 2 })).toBe(false);
    expect(esTrasladoEntreSedes({ tipoTraslado: '04', sedeOrigenId: null, sedeDestinoId: 2 })).toBe(false);
  });

  it('suma líneas repetidas del mismo producto', () => {
    expect(
      itemsDelTraslado([
        { productoId: 5, cantidad: '2' },
        { productoId: 3, cantidad: 1 },
        { productoId: 5, cantidad: 1.5 },
      ]),
    ).toEqual([
      { productoId: 3, cantidad: 1 },
      { productoId: 5, cantidad: 3.5 },
    ]);
  });

  it('rechaza ítems libres, cantidades en cero y guías vacías', () => {
    expect(() => itemsDelTraslado([{ productoId: null, cantidad: 1, descripcion: 'Flete' }])).toThrow(/Flete/);
    expect(() => itemsDelTraslado([{ productoId: 1, cantidad: 0 }])).toThrow(BadRequestException);
    expect(() => itemsDelTraslado([])).toThrow(BadRequestException);
  });

  it('la firma no cambia si la edición no toca sedes ni productos', () => {
    const g = { tipoTraslado: '04', sedeOrigenId: 1, sedeDestinoId: 2 };
    const a = firmaTraslado(g, [{ productoId: 5, cantidad: 2 }]);
    expect(firmaTraslado(g, [{ productoId: 5, cantidad: '2' }])).toBe(a);
    expect(firmaTraslado(g, [{ productoId: 5, cantidad: 3 }])).not.toBe(a);
    expect(firmaTraslado({ ...g, sedeDestinoId: 3 }, [{ productoId: 5, cantidad: 2 }])).not.toBe(a);
    expect(firmaTraslado({ ...g, tipoTraslado: '01' }, [{ productoId: 5, cantidad: 2 }])).toBeNull();
  });
});

describe('esAnexoSunat', () => {
  it('solo 4 dígitos', () => {
    const { esAnexoSunat } = require('./traslado-entre-sedes');
    expect(esAnexoSunat('0001')).toBe(true);
    expect(esAnexoSunat(' 0000 ')).toBe(true);
    expect(esAnexoSunat('001')).toBe(false);
    expect(esAnexoSunat('NORTE')).toBe(false);
    expect(esAnexoSunat(null)).toBe(false);
  });
});
