import { cifrarSecreto } from '../common/utils/secreto.util';
import { EvolutionEnvioService, ResultadoEvolution } from './evolution-envio.service';
import { leerEvolutionEnv } from './evolution-config';
import { ENV_EVOLUTION, fetchFake, prismaFake } from './evolution.fixtures';

// 2026-11-01 15:00 en Lima (20:00 UTC).
const T0 = Date.UTC(2026, 10, 1, 20, 0, 0);

function armar(
  o: {
    env?: Record<string, string | undefined>;
    fila?: any;
    rutas?: any[];
  } = {},
) {
  const prisma = prismaFake({
    filas: [
      {
        empresaId: 1,
        instancia: 'krezka-1-abc',
        estado: 'CONECTADO',
        tokenCifrado: cifrarSecreto('tok-instancia'),
        ...(o.fila ?? {}),
      },
    ],
  });
  const f = fetchFake(
    o.rutas ?? [{ match: /message\/send/, status: 201, body: { key: {} } }],
  );
  const svc = new EvolutionEnvioService(prisma as never);
  let reloj = T0;
  const pausas: number[] = [];
  svc.leerEnv = () => leerEvolutionEnv({ ...ENV_EVOLUTION, ...(o.env ?? {}) });
  svc.fetchImpl = f.impl;
  svc.ahora = () => reloj;
  svc.azar = () => 0.5;
  svc.dormir = async (ms) => {
    pausas.push(ms);
    reloj += ms;
  };
  return {
    svc,
    prisma,
    f,
    pausas,
    avanzar: (ms: number) => (reloj += ms),
    fila: () => prisma.filas[0],
  };
}

describe('envío por Evolution: estado y piloto', () => {
  it('fuera del piloto: NO_DISPONIBLE y no llama a Evolution', async () => {
    const { svc, f } = armar({ env: { EVOLUTION_EMPRESAS_PILOTO: '2,3' } });
    const r = await svc.enviar(1, { numero: '987654321', mensaje: 'hola' });
    expect(r).toMatchObject({ success: false, motivo: 'NO_DISPONIBLE' });
    expect(f.llamadas).toHaveLength(0);
    expect(await svc.conectado(1)).toBe(false);
  });

  it('sin variables de entorno: NO_DISPONIBLE', async () => {
    const { svc } = armar();
    svc.leerEnv = () => leerEvolutionEnv({});
    expect(
      await svc.enviar(1, { numero: '987654321', mensaje: 'x' }),
    ).toMatchObject({ motivo: 'NO_DISPONIBLE' });
  });

  it('con la sesión caída: NO_CONECTADO', async () => {
    const { svc, f } = armar({ fila: { estado: 'DESCONECTADO' } });
    expect(
      await svc.enviar(1, { numero: '987654321', mensaje: 'x' }),
    ).toMatchObject({ motivo: 'NO_CONECTADO' });
    expect(f.llamadas).toHaveLength(0);
  });

  it('número inválido: no gasta cupo', async () => {
    const { svc, fila } = armar();
    expect(
      await svc.enviar(1, { numero: '12345', mensaje: 'x' }),
    ).toMatchObject({ motivo: 'NUMERO_INVALIDO' });
    expect(fila().enviadosHoy).toBe(0);
  });
});

describe('envío por Evolution: lo que se manda', () => {
  it('9 dígitos → 51…, con el token de la instancia (no la llave global)', async () => {
    const { svc, f } = armar();
    const r = await svc.enviar(1, { numero: '987 654 321', mensaje: ' hola ' });
    expect(r).toEqual({ success: true });
    expect(f.llamadas[0].url).toBe(
      'http://evolution.railway.internal:8080/message/sendText/krezka-1-abc',
    );
    expect(f.llamadas[0].headers.apikey).toBe('tok-instancia');
    expect(f.llamadas[0].body).toMatchObject({
      number: '51987654321',
      text: 'hola',
    });
  });

  it('token ilegible (llave rotada) → usa la llave global', async () => {
    const { svc, f } = armar({ fila: { tokenCifrado: 'v1:basura' } });
    await svc.enviar(1, { numero: '51987654321', mensaje: 'x' });
    expect(f.llamadas[0].headers.apikey).toBe('LLAVE-GLOBAL-SUPER-SECRETA');
  });

  it('con archivo: sendMedia con el mensaje como pie', async () => {
    const { svc, f } = armar();
    await svc.enviar(1, {
      numero: '987654321',
      mensaje: 'Tu boleta',
      archivoUrl: 'https://s3/B001-9.pdf',
      nombreArchivo: 'Boleta_B001-9.pdf',
    });
    expect(f.llamadas[0].url).toMatch(/sendMedia\/krezka-1-abc$/);
    expect(f.llamadas[0].body).toMatchObject({
      mediatype: 'document',
      caption: 'Tu boleta',
      fileName: 'Boleta_B001-9.pdf',
    });
  });
});

