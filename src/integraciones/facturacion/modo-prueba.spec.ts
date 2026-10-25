import { comprobanteSimulado, esClaveDePrueba } from './modo-prueba';

describe('modo prueba de la API de facturación', () => {
  it('sk_test_ es prueba; sk_live_ no', () => {
    expect(esClaveDePrueba({ apiKey: { entorno: 'test' } })).toBe(true);
    expect(esClaveDePrueba({ apiKey: { entorno: 'live' } })).toBe(false);
    expect(esClaveDePrueba({})).toBe(false);
  });

  it('calcula como la emisión: gravado + IGV, exonerado sin IGV, descuentos', () => {
    const s = comprobanteSimulado(
      {
        document_type: 'invoice',
        customer: { document_type: 'ruc', document_number: '20131312955', name: 'SUNAT' },
        items: [
          { description: 'Servicio', quantity: 2, unit_value: 100, discount: 20 },
          { description: 'Libro', quantity: 1, unit_value: 40, tax_affectation: 'exempt' },
        ],
        external_id: 'PED-1',
      },
      'iss_abc',
      { serie: 'F001', correlativo: 31 },
    );
    expect(s).toMatchObject({ livemode: false, status: 'test', number_preview: 'F001-00000031', issuer_id: 'iss_abc', external_id: 'PED-1' });
    expect(s.totals).toEqual({ taxable: 180, exempt: 40, unaffected: 0, export: 0, discount: 0, tax: 32.4, total: 252.4 });
    expect(s.items[0].tax).toBe(32.4);
  });

  it('sin series todavía: number_preview null, igual responde', () => {
    expect(comprobanteSimulado({ document_type: 'receipt', items: [{ description: 'x', quantity: 1, unit_value: 10 }] }, 'iss_x', null).number_preview).toBeNull();
  });
});
