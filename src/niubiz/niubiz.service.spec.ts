/**
 * QA del flujo de Niubiz: token de seguridad → sesión → autorización, siempre
 * con las credenciales DE LA EMPRESA y contra el entorno que ella tenga
 * configurado (integración o producción).
 *
 * Se moquea axios: lo que se valida es que llamemos a los endpoints correctos,
 * con la autenticación correcta, y que interpretemos bien las respuestas de
 * Niubiz — incluidos los rechazos.
 */
import axios from 'axios';
import { NiubizService, CHECKOUT_JS } from './niubiz.service';
import { cifrarSecreto } from '../common/utils/secreto.util';

jest.mock('axios');
const axiosMock = axios as jest.Mocked<typeof axios>;

const empresaNiubiz = (extra: Record<string, any> = {}) => ({
  niubizMerchantId: '456879852',
  niubizUsuario: 'integraciones@tienda.pe',
  niubizPassword: cifrarSecreto('clave-del-comercio'),
  niubizActivo: true,
  pasarelasUsaDemo: true,
  ...extra,
});

const servicio = (empresa: any) =>
  new NiubizService({
    empresa: { findUnique: jest.fn().mockResolvedValue(empresa) },
  } as any);

beforeEach(() => jest.clearAllMocks());

describe('Niubiz · credenciales por empresa', () => {
  it('no se habilita si la tienda no configuró su afiliación', async () => {
    expect(await servicio(empresaNiubiz({ niubizMerchantId: null })).habilitada(1)).toBe(false);
    expect(await servicio(empresaNiubiz({ niubizUsuario: null })).habilitada(1)).toBe(false);
    expect(await servicio(empresaNiubiz({ niubizPassword: null })).habilitada(1)).toBe(false);
  });

  it('no se habilita con el interruptor apagado aunque tenga credenciales', async () => {
    expect(await servicio(empresaNiubiz({ niubizActivo: false })).habilitada(1)).toBe(false);
  });

  it('con todo configurado, se habilita y descifra la clave', async () => {
    const s = servicio(empresaNiubiz());
    expect(await s.habilitada(1)).toBe(true);
    const cred = await s.credenciales(1);
    expect(cred?.password).toBe('clave-del-comercio');
    expect(cred?.merchantId).toBe('456879852');
  });
});

