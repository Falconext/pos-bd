/**
 * Qué se borra al recalcular las comisiones de un vendedor.
 *
 * Nace de IMPORTEMOS JUNTOS: Fátima apareció con S/0 pese a tener 195 ventas.
 * La secuencia de ids de ComisionVendedor arrancaba en 2868 con 387 filas — o
 * sea que 2.867 comisiones existieron y fueron borradas.
 *
 * El recálculo borraba las pendientes de TODOS los comprobantes del vendedor y
 * después creaba las que hubiera calculado. Si no calculaba ninguna, el
 * borrado ya había ocurrido: un clic en "guardar usuario" podía vaciar meses de
 * comisiones sin aviso y sin dejar rastro.
 */
import { comprobantesAReemplazar } from './recalculo-comisiones';

describe('El recálculo solo borra lo que reemplaza', () => {
  it('sin comisiones nuevas no borra nada', () => {
    // EL DEFECTO: acá el borrado ya se había ejecutado y el histórico se perdía.
    expect(comprobantesAReemplazar([])).toEqual([]);
  });

  it('borra solo los comprobantes que reciben comisión nueva', () => {
    expect(comprobantesAReemplazar([{ comprobanteId: 10 }, { comprobanteId: 12 }]))
      .toEqual([10, 12]);
  });

  it('un comprobante con varias líneas se borra una sola vez', () => {
    // Una venta de tres productos genera tres comisiones del mismo comprobante.
    expect(comprobantesAReemplazar([
      { comprobanteId: 7 }, { comprobanteId: 7 }, { comprobanteId: 7 },
    ])).toEqual([7]);
  });

  it('un recálculo parcial no toca los comprobantes que no pudo calcular', () => {
    // Si el producto de la venta 99 perdió su comisión, esa venta conserva la
    // que tenía: preferible desactualizada a borrada, porque la desactualizada
    // se ve y se corrige.
    const reemplazados = comprobantesAReemplazar([{ comprobanteId: 5 }, { comprobanteId: 6 }]);
    expect(reemplazados).not.toContain(99);
  });

  it('tolera entradas vacías sin reventar la edición del usuario', () => {
    expect(comprobantesAReemplazar(undefined as any)).toEqual([]);
    expect(comprobantesAReemplazar(null as any)).toEqual([]);
  });

  it('normaliza el id aunque llegue como texto', () => {
    expect(comprobantesAReemplazar([{ comprobanteId: '4' as any }])).toEqual([4]);
  });
});
