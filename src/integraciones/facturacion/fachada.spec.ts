/**
 * La aduana entre el contrato público y la emisión interna.
 *
 * Casi todo lo que se prueba acá es validación de entrada, y la razón es una:
 * un comprobante que SUNAT rechaza ya consumió un correlativo y ya se le dijo
 * al usuario del integrador que se emitió. Detenerlo antes con un mensaje que
 * diga qué cambiar vale más que cualquier reintento.
 */
import {
  ErrorDeContrato,
  aDosDecimales,
  clienteNormalizado,
  totalEstimado,
  traducirComprobante,
  traducirItem,
  traducirPago,
  validarCliente,
} from './fachada';

const CLIENTE_RUC = {
  document_type: 'ruc',
  document_number: '20601234567',
  name: 'COMERCIAL ANDINA S.A.C.',
};
const ITEM = { description: 'Consultoría', quantity: 2, unit_value: 500 };
const RESUELTO = { clienteId: 7, tipoOperacionId: 1 };

const base = (extra: any = {}) => ({
  document_type: 'invoice',
  customer: CLIENTE_RUC,
  items: [ITEM],
  ...extra,
});

/** Atrapa el error de contrato y devuelve su código y parámetro. */
const falla = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorDeContrato) return { codigo: e.codigo, param: e.parametro, msg: e.message };
    throw e;
  }
  throw new Error('se esperaba un ErrorDeContrato y no hubo ninguno');
};

describe('qué documento se emite', () => {
  it('invoice es factura (01) y receipt es boleta (03)', () => {
    expect(traducirComprobante(base(), RESUELTO).tipoDoc).toBe('01');
    expect(
      traducirComprobante(
        base({ document_type: 'receipt', customer: { document_type: 'dni', document_number: '44556677', name: 'Ana Quispe' } }),
        RESUELTO,
      ).tipoDoc,
    ).toBe('03');
  });

  it('un tipo que no existe se rechaza con el nombre del campo', () => {
    const e = falla(() => traducirComprobante(base({ document_type: 'nota' }), RESUELTO));
    expect(e.param).toBe('document_type');
    expect(e.codigo).toBe('parameter_invalid');
  });
});

describe('una factura exige RUC', () => {
  // SUNAT también lo rechaza, pero tarde: el correlativo ya se gastó y el
  // integrador ya le dijo a su usuario que estaba emitido.
  it('con DNI se detiene antes de emitir', () => {
    const e = falla(() =>
      validarCliente('invoice', { document_type: 'dni', document_number: '44556677', name: 'Ana' }),
    );
    expect(e.param).toBe('customer.document_type');
    expect(e.msg).toContain('receipt'); // dice qué hacer, no solo que está mal
  });

  it('una boleta con DNI pasa sin problema', () => {
    expect(() =>
      validarCliente('receipt', { document_type: 'dni', document_number: '44556677', name: 'Ana' }),
    ).not.toThrow();
  });

  it('el RUC se valida en 11 dígitos y el DNI en 8', () => {
    expect(falla(() => validarCliente('invoice', { ...CLIENTE_RUC, document_number: '2060123' })).param)
      .toBe('customer.document_number');
    expect(falla(() => validarCliente('receipt', { document_type: 'dni', document_number: '123', name: 'A' })).param)
      .toBe('customer.document_number');
  });

  it('exige nombre y número, y lo dice campo por campo', () => {
    expect(falla(() => validarCliente('receipt', { document_type: 'dni', document_number: '44556677' })).param)
      .toBe('customer.name');
    expect(falla(() => validarCliente('receipt', { document_type: 'dni', name: 'Ana' })).param)
      .toBe('customer.document_number');
    expect(falla(() => validarCliente('invoice', undefined)).param).toBe('customer');
  });
});

