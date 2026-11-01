/**
 * QA contra un Evolution API v2 REAL (sin mocks de HTTP). Verifica el contrato
 * que la documentación no deja claro: webhook con headers, QR por connect,
 * token por instancia, logout/delete y los errores.
 *
 * Levantar Evolution desechable (ver docs/whatsapp-evolution.md, "QA local") y:
 *   EVOLUTION_QA_URL=http://127.0.0.1:18080 EVOLUTION_QA_KEY=<llave global> \
 *   EVOLUTION_QA_WEBHOOK_BASE=http://host.docker.internal:4799 \
 *     npx jest --runInBand src/whatsapp/conexion/evolution-real.qa
 *
 * La base es en memoria (prismaFake): no toca ninguna base de datos.
 * Sin las variables, se salta.
 */
import * as http from 'http';
import { AddressInfo } from 'net';
import { EvolutionEnvioService } from '../evolution-envio.service';
import { leerEvolutionEnv } from '../evolution-config';
import { prismaFake } from '../evolution.fixtures';
import { NumeroNegocioService } from '../numero-negocio.service';
import { WhatsappConexionService } from './whatsapp-conexion.service';

const URL = process.env.EVOLUTION_QA_URL;
const KEY = process.env.EVOLUTION_QA_KEY ?? '';
const WEBHOOK_BASE =
  process.env.EVOLUTION_QA_WEBHOOK_BASE ?? 'http://host.docker.internal:4799';
const SECRETO = 'qa-secreto-webhook-' + Date.now();
const describeSiHay = URL ? describe : describe.skip;

jest.setTimeout(90_000);

function montar(empresaId: number, env: Record<string, string> = {}) {
  const prisma = prismaFake({
    usuarios: [
      {
        id: 10 + empresaId,
        empresaId,
        rol: 'ADMIN_EMPRESA',
        estado: 'ACTIVO',
        celular: '987654321',
        email: 'qa@krezka.test',
      },
    ],
  });
  const envio = new EvolutionEnvioService(prisma as never);
  envio.leerEnv = () =>
    leerEvolutionEnv({
      EVOLUTION_API_URL: URL,
      EVOLUTION_API_KEY: KEY,
      EVOLUTION_WEBHOOK_SECRET: SECRETO,
      EVOLUTION_EMPRESAS_PILOTO: '*',
      EVOLUTION_WEBHOOK_BASE_URL: WEBHOOK_BASE,
      ...env,
    });
  const notificaciones = {
    notificarAdminsEmpresa: jest.fn(async () => undefined),
    emitirEventoAUsuarios: jest.fn(),
  };
  const svc = new WhatsappConexionService(
    prisma as never,
    envio,
    notificaciones as never,
  );
  svc.enviarCorreo = jest.fn(async () => undefined);
  return { prisma, envio, svc, notificaciones };
}

