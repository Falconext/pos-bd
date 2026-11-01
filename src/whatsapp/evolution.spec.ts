import {
  EvolutionClient,
  EvolutionError,
  HEADER_SECRETO_WEBHOOK,
  leerQr,
  tipoDeMedia,
} from './evolution';
import { fetchFake } from './evolution.fixtures';

const CFG = { url: 'http://evo:8080/', apiKey: 'GLOBAL-KEY-123' };

describe('EvolutionClient: pedidos según Evolution v2 (2.3.7)', () => {
  it('crea la instancia Baileys con token propio, QR y webhook firmado por header', async () => {
    const f = fetchFake([
      {
        match: /POST .*\/instance\/create$/,
        status: 201,
        body: {
          hash: 'X',
          qrcode: { base64: 'data:image/png;base64,AAA', pairingCode: null },
        },
      },
    ]);
    const q = await new EvolutionClient(CFG, f.impl).crearInstancia({
      instancia: 'krezka-1-abc',
      token: 'tok-instancia',
      webhook: {
        url: 'https://api/x',
        headers: { [HEADER_SECRETO_WEBHOOK]: 's' },
        events: ['CONNECTION_UPDATE'],
      },
    });
    const ll = f.llamadas[0];
    expect(ll.url).toBe('http://evo:8080/instance/create');
    expect(ll.headers.apikey).toBe('GLOBAL-KEY-123');
    expect(ll.body).toMatchObject({
      instanceName: 'krezka-1-abc',
      token: 'tok-instancia',
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        enabled: true,
        url: 'https://api/x',
        headers: { [HEADER_SECRETO_WEBHOOK]: 's' },
        events: ['CONNECTION_UPDATE'],
        base64: false,
      },
    });
    expect(ll.body.number).toBeUndefined();
    expect(q.qr).toBe('data:image/png;base64,AAA');
  });

  it('con número pide código de emparejamiento (create.number y connect?number=)', async () => {
    const f = fetchFake([
      {
        match: /create/,
        body: { qrcode: { base64: 'AAA', pairingCode: 'WZYEH1YY' } },
      },
      {
        match: /connect/,
        body: { base64: 'BBB', pairingCode: 'ABCD1234', code: '2@x', count: 2 },
      },
    ]);
    const cli = new EvolutionClient(CFG, f.impl);
    const a = await cli.crearInstancia({
      instancia: 'i',
      token: 't',
      numero: '51987654321',
      webhook: { url: 'u', headers: {}, events: [] },
    });
    expect(f.llamadas[0].body.number).toBe('51987654321');
    expect(a.codigoEmparejamiento).toBe('WZYEH1YY');
    const b = await cli.conectar('i', 'tok', '51987654321');
    expect(f.llamadas[1].url).toBe(
      'http://evo:8080/instance/connect/i?number=51987654321',
    );
    expect(f.llamadas[1].headers.apikey).toBe('tok');
    // base64 sin prefijo: se le pone el data URL para el <img>.
    expect(b).toEqual({
      qr: 'data:image/png;base64,BBB',
      codigoEmparejamiento: 'ABCD1234',
      estado: null,
    });
  });

  it('connect con la sesión ya abierta devuelve el estado, no un QR', async () => {
    const f = fetchFake([
      {
        match: /connect/,
        body: { instance: { instanceName: 'i', state: 'open' } },
      },
    ]);
    expect(await new EvolutionClient(CFG, f.impl).conectar('i', 't')).toEqual({
      qr: null,
      codigoEmparejamiento: null,
      estado: 'open',
    });
  });

  it('connectionState: open/close/connecting; algo raro cuenta como close', async () => {
    for (const [st, esperado] of [
      ['open', 'open'],
      ['connecting', 'connecting'],
      ['raro', 'close'],
    ]) {
      const f = fetchFake([
        { match: /connectionState\/i$/, body: { instance: { state: st } } },
      ]);
      expect(await new EvolutionClient(CFG, f.impl).estado('i', 't')).toBe(
        esperado,
      );
    }
  });

  it('sendText: number + text en la raíz y delay de "escribiendo…"', async () => {
    const f = fetchFake([
      { match: /sendText/, status: 201, body: { key: {} } },
    ]);
    await new EvolutionClient(CFG, f.impl).enviarTexto(
      'krezka-1-x',
      'tok',
      '51987654321',
      'hola',
    );
    expect(f.llamadas[0].url).toBe(
      'http://evo:8080/message/sendText/krezka-1-x',
    );
    expect(f.llamadas[0].method).toBe('POST');
    expect(f.llamadas[0].body).toEqual({
      number: '51987654321',
      text: 'hola',
      delay: 1200,
    });
  });

  it('sendMedia: PDF como documento con nombre y pie; imagen como image', async () => {
    const f = fetchFake([{ match: /sendMedia/, status: 201 }]);
    const cli = new EvolutionClient(CFG, f.impl);
    await cli.enviarMedia('i', 't', '51987654321', {
      url: 'https://s3/x/F001-1.pdf?sig=1',
      caption: 'Tu boleta',
    });
    expect(f.llamadas[0].body).toMatchObject({
      number: '51987654321',
      mediatype: 'document',
      mimetype: 'application/pdf',
      media: 'https://s3/x/F001-1.pdf?sig=1',
      fileName: 'F001-1.pdf',
      caption: 'Tu boleta',
    });
    await cli.enviarMedia('i', 't', '51987654321', {
      url: 'https://s3/foto.JPG',
    });
    expect(f.llamadas[1].body).toMatchObject({
      mediatype: 'image',
      mimetype: 'image/jpeg',
    });
    expect(f.llamadas[1].body.fileName).toBeUndefined();
  });

  it('logout y delete usan DELETE; delete siempre con la llave global', async () => {
    const f = fetchFake();
    const cli = new EvolutionClient(CFG, f.impl);
    await cli.cerrarSesion('i', 'tok');
    await cli.borrarInstancia('i');
    expect(
      f.llamadas.map((l) => `${l.method} ${l.url} ${l.headers.apikey}`),
    ).toEqual([
      'DELETE http://evo:8080/instance/logout/i tok',
      'DELETE http://evo:8080/instance/delete/i GLOBAL-KEY-123',
    ]);
  });
});

