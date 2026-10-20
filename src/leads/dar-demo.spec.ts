/**
 * Demo por rubro (Krezka, 20-10): antes todo prospecto recibía la demo de
 * cómputo, aunque tuviera una farmacia. Ahora la IA pide el bloque de datos,
 * valida el RUC en SUNAT y entrega la demo de su rubro o la más parecida.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));
jest.mock('axios');

import axios from 'axios';
import { LeadsMessageProcessor } from './leads-message.processor';
import { HERRAMIENTA_DAR_DEMO } from './leads-herramientas';
import {
  conAccesosDemo,
  demosValidas,
  elegirDemo,
  faltanParaDemo,
  leerRuc,
  type CuentaDemo,
} from './demos';

const CUENTAS: CuentaDemo[] = [
  { rubro: 'Farmacia y botica', palabras: ['farmac', 'botic'], usuario: 'demo.farmacia@krezka.com', clave: '123456' },
  { rubro: 'Ferretería', palabras: ['ferret'], usuario: 'demo.ferreteria@krezka.com', clave: '123456' },
  { rubro: 'Minimarket y bodega', palabras: ['minimarket', 'bodega'], usuario: 'demo.minimarket@krezka.com', clave: '123456' },
];

const DEMOS = { enlace: 'https://app.krezka.com', avisarA: '972258391', cuentas: CUENTAS };

const DATOS = {
  rubro: 'farmacia',
  nombre: 'Lucía Paredes Soto',
  celular: '987654321',
  correo: 'lucia@gmail.com',
  ruc: '20607429074',
  nombreComercial: 'Botica Santa Lucía',
};

function armar(opciones: { previos?: unknown[]; demos?: unknown } = {}) {
  const avisos: Record<string, unknown>[] = [];
  const prisma = {
    leadMensaje: { findMany: jest.fn().mockResolvedValue(opciones.previos ?? []) },
    leadConversacion: { update: jest.fn().mockResolvedValue({}) },
  } as never;
  const pedido = {
    configDe: jest.fn().mockResolvedValue({
      supervisorTelefono: '986114148',
      ...('demos' in opciones ? { demos: opciones.demos } : { demos: DEMOS }),
    }),
  } as never;
  const notificaciones = { notificarAdminsEmpresa: jest.fn().mockResolvedValue({}) };
  const alerta = {
    avisarDemo: jest.fn(async (p: Record<string, unknown>) => {
      avisos.push(p);
    }),
  } as never;
  const processor = new LeadsMessageProcessor(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    notificaciones as never,
    alerta,
    {} as never,
    pedido,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const ejecutor = (processor as any).crearEjecutor(22, 70, '51987654321', new Set());
  return { ejecutor, avisos, notificaciones };
}

const sunatResponde = (razonSocial: string) =>
  (axios.post as jest.Mock).mockResolvedValue({
    data: { success: true, data: { nombre_o_razon_social: razonSocial, estado: 'ACTIVO', condicion: 'HABIDO' } },
  });

beforeEach(() => {
  process.env.RENIEC_TOKEN = 'token-de-prueba';
  (axios.post as jest.Mock).mockReset();
});

describe('elegir la demo', () => {
  it('por lo que dice el cliente', () => {
    expect(elegirDemo(CUENTAS, { rubro: 'tengo una farmacia' })?.cuenta.rubro).toBe('Farmacia y botica');
  });

  it('por la razón social cuando el cliente no fue claro', () => {
    const r = elegirDemo(CUENTAS, { rubro: 'vendo de todo un poco', razonSocial: 'FERRETERIA EL MAESTRO S.A.C.' });
    expect(r).toEqual({ cuenta: CUENTAS[1], aproximada: false });
  });

  it('la palabra cuenta al inicio, no en medio de otra', () => {
    const conMotos = [...CUENTAS, { rubro: 'Motos', palabras: ['moto'], usuario: 'demo.moto@krezka.com', clave: '123456' }];
    expect(elegirDemo(conMotos, { rubro: 'servicios', razonSocial: 'PROMOTORA ANDINA S.A.C.' })).toBeNull();
    expect(elegirDemo(conMotos, { rubro: 'vendo motos' })?.cuenta.rubro).toBe('Motos');
  });

  it('sin coincidencia y sin opción elegida, no inventa ninguna', () => {
    expect(elegirDemo(CUENTAS, { rubro: 'librería' })).toBeNull();
  });

  it('la más parecida que eligió el modelo queda marcada como aproximada', () => {
    expect(elegirDemo(CUENTAS, { rubro: 'librería', demo: 'Minimarket y bodega' })).toEqual({
      cuenta: CUENTAS[2],
      aproximada: true,
    });
  });
});

describe('datos de la demo', () => {
  it('pide nombre completo, correo, RUC y rubro', () => {
    expect(faltanParaDemo({ nombre: 'Lucía' })).toEqual([
      'nombres y apellidos',
      'correo electrónico',
      'RUC (o que te diga que aún no tiene)',
      'a qué se dedica su negocio',
    ]);
  });

  it('el RUC: 11 dígitos, "no tiene" o mal escrito', () => {
    expect(leerRuc('20607429074')).toEqual({ ruc: '20607429074' });
    expect(leerRuc('no tengo')).toEqual({ sinRuc: true });
    expect(leerRuc('2060742907')).toEqual({ invalido: true });
    expect(leerRuc('47112233')).toEqual({ invalido: true });
  });

  it('completa los accesos que el modelo resumió', () => {
    const acceso = { rubro: 'Ferretería', enlace: 'https://app.krezka.com', usuario: 'demo.ferreteria@krezka.com', clave: '123456' };
    const r = conAccesosDemo('¡Listo, ya tienes tu demo!', acceso);
    expect(r).toContain('demo.ferreteria@krezka.com');
    expect(r).toContain('Clave: 123456');
    const completa = 'Usuario demo.ferreteria@krezka.com, clave 123456';
    expect(conAccesosDemo(completa, acceso)).toBe(completa);
  });
});

describe('herramienta dar_demo', () => {
  it('entrega la demo del rubro y le avisa a ventas con los datos', async () => {
    sunatResponde('ROSAS & ASOCIADOS S.A.C.');
    const { ejecutor, avisos, notificaciones } = armar();
    const r = (await ejecutor(HERRAMIENTA_DAR_DEMO, DATOS)) as any;

    expect(r.acceso).toEqual({
      rubro: 'Farmacia y botica',
      enlace: 'https://app.krezka.com',
      usuario: 'demo.farmacia@krezka.com',
      clave: '123456',
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      supervisorTelefono: '972258391',
      nombreProspecto: 'Lucía Paredes Soto',
      demo: 'Farmacia y botica',
      aproximada: false,
      datos: expect.objectContaining({ ruc: '20607429074', razonSocial: 'ROSAS & ASOCIADOS S.A.C.', correo: 'lucia@gmail.com' }),
    });
    expect(notificaciones.notificarAdminsEmpresa).toHaveBeenCalledTimes(1);
  });

  it('un RUC que SUNAT no conoce se devuelve para revisar, sin demo', async () => {
    (axios.post as jest.Mock).mockRejectedValue({ response: { status: 404 } });
    const { ejecutor, avisos } = armar();
    const r = (await ejecutor(HERRAMIENTA_DAR_DEMO, { ...DATOS, ruc: '20999999990' })) as any;
    expect(r.acceso).toBeUndefined();
    expect(r.faltan).toEqual(['RUC válido']);
    expect(avisos).toHaveLength(0);
  });

  it('si apiperu está caído, igual entrega la demo', async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error('timeout'));
    const { ejecutor } = armar();
    const r = (await ejecutor(HERRAMIENTA_DAR_DEMO, DATOS)) as any;
    expect(r.acceso?.usuario).toBe('demo.farmacia@krezka.com');
  });

  it('sin RUC también se entrega, sin consultar SUNAT', async () => {
    const { ejecutor, avisos } = armar();
    const r = (await ejecutor(HERRAMIENTA_DAR_DEMO, { ...DATOS, ruc: 'no tiene' })) as any;
    expect(r.acceso).toBeDefined();
    expect(axios.post).not.toHaveBeenCalled();
    expect((avisos[0].datos as any).ruc).toBeUndefined();
  });

  it('sin demo de su rubro devuelve las opciones; con la elegida, avisa que es aproximada', async () => {
    const { ejecutor, avisos } = armar();
    const sinRubro = { ...DATOS, rubro: 'librería', ruc: 'no tiene', nombreComercial: 'Librería Lucía' };
    const r1 = (await ejecutor(HERRAMIENTA_DAR_DEMO, sinRubro)) as any;
    expect(r1.opciones).toEqual(['Farmacia y botica', 'Ferretería', 'Minimarket y bodega']);
    expect(avisos).toHaveLength(0);

    const r2 = (await ejecutor(HERRAMIENTA_DAR_DEMO, { ...sinRubro, demo: 'Minimarket y bodega' })) as any;
    expect(r2.acceso.usuario).toBe('demo.minimarket@krezka.com');
    expect(avisos[0]).toMatchObject({ aproximada: true });
  });

  it('si faltan datos, pide solo esos y devuelve el bloque', async () => {
    const { ejecutor } = armar();
    const r = (await ejecutor(HERRAMIENTA_DAR_DEMO, { rubro: 'farmacia', nombre: 'Lucía Paredes' })) as any;
    expect(r.faltan).toEqual(['correo electrónico', 'RUC (o que te diga que aún no tiene)']);
    expect(r.bloque).toContain('*DATOS PARA CREAR SU DEMO*');
  });

  it('a ventas le avisa una sola vez por conversación', async () => {
    sunatResponde('BOTICA X');
    const previos = [{ herramientasJson: [{ nombre: HERRAMIENTA_DAR_DEMO, resultado: { acceso: {} } }] }];
    const { ejecutor, avisos } = armar({ previos });
    const r = (await ejecutor(HERRAMIENTA_DAR_DEMO, DATOS)) as any;
    expect(r.acceso).toBeDefined();
    expect(avisos).toHaveLength(0);
  });

  it('un negocio sin demos configuradas no entrega accesos', async () => {
    const { ejecutor } = armar({ demos: undefined });
    const r = (await ejecutor(HERRAMIENTA_DAR_DEMO, DATOS)) as any;
    expect(r.acceso).toBeUndefined();
    expect(r.error).toMatch(/no entrega demos/);
  });
});

describe('configurar las demos', () => {
  it('rechaza una cuenta sin clave: la IA entregaría un acceso a medias', () => {
    expect(() =>
      demosValidas({ enlace: 'https://app.krezka.com', cuentas: [{ rubro: 'Farmacia', palabras: ['farmac'], usuario: 'demo.farmacia@krezka.com', clave: '' }] }),
    ).toThrow(/clave/);
  });

  it('guarda limpias las cuentas válidas', () => {
    expect(
      demosValidas({ enlace: ' https://app.krezka.com ', avisarA: ' 972258391 ', cuentas: [{ rubro: ' Farmacia ', palabras: [' farmac ', ''], usuario: 'demo.farmacia@krezka.com', clave: '123456' }] }),
    ).toEqual({ enlace: 'https://app.krezka.com', avisarA: '972258391', cuentas: [{ rubro: 'Farmacia', palabras: ['farmac'], usuario: 'demo.farmacia@krezka.com', clave: '123456' }] });
  });
});