async function evo(metodo: string, ruta: string, apikey = KEY, body?: unknown) {
  const r = await fetch(`${URL}${ruta}`, {
    method: metodo,
    headers: { apikey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

const esperar = async (cond: () => boolean, ms = 30_000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

describeSiHay('Evolution v2 real', () => {
  const A = montar(901);
  const recibidos: { evento: string; status: number; instancia: string }[] = [];
  let server: http.Server;
  const instanciasCreadas: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        let body: any = null;
        try {
          body = JSON.parse(raw);
        } catch {
          /* cuerpo inválido */
        }
        // Mismo camino que EvolutionWebhookController: header → servicio.
        const destino =
          [A].find((x) =>
            x.prisma.filas.some((f) => f.instancia === body?.instance),
          ) ?? A;
        try {
          await destino.svc.webhook(
            req.headers['x-krezka-webhook-secret'],
            body,
          );
          res.writeHead(200).end('{"ok":true}');
          recibidos.push({
            evento: String(body?.event),
            status: 200,
            instancia: body?.instance,
          });
        } catch {
          res.writeHead(401).end();
          recibidos.push({
            evento: String(body?.event),
            status: 401,
            instancia: body?.instance,
          });
        }
      });
    });
    await new Promise<void>((r) => server.listen(4799, '0.0.0.0', () => r()));
    expect((server.address() as AddressInfo).port).toBe(4799);
  });

  afterAll(async () => {
    for (const i of instanciasCreadas)
      await evo('DELETE', `/instance/delete/${i}`).catch(() => undefined);
    await new Promise((r) => server.close(() => r(undefined)));
  });

  it('QA-01 estado inicial: disponible y NO_CONECTADO', async () => {
    expect(await A.svc.estado(901)).toMatchObject({
      disponible: true,
      estado: 'NO_CONECTADO',
      topeDiario: 300,
    });
  });

  it('QA-02 conectar: crea instancia real y devuelve un QR PNG', async () => {
    const r = await A.svc.conectar(901);
    instanciasCreadas.push(A.prisma.filas[0].instancia);
    expect(r.estado).toBe('CONECTANDO');
    expect(r.qr).toMatch(/^data:image\/png;base64,/);
    expect(A.prisma.filas[0].instancia).toMatch(/^krezka-901-[0-9a-f]{12}$/);
  });

  it('QA-03 Evolution guardó el webhook con url, header secreto y solo nuestros eventos', async () => {
    const w = await evo('GET', `/webhook/find/${A.prisma.filas[0].instancia}`);
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({
      enabled: true,
      url: `${WEBHOOK_BASE}/api/whatsapp/evolution/webhook`,
      headers: { 'x-krezka-webhook-secret': SECRETO },
    });
    expect([...w.body.events].sort()).toEqual([
      'CONNECTION_UPDATE',
      'QRCODE_UPDATED',
    ]);
  });

  it('QA-04 el webhook real llega firmado y se acepta (QRCODE_UPDATED)', async () => {
    const ok = await esperar(() =>
      recibidos.some((x) => x.status === 200 && /qrcode/i.test(x.evento)),
    );
    expect(ok).toBe(true);
    expect(recibidos.every((x) => x.status === 200)).toBe(true);
    expect(A.notificaciones.emitirEventoAUsuarios).toHaveBeenCalledWith(
      [911],
      'whatsapp-conexion',
      expect.objectContaining({
        qr: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    );
  });

  it('QA-05 refrescar QR (GET /qr) con el token de la instancia', async () => {
    const r = await A.svc.qr(901);
    expect(r.estado).toBe('CONECTANDO');
    expect(r.qr === null || /^data:image\/png;base64,/.test(r.qr)).toBe(true);
  });

  it('QA-06 el token de la instancia sirve para ella y NO para otra instancia', async () => {
    const B = montar(902);
    await B.svc.conectar(902);
    instanciasCreadas.push(B.prisma.filas[0].instancia);
    const { descifrarSecreto } = await import(
      '../../common/utils/secreto.util'
    );
    const tokA = descifrarSecreto(A.prisma.filas[0].tokenCifrado)!;
    const propio = await evo(
      'GET',
      `/instance/connectionState/${A.prisma.filas[0].instancia}`,
      tokA,
    );
    const ajeno = await evo(
      'GET',
      `/instance/connectionState/${B.prisma.filas[0].instancia}`,
      tokA,
    );
    expect(propio.status).toBe(200);
    expect(ajeno.status).toBe(401);
    const crear = await evo('POST', '/instance/create', tokA, {
      instanceName: 'intruso',
      integration: 'WHATSAPP-BAILEYS',
    });
    expect([401, 403]).toContain(crear.status);
    await B.svc.desconectar(902);
  });

  it('QA-07 estado mientras espera el escaneo sigue CONECTANDO (sincroniza con connectionState)', async () => {
    expect((await A.svc.estado(901)).estado).toBe('CONECTANDO');
  });

  it('QA-08 prueba sin escanear: ok false y mensaje claro', async () => {
    expect(await A.svc.probar(901, 911)).toEqual({
      ok: false,
      error: 'El WhatsApp del negocio no está conectado.',
    });
  });

  it('QA-09 sendText real a una instancia sin sesión: error mapeado y sin secretos', async () => {
    const cli = A.envio.cliente(A.envio.leerEnv()!);
    const e = await cli
      .enviarTexto(A.prisma.filas[0].instancia, KEY, '51987654321', 'hola')
      .catch((x) => x);
    expect(e?.name).toBe('EvolutionError');
    expect(e.message).not.toContain(KEY);
    // eslint-disable-next-line no-console
    console.log(
      `QA-09 sendText sin sesión → ${e.codigo} (HTTP ${e.status ?? '-'})`,
    );
  });

  it('QA-10 número del negocio sin Evolution conectado ni Takiy: via null (sigue Meta)', async () => {
    const nn = new NumeroNegocioService(A.prisma as never, A.envio);
    expect(
      await nn.enviar(901, { numero: '987654321', mensaje: 'x' }),
    ).toMatchObject({ success: false, via: null });
  });

  it('QA-11 webhook con secreto falso → 401 (contra el servidor local real)', async () => {
    const r = await fetch(
      'http://127.0.0.1:4799/api/whatsapp/evolution/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-krezka-webhook-secret': 'falso',
        },
        body: JSON.stringify({
          event: 'connection.update',
          instance: A.prisma.filas[0].instancia,
          data: { state: 'open' },
        }),
      },
    );
    expect(r.status).toBe(401);
    expect(A.prisma.filas[0].estado).toBe('CONECTANDO');
  });

  it('QA-12 código de emparejamiento con número (rehace la instancia en espera)', async () => {
    const antes = A.prisma.filas[0].instancia;
    const r = await A.svc.conectar(901, '987654321');
    instanciasCreadas.push(A.prisma.filas[0].instancia);
    expect(r.estado).toBe('CONECTANDO');
    expect(r.codigoEmparejamiento).toMatch(/^[A-Z0-9]{8}$/);
    expect(A.prisma.filas[0].instancia).not.toBe(antes);
    const vieja = await evo('GET', `/instance/connectionState/${antes}`);
    expect(vieja.status).toBe(404);
  });

  it('QA-13 llave global equivocada → 502 en español, sin filtrar la llave', async () => {
    const X = montar(903, { EVOLUTION_API_KEY: 'llave-incorrecta-xyz' });
    const e = await X.svc.conectar(903).catch((x) => x);
    expect(e?.getStatus?.()).toBe(502);
    expect(String(e.message)).not.toMatch(/llave-incorrecta-xyz/);
    expect(X.prisma.filas).toHaveLength(0);
  });

  it('QA-14 Evolution inalcanzable → 502 y no deja fila', async () => {
    const X = montar(904, { EVOLUTION_API_URL: 'http://127.0.0.1:1' });
    const e = await X.svc.conectar(904).catch((x) => x);
    expect(e?.getStatus?.()).toBe(502);
    expect(X.prisma.filas).toHaveLength(0);
  });

  it('QA-15 desconectar: Evolution borra la instancia y no hay aviso', async () => {
    const instancia = A.prisma.filas[0].instancia;
    const r = await A.svc.desconectar(901);
    expect(r.estado).toBe('NO_CONECTADO');
    // Evolution responde "deleted" y limpia en segundo plano: se espera un poco.
    let sigue = true;
    const fin = Date.now() + 10_000;
    while (sigue && Date.now() < fin) {
      const lista = await evo(
        'GET',
        `/instance/fetchInstances?instanceName=${instancia}`,
      );
      sigue =
        Array.isArray(lista.body) &&
        lista.body.some((i: any) => i.name === instancia);
      if (sigue) await new Promise((r) => setTimeout(r, 300));
    }
    expect(sigue).toBe(false);
    expect(A.notificaciones.notificarAdminsEmpresa).not.toHaveBeenCalled();
  });

  it('QA-16 tras desconectar: /qr responde NO_CONECTADO y reconectar crea OTRA instancia', async () => {
    expect(await A.svc.qr(901)).toMatchObject({
      estado: 'NO_CONECTADO',
      qr: null,
    });
    const antes = instanciasCreadas[0];
    await A.svc.conectar(901);
    instanciasCreadas.push(A.prisma.filas[0].instancia);
    expect(A.prisma.filas[0].instancia).not.toBe(antes);
    await A.svc.desconectar(901);
  });

  it('QA-17 ninguna respuesta del panel contiene la llave global ni tokens', async () => {
    const respuestas = [
      await A.svc.estado(901),
      await A.svc.conectar(901),
      await A.svc.qr(901),
    ];
    instanciasCreadas.push(A.prisma.filas[0].instancia);
    const { descifrarSecreto } = await import(
      '../../common/utils/secreto.util'
    );
    const tok = descifrarSecreto(A.prisma.filas[0].tokenCifrado)!;
    for (const r of respuestas) {
      const j = JSON.stringify(r);
      expect(j).not.toContain(KEY);
      expect(j).not.toContain(tok);
    }
    await A.svc.desconectar(901);
  });
});
