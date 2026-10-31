import { destinoDelEnvio, textoSegunDestino } from './destino-envio';

describe('destino del envío (Lima vs provincia)', () => {
  it('delivery propio a domicilio → local', () => {
    expect(destinoDelEnvio({ tipoEnvio: 'DOMICILIO', transportista: 'PROPIOS' })).toBe('LOCAL');
  });

  it('sin datos (despacho viejo) → local: el texto de siempre', () => {
    expect(destinoDelEnvio(null)).toBe('LOCAL');
    expect(destinoDelEnvio({})).toBe('LOCAL');
    expect(destinoDelEnvio({ tipoEnvio: null, transportista: 'OTRO' })).toBe('LOCAL');
  });

  it('tipoEnvio AGENCIA manda, aunque el courier sea propio', () => {
    expect(destinoDelEnvio({ tipoEnvio: 'AGENCIA', transportista: 'PROPIOS' })).toBe('AGENCIA');
    expect(destinoDelEnvio({ tipoEnvio: ' agencia ' })).toBe('AGENCIA');
  });

  it.each(['SHALOM_PRO', 'SHALOM_COD', 'OLVA', 'URBANO', 'CRUZ_SUR', 'MARVISUR', 'olva'])(
    'courier de agencia %s → agencia',
    (transportista) => {
      expect(destinoDelEnvio({ transportista })).toBe('AGENCIA');
    },
  );

  it('elige la variante de agencia solo si está escrita', () => {
    expect(textoSegunDestino('AGENCIA', 'lima', 'provincia')).toBe('provincia');
    expect(textoSegunDestino('AGENCIA', 'lima', '   ')).toBe('lima');
    expect(textoSegunDestino('AGENCIA', 'lima', null)).toBe('lima');
    expect(textoSegunDestino('LOCAL', 'lima', 'provincia')).toBe('lima');
  });
});
