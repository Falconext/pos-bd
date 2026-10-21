import { resolverDespachoAgrupado } from './despacho-agrupado';

describe('nota que va en el envío de otra', () => {
  it('toma el despacho compartido y dice en qué nota viaja', () => {
    const n: any = resolverDespachoAgrupado({
      envioDespacho: null,
      despachoAgrupado: { despacho: { id: 9, estado: 'EN_CAMINO', comprobanteId: 50, comprobante: { serie: 'NV01', correlativo: 93 } } },
    });
    expect(n.envioDespacho).toEqual({ id: 9, estado: 'EN_CAMINO', comprobanteId: 50, agrupadoEn: 'NV01-00000093' });
  });
  it('si tiene su propio despacho, no se toca', () => {
    const propio = { id: 1, estado: 'PREPARANDO' };
    expect(resolverDespachoAgrupado({ envioDespacho: propio, despachoAgrupado: { despacho: { id: 9 } } }).envioDespacho).toBe(propio);
  });
});
