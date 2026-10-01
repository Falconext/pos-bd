/**
 * Qué puede ofrecer el punto de venta.
 *
 * El reporte que lo origina: un empresario desactivó un producto porque su
 * cliente no quería que se viera, y el producto siguió apareciendo para vender
 * en /facturacion/nuevo. No era su error: el listado traía los desactivados.
 *
 * Lo que más importa acá es que el arreglo NO le saque los desactivados al
 * Kardex: si desaparecieran del panel, no habría forma de volver a activarlos.
 */
import {
  ESTADOS_EN_INVENTARIO,
  ESTADOS_VENDIBLES,
  estadosAListar,
  sePuedeVender,
} from './vendibilidad';

describe('El POS solo ofrece lo activo', () => {
  it('con soloVendibles pide únicamente ACTIVO', () => {
    expect(estadosAListar(true)).toEqual(['ACTIVO']);
  });

  it('un producto desactivado ya no se puede vender', () => {
    // Es el defecto reportado: antes esto daba true.
    expect(sePuedeVender({ estado: 'INACTIVO' })).toBe(false);
  });

  it('un producto activo sí', () => {
    expect(sePuedeVender({ estado: 'ACTIVO' })).toBe(true);
  });
});

describe('El Kardex sigue viendo los desactivados', () => {
  it('sin soloVendibles trae ACTIVO e INACTIVO', () => {
    // Si esto cambiara, el producto desaparecería del panel y el empresario
    // no podría reactivarlo nunca.
    expect(estadosAListar(false)).toEqual(['ACTIVO', 'INACTIVO']);
    expect(estadosAListar(undefined)).toEqual(['ACTIVO', 'INACTIVO']);
  });

  it('las dos listas no son la misma', () => {
    expect(ESTADOS_VENDIBLES).not.toEqual(ESTADOS_EN_INVENTARIO);
    expect(ESTADOS_EN_INVENTARIO).toContain('INACTIVO');
    expect(ESTADOS_VENDIBLES).not.toContain('INACTIVO');
  });

  it('ni PLACEHOLDER ni ELIMINADO entran a ninguna', () => {
    for (const lista of [ESTADOS_VENDIBLES, ESTADOS_EN_INVENTARIO]) {
      expect(lista).not.toContain('PLACEHOLDER');
      expect(lista).not.toContain('ELIMINADO');
    }
    expect(sePuedeVender({ estado: 'PLACEHOLDER' })).toBe(false);
    expect(sePuedeVender({ estado: 'ELIMINADO' })).toBe(false);
  });
});

describe('Los tres candados de la venta', () => {
  it('basta que esté desactivado', () => {
    expect(sePuedeVender({
      estado: 'INACTIVO', visibleEnSede: true, vendibleEnSede: true,
    })).toBe(false);
  });

  it('basta que no esté asignado a la sede', () => {
    expect(sePuedeVender({
      estado: 'ACTIVO', visibleEnSede: false, vendibleEnSede: true,
    })).toBe(false);
  });

  it('basta que tenga "Permite vender" apagado', () => {
    // Esta casilla existía en el editor pero escribía en un campo que nadie
    // leía: 0 de 42,064 filas lo tenían apagado en producción.
    expect(sePuedeVender({
      estado: 'ACTIVO', visibleEnSede: true, vendibleEnSede: false,
    })).toBe(false);
  });

  it('con los tres abiertos, se vende', () => {
    expect(sePuedeVender({
      estado: 'ACTIVO', visibleEnSede: true, vendibleEnSede: true,
    })).toBe(true);
  });
});

describe('Filas de stock viejas, sin las banderas', () => {
  it('ausente significa "sí", como se comportaba antes', () => {
    // Hay filas anteriores a que existieran estos campos; no se les puede
    // cortar la venta por un dato que nunca tuvieron.
    expect(sePuedeVender({ estado: 'ACTIVO' })).toBe(true);
    expect(sePuedeVender({ estado: 'ACTIVO', visibleEnSede: null, vendibleEnSede: null })).toBe(true);
  });

  it('sin estado no se vende: no se asume que está activo', () => {
    expect(sePuedeVender({})).toBe(false);
    expect(sePuedeVender({ estado: null })).toBe(false);
  });
});