describe('las líneas viajan como ítems libres', () => {
  it('el integrador no manda nuestros IDs de producto', () => {
    // Tiene su catálogo, no el nuestro. La emisión interna ya lo soporta.
    const d = traducirItem(ITEM, 0);
    expect(d.productoId).toBeNull();
    expect(d.descripcion).toBe('Consultoría');
  });

  it('unit_value es el valor SIN IGV: el motor recibe el precio CON IGV', () => {
    // El motor de emisión (el del POS) lee `nuevoValorUnitario` como precio con
    // IGV. Pasarle 500 facturaba 500 con IGV incluido (423.73 + 76.27): 18% menos.
    expect(traducirItem(ITEM, 0).nuevoValorUnitario).toBeCloseTo(590, 10);
  });

  it('exonerado, inafecto y exportación no llevan IGV', () => {
    for (const tax_affectation of ['exempt', 'unaffected', 'export']) {
      expect(traducirItem({ ...ITEM, tax_affectation }, 0).nuevoValorUnitario).toBe(500);
    }
  });

  it('gratuito: el valor referencial va con IGV, como lo espera el motor', () => {
    expect(traducirItem({ ...ITEM, tax_affectation: 'free' }, 0).nuevoValorUnitario).toBeCloseTo(590, 10);
  });

  it('el descuento se aplica al precio (el motor no lee `descuento`)', () => {
    const d = traducirItem({ description: 'X', quantity: 2, unit_value: 100, discount: 20 }, 0);
    // (2 × 100 − 20) / 2 = 90 sin IGV → 106.20 con IGV; total de la línea 212.40
    expect(d.nuevoValorUnitario).toBeCloseTo(106.2, 10);
    expect(d.precioUnitarioOriginal).toBeCloseTo(118, 10);
    expect(d).not.toHaveProperty('descuento');
    expect(d.nuevoValorUnitario * 2).toBeCloseTo(totalEstimado([{ quantity: 2, unit_value: 100, discount: 20 }]), 2);
  });

  it('la unidad por defecto es NIU', () => {
    expect(traducirItem(ITEM, 0).unidadVenta).toBe('NIU');
    expect(traducirItem({ ...ITEM, unit: 'ZZ' }, 0).unidadVenta).toBe('ZZ');
  });

  it('traduce la afectación al catálogo 07 de SUNAT', () => {
    const codigo = (a?: string) => traducirItem({ ...ITEM, tax_affectation: a }, 0).tipoAfectacionIGV;
    expect(codigo('taxed')).toBe('10');
    expect(codigo('exempt')).toBe('20');
    expect(codigo('unaffected')).toBe('30');
    expect(codigo('export')).toBe('40');
    expect(codigo(undefined)).toBe('10'); // gravado por defecto
  });

  it('cada error apunta a la línea exacta', () => {
    // Con 40 líneas, "cantidad inválida" a secas no sirve de nada.
    expect(falla(() => traducirItem({ ...ITEM, quantity: 0 }, 11)).param).toBe('items[11].quantity');
    expect(falla(() => traducirItem({ ...ITEM, quantity: -1 }, 3)).param).toBe('items[3].quantity');
    expect(falla(() => traducirItem({ ...ITEM, unit_value: undefined }, 2)).param).toBe('items[2].unit_value');
    expect(falla(() => traducirItem({ ...ITEM, description: '  ' }, 0)).param).toBe('items[0].description');
    expect(falla(() => traducirItem({ ...ITEM, tax_affectation: 'iva' }, 1)).param).toBe('items[1].tax_affectation');
  });

  it('un descuento mayor que la línea se rechaza', () => {
    // Dejarlo pasar daría una línea de total negativo que SUNAT rechaza.
    expect(falla(() => traducirItem({ ...ITEM, discount: 1001 }, 0)).param).toBe('items[0].discount');
    expect(() => traducirItem({ ...ITEM, discount: 1000 }, 0)).not.toThrow(); // exacto, válido
    expect(falla(() => traducirItem({ ...ITEM, discount: -5 }, 0)).param).toBe('items[0].discount');
  });

  it('un comprobante sin líneas no se emite', () => {
    expect(falla(() => traducirComprobante(base({ items: [] }), RESUELTO)).param).toBe('items');
  });
});

describe('las condiciones de pago', () => {
  it('por defecto es contado', () => {
    expect(traducirPago(undefined, 100).formaPagoTipo).toBe('Contado');
    expect(traducirPago({ type: 'cash' }, 100).formaPagoTipo).toBe('Contado');
  });

  it('el crédito sin fecha ni cuotas se detiene acá', () => {
    // SUNAT lo rechaza: una venta al crédito tiene que decir cuándo se cobra.
    const e = falla(() => traducirPago({ type: 'credit' }, 100));
    expect(e.param).toBe('payment_terms.due_date');
    expect(e.msg).toContain('SUNAT');
  });

  it('el crédito con fecha de vencimiento pasa', () => {
    const p = traducirPago({ type: 'credit', due_date: '2026-12-15' }, 100);
    expect(p.formaPagoTipo).toBe('Credito');
    expect(p.fechaVencimientoCredito).toBe('2026-12-15');
  });

  it('las cuotas tienen que sumar el total', () => {
    const cuotas = [{ amount: 500, due_date: '2026-11-30' }, { amount: 400, due_date: '2026-12-30' }];
    const e = falla(() => traducirPago({ type: 'credit', installments: cuotas }, 1000));
    expect(e.param).toBe('payment_terms.installments');
    expect(e.msg).toContain('900.00'); // dice cuánto suman y cuánto debían sumar
    expect(e.msg).toContain('1000.00');
  });

  it('aguanta el centavo de redondeo', () => {
    // Tres cuotas de un total de 1000 no dan exacto; exigir igualdad al
    // céntimo rechazaría cronogramas correctos.
    const cuotas = [{ amount: 333.33 }, { amount: 333.33 }, { amount: 333.34 }];
    expect(() => traducirPago({ type: 'credit', installments: cuotas }, 1000)).not.toThrow();
  });

  it('numera las cuotas en orden', () => {
    const p = traducirPago(
      { type: 'credit', installments: [{ amount: 50, due_date: 'a' }, { amount: 50, due_date: 'b' }] },
      100,
    );
    expect(p.cuotas!.map((c: any) => c.numero)).toEqual([1, 2]);
  });
});