describe('EvolutionClient: errores en español y sin secretos', () => {
  const casos: [number, unknown, string][] = [
    [401, { error: 'Unauthorized' }, 'NO_AUTORIZADO'],
    [403, {}, 'NO_AUTORIZADO'],
    [
      404,
      { response: { message: ['The "i" instance does not exist'] } },
      'NO_ENCONTRADA',
    ],
    [
      400,
      {
        status: 400,
        response: { message: [{ exists: false, jid: '51@s', number: '51' }] },
      },
      'NUMERO_SIN_WHATSAPP',
    ],
    [400, { response: { message: ['Connection Closed'] } }, 'NO_ENCONTRADA'],
    [400, { response: { message: ['otra cosa'] } }, 'SOLICITUD_INVALIDA'],
    [500, { response: { message: 'boom GLOBAL-KEY-123' } }, 'SERVIDOR'],
  ];
  it.each(casos)('HTTP %i %j → %s', async (status, body, codigo) => {
    const f = fetchFake([{ match: /./, status, body }]);
    const e = await new EvolutionClient(CFG, f.impl)
      .enviarTexto('i', 'tok-secreto', '51987654321', 'x')
      .catch((x) => x);
    expect(e).toBeInstanceOf(EvolutionError);
    expect(e.codigo).toBe(codigo);
    expect(e.message).not.toMatch(/GLOBAL-KEY-123|tok-secreto/);
  });

  it('timeout → TIMEOUT (ambiguo: pudo salir); red caída → RED (no ambiguo)', async () => {
    const t = fetchFake([
      {
        match: /./,
        error: Object.assign(new Error('x'), { name: 'TimeoutError' }),
      },
    ]);
    const e1 = await new EvolutionClient(CFG, t.impl)
      .enviarTexto('i', 't', '51', 'x')
      .catch((x) => x);
    expect([e1.codigo, e1.ambiguo]).toEqual(['TIMEOUT', true]);
    const r = fetchFake([
      {
        match: /./,
        error: new Error('ECONNREFUSED http://evo GLOBAL-KEY-123'),
      },
    ]);
    const e2 = await new EvolutionClient(CFG, r.impl)
      .enviarTexto('i', 't', '51', 'x')
      .catch((x) => x);
    expect([e2.codigo, e2.ambiguo]).toEqual(['RED', false]);
    expect(e2.message).not.toMatch(/GLOBAL-KEY-123/);
  });

  it('nombres de instancia raros van codificados en la ruta', async () => {
    const f = fetchFake();
    await new EvolutionClient(CFG, f.impl).estado('a/b?c', 't');
    expect(f.llamadas[0].url).toBe(
      'http://evo:8080/instance/connectionState/a%2Fb%3Fc',
    );
  });
});

describe('helpers', () => {
  it('leerQr tolera vacíos', () => {
    expect(leerQr(undefined)).toEqual({
      qr: null,
      codigoEmparejamiento: null,
      estado: null,
    });
  });
  it('tipoDeMedia: el nombre manda sobre la URL; por defecto PDF', () => {
    expect(tipoDeMedia('https://x/y', 'a.png').mediatype).toBe('image');
    expect(tipoDeMedia('https://x/sin-extension').mimetype).toBe(
      'application/pdf',
    );
  });
});
