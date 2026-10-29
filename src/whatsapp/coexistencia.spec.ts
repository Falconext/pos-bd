/**
 * Conectar un número que sigue en la app WhatsApp Business del celular
 * (coexistencia).
 *
 * Meta pide saltarse el registro del número: ya está registrado por la app.
 * Y el asistente de Meta solo devuelve la WABA, no el número, así que el
 * número se busca dentro de esa WABA y no en cualquiera que el token vea.
 * La conexión de siempre (número nuevo, solo API) tiene que seguir igual.
 */
import axios from 'axios';
import { WhatsAppService } from './whatsapp.service';

jest.mock('axios');
const get = axios.get as jest.Mock;
const post = axios.post as jest.Mock;

function servicio() {
  const env: Record<string, string> = { FB_APP_ID: 'APP', META_APP_SECRET: 'SECRETO' };
  const config = { get: (k: string) => env[k] } as never;
  const prisma = {
    empresa: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ whatsappPin: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    numeroWhatsapp: {
      findFirst: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const s = new WhatsAppService(prisma as never, config);
  jest.spyOn(s as any, 'validarPlantillasWhatsApp').mockResolvedValue(undefined);
  jest.spyOn(s as any, 'crearPlantillasDespacho').mockResolvedValue({ creadas: [], existentes: [] });
  return { s, prisma };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  post.mockResolvedValue({ data: {} });
  get.mockImplementation((url: string) => {
    if (url.endsWith('/oauth/access_token')) return Promise.resolve({ data: { access_token: 'TOK' } });
    if (url.endsWith('/debug_token'))
      return Promise.resolve({
        data: { data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA-OTRA', 'WABA-1'] }] } },
      });
    if (url.endsWith('/WABA-OTRA/phone_numbers'))
      return Promise.resolve({ data: { data: [{ id: 'PN-OTRO', display_phone_number: '51 900 000 000' }] } });
    if (url.endsWith('/WABA-1/phone_numbers'))
      return Promise.resolve({ data: { data: [{ id: 'PN-1', display_phone_number: '51 915 000 111' }] } });
    return Promise.resolve({ data: { status: 'CONNECTED', platform_type: 'CLOUD_API', display_phone_number: '51 915 000 111' } });
  });
});

const registros = () => post.mock.calls.filter(([url]) => String(url).endsWith('/register'));

describe('conectar en coexistencia', () => {
  it('no registra el número y lo busca en la WABA que devolvió Meta', async () => {
    const { s, prisma } = servicio();
    const r = await s.conectarEmbeddedSignup(5, { code: 'C', wabaId: 'WABA-1', coexistencia: true });
    expect(registros()).toHaveLength(0);
    expect(r.phoneNumberId).toBe('PN-1');
    expect(r.conectado).toBe(true);
    expect(prisma.empresa.update.mock.calls.at(-1)[0].data).toMatchObject({
      whatsappPhoneNumberId: 'PN-1',
      whatsappBusinessId: 'WABA-1',
      whatsappActivo: true,
    });
  });

  it('avisa si el número todavía no pasó a la API', async () => {
    const { s } = servicio();
    get.mockImplementation((url: string) => {
      if (url.endsWith('/oauth/access_token')) return Promise.resolve({ data: { access_token: 'TOK' } });
      return Promise.resolve({ data: { status: 'PENDING', platform_type: 'NOT_APPLICABLE' } });
    });
    const r = await s.conectarEmbeddedSignup(5, { code: 'C', wabaId: 'WABA-1', phoneNumberId: 'PN-1', coexistencia: true });
    expect(r.conectado).toBe(false);
    expect(registros()).toHaveLength(0);
  });
});

describe('conexión de siempre (número nuevo)', () => {
  it('sigue registrando el número en la API', async () => {
    const { s } = servicio();
    const r = await s.conectarEmbeddedSignup(5, { code: 'C', wabaId: 'WABA-1', phoneNumberId: 'PN-1' });
    expect(registros()).toHaveLength(1);
    expect(r.conectado).toBe(true);
  });
});
