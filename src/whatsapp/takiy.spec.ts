import { enviarTakiy, numeroTakiy, TAKIY_URL } from './takiy';
import { mensajePropio } from '../envio-despacho/recojo-agencia';

const cred = { appKey: 'app-1', authKey: 'auth-1' };

function respuesta(status: number, body: unknown) {
  return jest
    .fn()
    .mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

describe('numeroTakiy', () => {
  it('pone el 51 a un celular de 9 dígitos', () => {
    expect(numeroTakiy('907 236 450')).toBe('51907236450');
  });

  it('no duplica el 51 ni deja el +', () => {
    expect(numeroTakiy('+51 907236450')).toBe('51907236450');
  });
});

describe('enviarTakiy', () => {
  it('manda appkey, authkey, to, message y el PDF como file', async () => {
    const fetchMock = respuesta(200, {
      message_status: 'Success',
      data: { status_code: 200 },
    });
    const r = await enviarTakiy(
      cred,
      { numero: '907236450', mensaje: 'Hola', archivoUrl: 'https://s3/x.pdf' },
      fetchMock as any,
    );
    expect(r).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TAKIY_URL);
    const body = init.body as URLSearchParams;
    expect(body.get('appkey')).toBe('app-1');
    expect(body.get('authkey')).toBe('auth-1');
    expect(body.get('to')).toBe('51907236450');
    expect(body.get('message')).toBe('Hola');
    expect(body.get('file')).toBe('https://s3/x.pdf');
  });

  it('sin archivo no manda file', async () => {
    const fetchMock = respuesta(200, { message_status: 'Success' });
    await enviarTakiy(
      cred,
      { numero: '907236450', mensaje: 'Hola' },
      fetchMock as any,
    );
    expect(
      (fetchMock.mock.calls[0][1].body as URLSearchParams).has('file'),
    ).toBe(false);
  });

  it('devuelve los errores de validación de Takiy legibles', async () => {
    const fetchMock = respuesta(422, {
      success: false,
      message: 'Validation errors',
      data: { authkey: ['The authkey field is required.'] },
    });
    const r = await enviarTakiy(
      cred,
      { numero: '907236450', mensaje: 'Hola' },
      fetchMock as any,
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('The authkey field is required.');
  });

  it('un 200 sin message_status Success no cuenta como enviado', async () => {
    const fetchMock = respuesta(200, { message: 'Device disconnected' });
    const r = await enviarTakiy(
      cred,
      { numero: '907236450', mensaje: 'Hola' },
      fetchMock as any,
    );
    expect(r).toEqual({ success: false, error: 'Takiy: Device disconnected' });
  });

  it('no llama a Takiy con un número que no es celular', async () => {
    const fetchMock = respuesta(200, {});
    const r = await enviarTakiy(
      cred,
      { numero: '123', mensaje: 'Hola' },
      fetchMock as any,
    );
    expect(r.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('una caída de red no revienta: devuelve el error', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const r = await enviarTakiy(
      cred,
      { numero: '907236450', mensaje: 'Hola' },
      fetchMock as any,
    );
    expect(r).toEqual({
      success: false,
      error: 'Takiy no respondió: ECONNRESET',
    });
  });
});

describe('mensajePropio', () => {
  it('reemplaza las variables del negocio', () => {
    expect(
      mensajePropio(
        'Hola {{nombre}}, tu pedido {{pedido}} llegó a {{agencia}}',
        {
          nombre: 'Katia',
          pedido: 'NV01-12',
          agencia: 'Shalom Cusco',
        },
      ),
    ).toBe('Hola Katia, tu pedido NV01-12 llegó a Shalom Cusco');
  });

  it('una variable sin valor no llega como {{clave}} al cliente', () => {
    expect(
      mensajePropio('Listo {{nombre}}. Clave: {{clave}}', { nombre: 'Ana' }),
    ).toBe('Listo Ana. Clave:');
  });

  it('vacío → null, para que salga la plantilla de siempre', () => {
    expect(mensajePropio('   ', {})).toBeNull();
    expect(mensajePropio(null, {})).toBeNull();
  });

  it('respeta los saltos de línea y emojis del mensaje', () => {
    expect(
      mensajePropio('Hola {{nombre}} 🌞\n*YA PUEDE RECOGER*', {
        nombre: 'Ronal',
      }),
    ).toBe('Hola Ronal 🌞\n*YA PUEDE RECOGER*');
  });
});
