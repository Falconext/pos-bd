import { leerVenta, tipoQueCorresponde } from './entrada-venta';

const base = { items: [{ product_id: 1, quantity: 2 }], payment: { method: 'card' } };

const error = (body: any) => {
  try {
    leerVenta(body);
  } catch (e: any) {
    return e.getResponse();
  }
  throw new Error('se esperaba un error');
};

describe('leerVenta', () => {
  it('lee una venta simple y traduce el medio de pago al del POS', () => {
    const v = leerVenta({ ...base, payment: { method: 'yape', reference: 'OP-1' }, external_id: 'WEB-1' });
    expect(v.items).toEqual([{ productoId: 1, sku: undefined, codigoBarras: undefined, descripcion: undefined, cantidad: 2, precio: undefined, lote: undefined }]);
    expect(v.medioPago).toBe('YAPE');
    expect(v.referenciaPago).toBe('OP-1');
    expect(v.externalId).toBe('WEB-1');
  });

  it('el envío va como ítem libre con descripción y precio', () => {
    const v = leerVenta({ ...base, items: [...base.items, { description: 'Envío', quantity: 1, unit_price: 10 }] });
    expect(v.items[1]).toMatchObject({ descripcion: 'Envío', precio: 10 });
  });

  it('un ítem libre sin precio no pasa', () => {
    expect(error({ ...base, items: [...base.items, { description: 'Envío', quantity: 1 }] }).message).toMatch(/unit_price/);
  });

  it('solo ítems libres no es una venta del catálogo', () => {
    expect(error({ ...base, items: [{ description: 'Envío', quantity: 1, unit_price: 10 }] }).message).toMatch(/al menos un producto/);
  });

  it('un ítem identifica el producto de una sola forma', () => {
    expect(error({ ...base, items: [{ product_id: 1, sku: 'A', quantity: 1 }] }).message).toMatch(/uno solo/);
  });

  it('sin identificar ni describir, explica las dos opciones', () => {
    expect(error({ ...base, items: [{ quantity: 1 }] }).message).toMatch(/product_id.*description/);
  });

  it('factura exige RUC', () => {
    expect(error({ ...base, document_type: 'invoice' }).param).toBe('customer.document_type');
    expect(error({ ...base, document_type: 'invoice', customer: { document_type: 'dni', document_number: '47065472', name: 'X' } }).message).toMatch(/RUC/);
  });

  it('valida DNI y RUC', () => {
    expect(error({ ...base, customer: { document_type: 'dni', document_number: '123', name: 'X' } }).message).toMatch(/8 dígitos/);
    expect(error({ ...base, customer: { document_type: 'ruc', document_number: '30123456789', name: 'X' } }).message).toMatch(/11 dígitos/);
  });

  it('con documento pide el nombre', () => {
    expect(error({ ...base, customer: { document_type: 'dni', document_number: '47065472' } }).param).toBe('customer.name');
  });

  it('con RUC y sin decir el tipo, sale factura; si no, boleta', () => {
    const conRuc = leerVenta({ ...base, customer: { document_type: 'ruc', document_number: '20123456789', name: 'ACME SAC' } });
    expect(tipoQueCorresponde(conRuc)).toBe('invoice');
    expect(tipoQueCorresponde(leerVenta(base))).toBe('receipt');
    expect(tipoQueCorresponde(leerVenta({ ...base, document_type: 'sales_note' }))).toBe('sales_note');
  });

  it('sin documento el cliente queda sin documento aunque mande nombre', () => {
    const v = leerVenta({ ...base, customer: { document_type: 'none', name: 'Ana' } });
    expect(v.cliente).toMatchObject({ tipoDocumento: undefined, numero: undefined, nombre: 'Ana' });
  });

  it('el medio de pago es obligatorio y de la lista', () => {
    expect(error({ items: base.items }).param).toBe('payment');
    expect(error({ ...base, payment: { method: 'bitcoin' } }).message).toMatch(/cash, card, yape, plin, transfer/);
  });

  it('pistas para lo que se manda en otro lado', () => {
    expect(error({ ...base, total: 10 }).message).toMatch(/lo calcula Krezka/);
    expect(error({ ...base, items: [{ product_id: 1, quantity: 1, discount: 2 }] }).message).toMatch(/unit_price/);
    expect(error({ ...base, items: [{ product_id: 1, quantity: 1, variant_id: 2 }] }).message).toMatch(/variants/);
    expect(error({ ...base, payment: { method: 'card', installments: 3 } }).message).toMatch(/contado/);
  });

  it('cantidad: número, mayor que cero, hasta 3 decimales', () => {
    expect(error({ ...base, items: [{ product_id: 1, quantity: '2' }] }).message).toMatch(/sin comillas/);
    expect(error({ ...base, items: [{ product_id: 1, quantity: 0 }] }).param).toBe('items[0].quantity');
    expect(error({ ...base, items: [{ product_id: 1, quantity: 1.2345 }] }).message).toMatch(/3 decimales/);
  });

  it('el lote viaja en mayúsculas y no aplica a ítems libres', () => {
    expect(leerVenta({ ...base, items: [{ product_id: 1, quantity: 1, batch: 'l-1' }] }).items[0].lote).toBe('L-1');
    expect(error({ ...base, items: [...base.items, { description: 'Envío', quantity: 1, unit_price: 5, batch: 'X' }] }).message).toMatch(/no tiene lote/);
  });
});