describe('anti-bloqueo: pausa aleatoria entre mensajes del mismo número', () => {
  it('el primero sale al toque; los siguientes esperan entre 3 y 7 s', async () => {
    const { svc, pausas, f } = armar();
    await Promise.all([
      svc.enviar(1, { numero: '987654321', mensaje: '1' }),
      svc.enviar(1, { numero: '987654322', mensaje: '2' }),
      svc.enviar(1, { numero: '987654323', mensaje: '3' }),
    ]);
    // azar 0.5 → 3000 + floor(0.5 * 4001) = 5000 ms
    expect(pausas).toEqual([5000, 5000]);
    // Salen en orden, de a uno.
    expect(f.llamadas.map((l) => l.body.text)).toEqual(['1', '2', '3']);
  });

  it('si ya pasó la pausa desde el último, no espera', async () => {
    const { svc, pausas, avanzar } = armar();
    await svc.enviar(1, { numero: '987654321', mensaje: '1' });
    avanzar(60_000);
    await svc.enviar(1, { numero: '987654321', mensaje: '2' });
    expect(pausas).toEqual([]);
  });

  it('la pausa respeta los extremos configurados', async () => {
    const { svc, pausas } = armar({
      env: { EVOLUTION_PAUSA_MIN_MS: '1000', EVOLUTION_PAUSA_MAX_MS: '2000' },
    });
    svc.azar = () => 0.999999;
    await Promise.all([
      svc.enviar(1, { numero: '987654321', mensaje: 'a' }),
      svc.enviar(1, { numero: '987654321', mensaje: 'b' }),
    ]);
    expect(pausas[0]).toBeGreaterThanOrEqual(1000);
    expect(pausas[0]).toBeLessThanOrEqual(2000);
  });

  it('cola llena: el mensaje no espera (pasa al siguiente proveedor)', async () => {
    const { svc } = armar({ env: { EVOLUTION_COLA_MAX: '2' } });
    const rs = await Promise.all(
      [1, 2, 3].map((i) =>
        svc.enviar(1, { numero: '987654321', mensaje: String(i) }),
      ),
    );
    expect(rs.map((r) => (r.success ? 'ok' : r.motivo))).toEqual([
      'ok',
      'ok',
      'COLA_LLENA',
    ]);
  });

  it('un envío que falla no traba la cola', async () => {
    let n = 0;
    const { svc } = armar({ rutas: [] });
    svc.fetchImpl = (async () => {
      n += 1;
      if (n === 1) throw new Error('ECONNRESET');
      return { ok: true, status: 201, json: async () => ({}) };
    }) as never;
    const rs = await Promise.all([
      svc.enviar(1, { numero: '987654321', mensaje: 'a' }),
      svc.enviar(1, { numero: '987654321', mensaje: 'b' }),
    ]);
    expect(rs.map((r) => r.success)).toEqual([false, true]);
  });
});

describe('anti-bloqueo: tope diario por número', () => {
  it('al llegar al tope no se llama a Evolution', async () => {
    const { svc, f, fila } = armar({
      env: { EVOLUTION_TOPE_DIARIO: '2' },
      fila: { enviadosHoy: 0, enviadosDia: '2026-11-01' },
    });
    svc.dormir = async () => undefined;
    const rs: ResultadoEvolution[] = [];
    for (const i of [1, 2, 3])
      rs.push(await svc.enviar(1, { numero: '987654321', mensaje: String(i) }));
    expect(rs.map((r) => (r.success ? 'ok' : r.motivo))).toEqual([
      'ok',
      'ok',
      'TOPE_DIARIO',
    ]);
    expect(f.llamadas).toHaveLength(2);
    expect(fila().enviadosHoy).toBe(2);
    expect(svc.enviadosHoy(fila())).toBe(2);
  });

  it('el contador se reinicia al cambiar el día en Lima', async () => {
    const { svc, fila } = armar({
      env: { EVOLUTION_TOPE_DIARIO: '2' },
      fila: { enviadosHoy: 2, enviadosDia: '2026-10-31' },
    });
    expect(svc.enviadosHoy(fila())).toBe(0);
    expect(await svc.enviar(1, { numero: '987654321', mensaje: 'x' })).toEqual({
      success: true,
    });
    expect([fila().enviadosHoy, fila().enviadosDia]).toEqual([1, '2026-11-01']);
  });

  it('a las 23:30 de Lima sigue siendo el mismo día (no UTC)', () => {
    const { svc } = armar();
    svc.ahora = () => Date.UTC(2026, 10, 2, 4, 30); // 23:30 del 1 en Lima
    expect(svc.hoy()).toBe('2026-11-01');
  });

  it('un fallo claro devuelve el cupo; uno ambiguo (timeout) no', async () => {
    const { svc, fila } = armar({
      rutas: [
        {
          match: /./,
          status: 400,
          body: { response: { message: [{ exists: false }] } },
        },
      ],
    });
    const r = await svc.enviar(1, { numero: '987654321', mensaje: 'x' });
    expect(r).toMatchObject({
      success: false,
      motivo: 'ENVIO',
      error: 'Ese número no tiene WhatsApp.',
    });
    expect(fila().enviadosHoy).toBe(0);

    const t = armar({
      rutas: [
        {
          match: /./,
          error: Object.assign(new Error('t'), { name: 'TimeoutError' }),
        },
      ],
    });
    const r2 = await t.svc.enviar(1, { numero: '987654321', mensaje: 'x' });
    expect(r2).toMatchObject({ success: false, ambiguo: true });
    expect(t.fila().enviadosHoy).toBe(1);
  });
});