describe('Niubiz · sesión de pago', () => {
  it('autentica con Basic del comercio y pide la sesión a su merchant id', async () => {
    axiosMock.get.mockResolvedValue({ data: 'token-de-seguridad' });
    axiosMock.post.mockResolvedValue({ data: { sessionKey: 'k'.repeat(64), expirationTime: 123 } });

    const r = await servicio(empresaNiubiz()).crearSesion({ empresaId: 1, montoSoles: 120.5, clientIp: '1.2.3.4' });

    const [urlToken, cfgToken] = axiosMock.get.mock.calls[0];
    expect(urlToken).toContain('/api.security/v1/security');
    const basic = Buffer.from('integraciones@tienda.pe:clave-del-comercio').toString('base64');
    expect((cfgToken as any).headers.Authorization).toBe(`Basic ${basic}`);

    const [urlSesion, body, cfgSesion] = axiosMock.post.mock.calls[0];
    expect(urlSesion).toContain('/api.ecommerce/v2/ecommerce/token/session/456879852');
    expect(body).toMatchObject({ channel: 'web', amount: 120.5, antifraud: { clientIp: '1.2.3.4' } });
    expect((cfgSesion as any).headers.Authorization).toBe('token-de-seguridad');

    expect(r.sessionKey).toHaveLength(64);
    expect(r.merchantId).toBe('456879852');
  });

  it('en modo demo usa el sandbox y su checkout.js; en producción, los de prod', async () => {
    axiosMock.get.mockResolvedValue({ data: 't' });
    axiosMock.post.mockResolvedValue({ data: { sessionKey: 'k' } });

    const demo = await servicio(empresaNiubiz()).crearSesion({ empresaId: 1, montoSoles: 10 });
    expect(demo.scriptUrl).toBe(CHECKOUT_JS.demo);
    expect(axiosMock.post.mock.calls[0][0]).toContain('apisandbox.vnforappstest.com');

    jest.clearAllMocks();
    axiosMock.get.mockResolvedValue({ data: 't' });
    axiosMock.post.mockResolvedValue({ data: { sessionKey: 'k' } });
    const prod = await servicio(empresaNiubiz({ pasarelasUsaDemo: false })).crearSesion({ empresaId: 1, montoSoles: 10 });
    expect(prod.scriptUrl).toBe(CHECKOUT_JS.prod);
    expect(axiosMock.post.mock.calls[0][0]).toContain('apiprod.vnforapps.com');
  });

  it('una tienda sin Niubiz recibe un mensaje claro en vez de un error técnico', async () => {
    await expect(
      servicio(empresaNiubiz({ niubizActivo: false })).crearSesion({ empresaId: 1, montoSoles: 10 }),
    ).rejects.toThrow('todavía no configuró su cuenta de Niubiz');
  });

  it('un monto inválido no llega a Niubiz', async () => {
    await expect(
      servicio(empresaNiubiz()).crearSesion({ empresaId: 1, montoSoles: 0 }),
    ).rejects.toThrow('Monto inválido');
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  it('si las credenciales son malas, el mensaje apunta al usuario y la clave', async () => {
    axiosMock.get.mockRejectedValue({ response: { status: 401 }, message: 'Unauthorized' });
    await expect(
      servicio(empresaNiubiz()).crearSesion({ empresaId: 1, montoSoles: 10 }),
    ).rejects.toThrow('Revisa el usuario y la clave');
  });
});

describe('Niubiz · autorización del cobro', () => {
  const autorizar = () =>
    servicio(empresaNiubiz()).autorizar({
      empresaId: 1,
      transactionToken: 'tok-32-chars',
      purchaseNumber: '123456789012',
      montoSoles: 250,
    });

  it('aprueba y devuelve la referencia que se guarda en el pedido', async () => {
    axiosMock.get.mockResolvedValue({ data: 'token' });
    axiosMock.post.mockResolvedValue({
      data: {
        errorCode: '0',
        order: { transactionId: '99887766' },
        dataMap: { ACTION_CODE: '000', BRAND: 'visa', CARD: '411111******1111' },
      },
    });

    const r = await autorizar();
    const [url, body] = axiosMock.post.mock.calls[0];
    expect(url).toContain('/api.authorization/v3/authorization/ecommerce/456879852');
    expect(body).toMatchObject({
      order: { tokenId: 'tok-32-chars', purchaseNumber: '123456789012', amount: 250, currency: 'PEN' },
    });
    expect(r.transactionId).toBe('99887766');
    expect(r.descripcion).toBe('VISA 411111******1111');
  });

  it('un rechazo de Niubiz llega con su motivo, no como error genérico', async () => {
    axiosMock.get.mockResolvedValue({ data: 'token' });
    axiosMock.post.mockRejectedValue({
      response: { data: { data: { ACTION_DESCRIPTION: 'Tarjeta sin fondos' } } },
    });
    await expect(autorizar()).rejects.toThrow('Tarjeta sin fondos');
  });

  it('un ACTION_CODE distinto de 000 no se toma por aprobado', async () => {
    axiosMock.get.mockResolvedValue({ data: 'token' });
    axiosMock.post.mockResolvedValue({
      data: { errorCode: '0', dataMap: { ACTION_CODE: '101', ACTION_DESCRIPTION: 'Tarjeta vencida' } },
    });
    await expect(autorizar()).rejects.toThrow('Tarjeta vencida');
  });
});

/**
 * Niubiz rechaza la autorización si el número de compra no es el mismo que se
 * le pasó al formulario del navegador. Por eso lo genera la sesión y viaja de
 * ida y vuelta: ningún lado lo inventa por su cuenta.
 */
describe('Niubiz · número de compra', () => {
  it('la sesión devuelve el número que el navegador debe usar', async () => {
    axiosMock.get.mockResolvedValue({ data: 't' });
    axiosMock.post.mockResolvedValue({ data: { sessionKey: 'k' } });

    const r = await servicio(empresaNiubiz()).crearSesion({ empresaId: 1, montoSoles: 10 });
    expect(r.purchaseNumber).toMatch(/^\d{12}$/);
  });

  it('dos sesiones seguidas no repiten el número', async () => {
    axiosMock.get.mockResolvedValue({ data: 't' });
    axiosMock.post.mockResolvedValue({ data: { sessionKey: 'k' } });
    const s = servicio(empresaNiubiz());
    const a = await s.crearSesion({ empresaId: 1, montoSoles: 10 });
    const b = await s.crearSesion({ empresaId: 1, montoSoles: 10 });
    expect(a.purchaseNumber).not.toBe(b.purchaseNumber);
  });

  it('autoriza con el número que se le pasa, tal cual', async () => {
    axiosMock.get.mockResolvedValue({ data: 'token' });
    axiosMock.post.mockResolvedValue({
      data: { errorCode: '0', order: { transactionId: '1' }, dataMap: { ACTION_CODE: '000' } },
    });
    await servicio(empresaNiubiz()).autorizar({
      empresaId: 1,
      transactionToken: 'tok',
      purchaseNumber: '123456789012',
      montoSoles: 10,
    });
    expect((axiosMock.post.mock.calls[0][1] as any).order.purchaseNumber).toBe('123456789012');
  });
});
