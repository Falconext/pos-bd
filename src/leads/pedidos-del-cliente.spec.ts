import { contextoPedidosDelCliente } from './pedidos-del-cliente';

describe('pedidos en curso del cliente en el contexto del bot', () => {
  it('sin pedidos no agrega nada', () => {
    expect(contextoPedidosDelCliente([])).toBe('');
  });

  it('venta a mano con Shalom en agencia y saldo', () => {
    const t = contextoPedidosDelCliente([
      {
        serie: 'NV01',
        correlativo: 25,
        fechaEmision: new Date('2026-10-20T17:00:00Z'),
        total: 120,
        saldo: 60,
        productos: ['Moringa 90 cápsulas x 2', 'Glucora x 1'],
        despacho: { estado: 'EN_AGENCIA', transportista: 'SHALOM_PRO', agenciaDestino: 'Pichanaki', codigoGuia: '100747124' },
      },
    ]);
    expect(t).toContain('NV01-00000025');
    expect(t).toContain('falta pagar S/ 60.00');
    expect(t).toContain('envío por Shalom: esperando en la agencia para que lo recoja (agencia Pichanaki), guía 100747124');
    expect(t).toContain('No le vuelvas a cotizar');
  });

  it('pagado y sin envío', () => {
    const t = contextoPedidosDelCliente([
      { serie: 'B001', correlativo: 3, fechaEmision: new Date('2026-10-22T17:00:00Z'), total: 59.9, saldo: 0, productos: ['Té verde'] },
    ]);
    expect(t).toContain('total S/ 59.90; pagado.');
  });

  it('con repartidor y sus formas de pago (Hierba Sana 24-10)', () => {
    const t = contextoPedidosDelCliente([
      {
        serie: 'NV01', correlativo: 4, fechaEmision: new Date('2026-10-23T17:00:00Z'), total: 71, saldo: 71, productos: ['Miel x 1'],
        despacho: { estado: 'EN_CAMINO', transportista: 'PROPIOS', repartidor: 'Stiven León (cel. 920 450 428)', formasDePago: 'Yape 955 947 892 o ZIPAGO; no en efectivo' },
      },
    ]);
    expect(t).toContain('envío por reparto propio: en camino, lo lleva Stiven León (cel. 920 450 428)');
    expect(t).toContain('formas de pago al recibir: Yape 955 947 892 o ZIPAGO; no en efectivo');
  });
});
