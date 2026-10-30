import {
  armarEvento,
  celular9,
  claveDeVenta,
  clicAtribuible,
  errorDeMeta,
  VENTANA_MS,
} from './meta-conversiones';

const d = (iso: string) => new Date(iso);

describe('clicAtribuible', () => {
  const venta = d('2026-10-20T15:00:00Z');

  it('toma el último clic antes de la venta', () => {
    const c = clicAtribuible(
      [
        { ctwaClid: 'viejo', creadoEn: d('2026-10-15T10:00:00Z') },
        { ctwaClid: 'nuevo', creadoEn: d('2026-10-19T10:00:00Z') },
      ],
      venta,
    );
    expect(c?.ctwaClid).toBe('nuevo');
  });

  it('un clic posterior a la venta no la trajo', () => {
    expect(clicAtribuible([{ ctwaClid: 'x', creadoEn: d('2026-10-21T10:00:00Z') }], venta)).toBeNull();
  });

  it('fuera de los 7 días no se atribuye', () => {
    const fuera = new Date(venta.getTime() - VENTANA_MS - 60_000);
    expect(clicAtribuible([{ ctwaClid: 'x', creadoEn: fuera }], venta)).toBeNull();
  });

  it('ignora llegadas sin id de clic (publicaciones)', () => {
    expect(clicAtribuible([{ ctwaClid: null, creadoEn: d('2026-10-19T10:00:00Z') }], venta)).toBeNull();
  });
});

describe('claveDeVenta', () => {
  it('la boleta de una nota hereda la clave de la nota: es una sola venta', () => {
    expect(claveDeVenta({ id: 90, tipoDoc: '03', comprobanteOrigenId: 40 })).toBe('venta-40');
    expect(claveDeVenta({ id: 40, tipoDoc: 'NV' })).toBe('venta-40');
  });

  it('una venta directa usa su propio id', () => {
    expect(claveDeVenta({ id: 7, tipoDoc: '01', comprobanteOrigenId: null })).toBe('venta-7');
  });
});

describe('celular9', () => {
  it('cruza 51 9xx con 9xx y con espacios', () => {
    expect(celular9('51987654321')).toBe('987654321');
    expect(celular9('+51 987 654 321')).toBe('987654321');
    expect(celular9('987654321')).toBe('987654321');
    expect(celular9('1234')).toBeNull();
    expect(celular9(null)).toBeNull();
  });
});

describe('armarEvento', () => {
  it('compra: lo que pide Meta para mensajería', () => {
    const e = armarEvento({
      evento: 'Purchase',
      clave: 'venta-40',
      fecha: d('2026-10-20T15:00:00Z'),
      wabaId: '111',
      ctwaClid: 'ARAk',
      valor: 129.899,
      moneda: 'pen',
    });
    expect(e).toEqual({
      event_name: 'Purchase',
      event_time: Date.UTC(2026, 9, 20, 15) / 1000,
      event_id: 'venta-40',
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { whatsapp_business_account_id: '111', ctwa_clid: 'ARAk' },
      custom_data: { currency: 'PEN', value: 129.9 },
    });
  });

  it('lead: sin monto', () => {
    const e = armarEvento({ evento: 'LeadSubmitted', clave: 'lead-3', fecha: new Date(), wabaId: '1', ctwaClid: 'c' });
    expect(e).not.toHaveProperty('custom_data');
  });
});

describe('errorDeMeta', () => {
  it('traduce la falta de permiso', () => {
    const e = { response: { data: { error: { code: 200, message: 'Permissions error' } } } };
    expect(errorDeMeta(e)).toMatch(/whatsapp_business_manage_events/);
  });
});