describe('el total que se usa para validar cuotas', () => {
  it('suma el IGV solo a lo gravado', () => {
    expect(totalEstimado([{ quantity: 2, unit_value: 500 }])).toBe(1180);
    expect(totalEstimado([{ quantity: 2, unit_value: 500, tax_affectation: 'exempt' }])).toBe(1000);
  });

  it('descuenta antes del IGV', () => {
    expect(totalEstimado([{ quantity: 1, unit_value: 100, discount: 10 }])).toBe(106.2);
  });

  it('aplica el descuento global al final', () => {
    expect(totalEstimado([{ quantity: 1, unit_value: 100 }], 18)).toBe(100);
  });

  it('no arrastra el error de coma flotante', () => {
    expect(aDosDecimales(0.1 + 0.2)).toBe(0.3);
    expect(aDosDecimales(1.005)).toBe(1.01);
  });
});

describe('la traducción completa', () => {
  const r = traducirComprobante(
    base({
      currency: 'USD',
      exchange_rate: 3.72,
      series: ' F001 ',
      purchase_order: 'OC-99',
      notes: 'Pago a 30 días',
      global_discount: 10,
    }),
    { ...RESUELTO, sedeId: 3 },
  );

  it('deja la moneda y el tipo de cambio donde los espera la emisión', () => {
    expect(r.tipoMoneda).toBe('USD');
    expect(r.formaPagoMoneda).toBe('USD');
    expect(r.tipoCambio).toBe(3.72);
  });

  it('limpia los espacios de la serie', () => {
    expect(r.serie).toBe('F001');
  });

  it('pasa el cliente y la sede ya resueltos', () => {
    expect(r.clienteId).toBe(7);
    expect(r.sedeId).toBe(3);
    expect(r.clienteName).toBe('COMERCIAL ANDINA S.A.C.');
  });

  it('una moneda que no existe se rechaza', () => {
    expect(falla(() => traducirComprobante(base({ currency: 'EUR' }), RESUELTO)).param).toBe('currency');
  });

  it('un descuento global negativo se rechaza', () => {
    expect(falla(() => traducirComprobante(base({ global_discount: -1 }), RESUELTO)).param).toBe('global_discount');
  });
});

describe('el cliente que se busca o se crea', () => {
  it('traduce el tipo al catálogo 06 y limpia los espacios', () => {
    expect(clienteNormalizado({ ...CLIENTE_RUC, document_number: ' 20601234567 ' })).toEqual({
      tipoDocumento: '6',
      numeroDocumento: '20601234567',
      nombre: 'COMERCIAL ANDINA S.A.C.',
      email: undefined,
      direccion: undefined,
    });
  });

  it('cada tipo tiene su código de SUNAT', () => {
    const t = (d: string) => clienteNormalizado({ document_type: d, document_number: '1', name: 'x' }).tipoDocumento;
    expect([t('ruc'), t('dni'), t('ce'), t('passport'), t('other')]).toEqual(['6', '1', '4', '7', '0']);
  });
});

describe('los errores de contrato salen como 400, no 500 (QA prod 25-10)', () => {
  const { HttpExceptionFilter } = require('../../common/filters/http-exception.filter');
  const { ErrorDeContrato } = require('./fachada');
  const responder = (url: string) => {
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const host: any = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ originalUrl: url }) }) };
    return { res, host };
  };
  it('factura a un DNI → 400 invalid_request_error con su code y param', () => {
    const { res, host } = responder('/api/v1/invoicing/invoices');
    new HttpExceptionFilter().catch(new ErrorDeContrato('parameter_invalid', 'Una factura exige RUC.', 'customer.document_type'), host);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: { type: 'invalid_request_error', code: 'parameter_invalid', message: 'Una factura exige RUC.', param: 'customer.document_type' } });
  });
  it('estado inválido → 409', () => {
    const { res, host } = responder('/api/v1/invoicing/invoices/inv_x/void');
    new HttpExceptionFilter().catch(new ErrorDeContrato('already_voided', 'Ya anulado.'), host);
    expect(res.status).toHaveBeenCalledWith(409);
  });
  it('un Error común sigue siendo 500', () => {
    const { res, host } = responder('/api/v1/invoicing/invoices');
    new HttpExceptionFilter().catch(new Error('boom'), host);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
