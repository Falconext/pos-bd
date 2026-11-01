import {
  BadGatewayException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  cifrarSecreto,
  descifrarSecreto,
} from '../../common/utils/secreto.util';
import { EvolutionEnvioService } from '../evolution-envio.service';
import { leerEvolutionEnv } from '../evolution-config';
import { ENV_EVOLUTION, fetchFake, prismaFake } from '../evolution.fixtures';
import {
  EVENTO_SOCKET,
  MENSAJE_PRUEBA,
  WhatsappConexionService,
  secretoValido,
} from './whatsapp-conexion.service';
import { transicion } from './estado-conexion';

const SECRETO = ENV_EVOLUTION.EVOLUTION_WEBHOOK_SECRET;
const LLAVE = ENV_EVOLUTION.EVOLUTION_API_KEY;

function armar(
  o: {
    env?: Record<string, string | undefined>;
    filas?: any[];
    rutas?: any[];
    empresa?: any;
  } = {},
) {
  const prisma = prismaFake({ filas: o.filas ?? [], empresa: o.empresa });
  const f = fetchFake(
    o.rutas ?? [
      {
        match: /POST .*instance\/create/,
        status: 201,
        body: {
          hash: 'h',
          qrcode: { base64: 'data:image/png;base64,QR1', pairingCode: null },
        },
      },
      {
        match: /GET .*instance\/connect\//,
        body: {
          base64: 'data:image/png;base64,QR2',
          pairingCode: null,
          count: 2,
        },
      },
      { match: /GET .*connectionState/, body: { instance: { state: 'open' } } },
      { match: /DELETE/, body: { status: 'SUCCESS' } },
      { match: /message\/send/, status: 201, body: {} },
    ],
  );
  const envio = new EvolutionEnvioService(prisma as never);
  envio.leerEnv = () =>
    leerEvolutionEnv({ ...ENV_EVOLUTION, ...(o.env ?? {}) });
  envio.fetchImpl = f.impl;
  envio.dormir = async () => undefined;
  const notificaciones = {
    notificarAdminsEmpresa: jest.fn(async () => undefined),
    emitirEventoAUsuarios: jest.fn(),
  };
  const svc = new WhatsappConexionService(
    prisma as never,
    envio,
    notificaciones as never,
  );
  const correos: { para: string[]; asunto: string; html: string }[] = [];
  svc.enviarCorreo = async (para, asunto, html) => {
    correos.push({ para, asunto, html });
  };
  return {
    svc,
    prisma,
    f,
    notificaciones,
    correos,
    fila: () => prisma.filas[0],
  };
}

const conectada = (extra: any = {}) => ({
  empresaId: 1,
  instancia: 'krezka-1-a1b2c3d4e5f6',
  tokenCifrado: cifrarSecreto('tok-instancia'),
  estado: 'CONECTADO',
  numero: '51987654321',
  conectadoEn: new Date('2026-10-30T10:00:00Z'),
  ...extra,
});

const evento = (state: string, extra: any = {}) => ({
  event: 'connection.update',
  instance: 'krezka-1-a1b2c3d4e5f6',
  data: {
    instance: 'krezka-1-a1b2c3d4e5f6',
    state,
    statusReason: 401,
    ...extra,
  },
  sender: '51987654321@s.whatsapp.net',
  apikey: null,
});

describe('GET /whatsapp/conexion', () => {
  it('sin variables de Evolution: disponible false, sin llamar a nada, igual informa Takiy', async () => {
    const { svc, f } = armar({
      env: { EVOLUTION_API_URL: '' },
      empresa: { takiyActivo: true },
    });
    const r = await svc.estado(1);
    expect(r).toMatchObject({
      disponible: false,
      proveedor: 'EVOLUTION',
      estado: 'NO_CONECTADO',
      takiyActivo: true,
      topeDiario: 0,
    });
    expect(f.llamadas).toHaveLength(0);
  });

  it('fuera del piloto: disponible false', async () => {
    const { svc } = armar({ env: { EVOLUTION_EMPRESAS_PILOTO: '5' } });
    expect((await svc.estado(1)).disponible).toBe(false);
  });

  it('conectado: número, perfil, contador y tope; nunca la llave ni el token', async () => {
    const { svc } = armar({
      filas: [
        conectada({
          nombrePerfil: 'Bodega Ana',
          enviadosHoy: 4,
          enviadosDia: null,
        }),
      ],
    });
    const r = await svc.estado(1);
    expect(r).toMatchObject({
      disponible: true,
      estado: 'CONECTADO',
      numero: '51987654321',
      nombrePerfil: 'Bodega Ana',
      topeDiario: 300,
      enviadosHoy: 0,
    });
    const json = JSON.stringify(r);
    expect(json).not.toContain(LLAVE);
    expect(json).not.toContain('tok-instancia');
    expect(json).not.toContain('tokenCifrado');
    expect(json).not.toContain('krezka-1-');
  });

  it('si se perdió el webhook de cierre, el GET lo detecta y avisa una vez', async () => {
    const { svc, notificaciones, correos } = armar({
      filas: [conectada()],
      rutas: [
        { match: /connectionState/, body: { instance: { state: 'close' } } },
      ],
    });
    expect((await svc.estado(1)).estado).toBe('DESCONECTADO');
    expect((await svc.estado(1)).estado).toBe('DESCONECTADO');
    expect(notificaciones.notificarAdminsEmpresa).toHaveBeenCalledTimes(1);
    expect(correos).toHaveLength(1);
  });

  it('si Evolution no responde, se queda con lo guardado', async () => {
    const { svc } = armar({
      filas: [conectada()],
      rutas: [{ match: /./, error: new Error('ECONNREFUSED') }],
    });
    expect((await svc.estado(1)).estado).toBe('CONECTADO');
  });
});

describe('POST /whatsapp/conexion', () => {
  it('fuera del piloto: 400 en español', async () => {
    const { svc } = armar({ env: { EVOLUTION_EMPRESAS_PILOTO: '' } });
    await expect(svc.conectar(1)).rejects.toThrow(/aún no está habilitada/);
  });

  it('crea la instancia con nombre no adivinable, token cifrado y webhook firmado', async () => {
    const { svc, f, fila } = armar();
    const r = await svc.conectar(1);
    expect(r).toEqual({
      estado: 'CONECTANDO',
      qr: 'data:image/png;base64,QR1',
      codigoEmparejamiento: null,
      expiraEnSeg: 20,
    });
    const crear = f.llamadas[0];
    expect(crear.body.instanceName).toMatch(/^krezka-1-[0-9a-f]{12}$/);
    expect(crear.body.webhook).toMatchObject({
      url: 'https://api.krezka.com/api/whatsapp/evolution/webhook',
      headers: { 'x-krezka-webhook-secret': SECRETO },
      events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED'],
    });
    expect(fila().instancia).toBe(crear.body.instanceName);
    // Token guardado cifrado, y es el mismo que se le dio a Evolution.
    expect(fila().tokenCifrado).not.toBe(crear.body.token);
    expect(descifrarSecreto(fila().tokenCifrado)).toBe(crear.body.token);
    expect(JSON.stringify(r)).not.toContain(LLAVE);
  });

  it('dos empresas → nombres distintos', async () => {
    const a = armar();
    const b = armar();
    await a.svc.conectar(1);
    await b.svc.conectar(1);
    expect(a.fila().instancia).not.toBe(b.fila().instancia);
  });

  it('con número: pide código de emparejamiento (51 + 9 dígitos)', async () => {
    const { svc, f } = armar();
    await svc.conectar(1, '987 654 321');
    expect(f.llamadas[0].body.number).toBe('51987654321');
  });

  it('con número y una instancia esperando el QR: la rehace para que Evolution dé el código', async () => {
    const { svc, f, prisma } = armar({
      filas: [conectada({ estado: 'CONECTANDO', conectadoEn: null })],
      rutas: [
        { match: /DELETE .*instance\/delete/, body: {} },
        {
          match: /POST .*create/,
          status: 201,
          body: {
            qrcode: {
              base64: 'data:image/png;base64,Q',
              pairingCode: 'KDRZ6CNB',
            },
          },
        },
      ],
    });
    const r = await svc.conectar(1, '987654321');
    expect(r.codigoEmparejamiento).toBe('KDRZ6CNB');
    expect(
      f.llamadas.map((l) => l.method + ' ' + l.url.replace(/^.*8080/, '')),
    ).toEqual([
      'DELETE /instance/delete/krezka-1-a1b2c3d4e5f6',
      expect.stringMatching(/^POST \/instance\/create$/),
    ]);
    expect(f.llamadas[1].body.number).toBe('51987654321');
    expect(prisma.filas).toHaveLength(1);
    expect(prisma.filas[0].instancia).not.toBe('krezka-1-a1b2c3d4e5f6');
  });

  it('número inválido: 400 claro y no crea nada', async () => {
    const { svc, f, prisma } = armar();
    await expect(svc.conectar(1, '123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.llamadas).toHaveLength(0);
    expect(prisma.filas).toHaveLength(0);
  });

  it('reutiliza la instancia existente (no crea otra)', async () => {
    const { svc, f, prisma } = armar({
      filas: [conectada({ estado: 'DESCONECTADO' })],
    });
    const r = await svc.conectar(1);
    expect(r.qr).toBe('data:image/png;base64,QR2');
    expect(
      f.llamadas.map((l) => l.method + ' ' + l.url.replace(/^.*8080/, '')),
    ).toEqual(['GET /instance/connect/krezka-1-a1b2c3d4e5f6']);
    expect(f.llamadas[0].headers.apikey).toBe('tok-instancia');
    expect(prisma.filas).toHaveLength(1);
    expect(prisma.filas[0].estado).toBe('CONECTANDO');
  });

  it('si la instancia ya no existe en Evolution, la rehace', async () => {
    const { svc, f, prisma } = armar({
      filas: [conectada({ estado: 'DESCONECTADO' })],
      rutas: [
        {
          match: /GET .*connect\//,
          status: 404,
          body: { response: { message: ['does not exist'] } },
        },
        {
          match: /POST .*create/,
          status: 201,
          body: { qrcode: { base64: 'data:image/png;base64,NEW' } },
        },
      ],
    });
    const r = await svc.conectar(1);
    expect(r.qr).toBe('data:image/png;base64,NEW');
    expect(prisma.filas).toHaveLength(1);
    expect(prisma.filas[0].instancia).not.toBe('krezka-1-a1b2c3d4e5f6');
    expect(f.llamadas.at(-1)!.url).toMatch(/instance\/create$/);
  });

  it('ya conectado: no pide QR', async () => {
    const { svc, f } = armar({ filas: [conectada()] });
    expect(await svc.conectar(1)).toMatchObject({
      estado: 'CONECTADO',
      qr: null,
    });
    expect(
      f.llamadas.some((l) => /connect\//.test(l.url) || /create/.test(l.url)),
    ).toBe(false);
  });

  it('Evolution caído al crear: 502 en español, sin la llave, y no deja fila huérfana', async () => {
    const { svc, prisma } = armar({
      rutas: [{ match: /./, error: new Error(`ECONNREFUSED ${LLAVE}`) }],
    });
    const e = await svc.conectar(1).catch((x) => x);
    expect(e).toBeInstanceOf(BadGatewayException);
    expect(e.message).toMatch(/servidor de WhatsApp/);
    expect(e.message).not.toContain(LLAVE);
    expect(prisma.filas).toHaveLength(0);
  });

  it('llave global rechazada (401): 502 genérico, nunca el detalle', async () => {
    const { svc } = armar({
      rutas: [{ match: /./, status: 401, body: { message: LLAVE } }],
    });
    const e = await svc.conectar(1).catch((x) => x);
    expect(e).toBeInstanceOf(BadGatewayException);
    expect(e.message).not.toContain(LLAVE);
  });
});

describe('GET /whatsapp/conexion/qr', () => {
  it('refresca el QR de la instancia en espera', async () => {
    const { svc } = armar({
      filas: [conectada({ estado: 'CONECTANDO', conectadoEn: null })],
    });
    expect(await svc.qr(1)).toEqual({
      estado: 'CONECTANDO',
      qr: 'data:image/png;base64,QR2',
      codigoEmparejamiento: null,
      expiraEnSeg: 20,
    });
  });

  it('si mientras tanto escaneó, responde CONECTADO sin QR', async () => {
    const { svc, fila } = armar({
      filas: [conectada({ estado: 'CONECTANDO', conectadoEn: null })],
      rutas: [
        {
          match: /connect\//,
          body: { instance: { instanceName: 'x', state: 'open' } },
        },
      ],
    });
    expect(await svc.qr(1)).toMatchObject({ estado: 'CONECTADO', qr: null });
    expect(fila().conectadoEn).toBeInstanceOf(Date);
  });

  it('sin instancia: NO_CONECTADO', async () => {
    const { svc } = armar();
    expect(await svc.qr(1)).toMatchObject({ estado: 'NO_CONECTADO', qr: null });
  });
});

describe('webhook /whatsapp/evolution/webhook', () => {
  it.each([
    ['sin secreto', undefined],
    ['secreto vacío', ''],
    ['secreto equivocado', 'otro'],
    ['secreto más largo', SECRETO + 'x'],
    ['secreto como arreglo', [SECRETO] as any],
  ])('%s → 401 y no toca nada', async (_n, secreto) => {
    const { svc, prisma } = armar({ filas: [conectada()] });
    await expect(svc.webhook(secreto, evento('close'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.whatsappConexion.findUnique).not.toHaveBeenCalled();
  });

  it('con Evolution apagado, ni el secreto correcto entra', async () => {
    const { svc } = armar({ env: { EVOLUTION_API_KEY: '' } });
    await expect(svc.webhook(SECRETO, evento('open'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('open: CONECTADO con número y nombre de perfil; emite al panel', async () => {
    const { svc, fila, notificaciones } = armar({
      filas: [
        conectada({ estado: 'CONECTANDO', numero: null, conectadoEn: null }),
      ],
    });
    await svc.webhook(
      SECRETO,
      evento('open', {
        wuid: '51911222333@s.whatsapp.net',
        profileName: 'Bodega Ana',
      }),
    );
    expect(fila()).toMatchObject({
      estado: 'CONECTADO',
      numero: '51911222333',
      nombrePerfil: 'Bodega Ana',
    });
    expect(notificaciones.emitirEventoAUsuarios).toHaveBeenCalledWith(
      [10],
      EVENTO_SOCKET,
      expect.objectContaining({ estado: 'CONECTADO' }),
    );
  });

  it('close estando conectado: DESCONECTADO y aviso al dueño UNA sola vez (panel + correo)', async () => {
    const { svc, fila, notificaciones, correos } = armar({
      filas: [conectada()],
    });
    await svc.webhook(SECRETO, evento('close'));
    await svc.webhook(SECRETO, evento('close'));
    await svc.webhook(SECRETO, {
      ...evento('refused'),
      event: 'CONNECTION_UPDATE',
    });
    expect(fila().estado).toBe('DESCONECTADO');
    expect(fila().desconectadoEn).toBeInstanceOf(Date);
    expect(notificaciones.notificarAdminsEmpresa).toHaveBeenCalledTimes(1);
    expect(notificaciones.notificarAdminsEmpresa).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 1,
        tipo: 'WARNING',
        titulo: 'Tu WhatsApp se desconectó',
      }),
    );
    expect(correos).toHaveLength(1);
    expect(correos[0].para).toEqual(['dueno@bodega.pe']);
    expect(correos[0].html).toContain('/administrador/perfil');
  });

  it('dos webhooks de cierre a la vez: un solo aviso', async () => {
    const { svc, notificaciones } = armar({ filas: [conectada()] });
    await Promise.all([
      svc.webhook(SECRETO, evento('close')),
      svc.webhook(SECRETO, evento('close')),
    ]);
    expect(notificaciones.notificarAdminsEmpresa).toHaveBeenCalledTimes(1);
  });

  it('reconecta y se vuelve a caer: avisa de nuevo (una vez por caída)', async () => {
    const { svc, notificaciones } = armar({ filas: [conectada()] });
    await svc.webhook(SECRETO, evento('close'));
    await svc.webhook(SECRETO, evento('connecting'));
    await svc.webhook(SECRETO, evento('open'));
    await svc.webhook(SECRETO, evento('close'));
    expect(notificaciones.notificarAdminsEmpresa).toHaveBeenCalledTimes(2);
  });

  it('connecting estando conectado (Baileys reconectando solo): no cambia ni avisa', async () => {
    const { svc, fila, notificaciones } = armar({ filas: [conectada()] });
    await svc.webhook(SECRETO, evento('connecting'));
    expect(fila().estado).toBe('CONECTADO');
    expect(notificaciones.emitirEventoAUsuarios).not.toHaveBeenCalled();
  });

  it('QR vencido sin haber conectado nunca: vuelve a NO_CONECTADO sin aviso', async () => {
    const { svc, fila, notificaciones } = armar({
      filas: [conectada({ estado: 'CONECTANDO', conectadoEn: null })],
    });
    await svc.webhook(SECRETO, evento('refused'));
    expect(fila().estado).toBe('NO_CONECTADO');
    expect(notificaciones.notificarAdminsEmpresa).not.toHaveBeenCalled();
  });

  it('QRCODE_UPDATED: empuja el QR nuevo al panel por socket', async () => {
    const { svc, notificaciones } = armar({
      filas: [conectada({ estado: 'CONECTANDO' })],
    });
    await svc.webhook(SECRETO, {
      event: 'qrcode.updated',
      instance: 'krezka-1-a1b2c3d4e5f6',
      data: {
        qrcode: {
          instance: 'x',
          base64: 'data:image/png;base64,Q',
          pairingCode: null,
        },
      },
    });
    expect(notificaciones.emitirEventoAUsuarios).toHaveBeenCalledWith(
      [10],
      EVENTO_SOCKET,
      {
        estado: 'CONECTANDO',
        qr: 'data:image/png;base64,Q',
        codigoEmparejamiento: null,
      },
    );
  });

  it('instancia desconocida o evento que no interesa: 200 sin cambios', async () => {
    const { svc, fila } = armar({ filas: [conectada()] });
    expect(
      await svc.webhook(SECRETO, { ...evento('close'), instance: 'otra' }),
    ).toEqual({ ok: true });
    expect(
      await svc.webhook(SECRETO, {
        ...evento('close'),
        event: 'messages.upsert',
      }),
    ).toEqual({ ok: true });
    expect(await svc.webhook(SECRETO, null)).toEqual({ ok: true });
    expect(fila().estado).toBe('CONECTADO');
  });
});

describe('DELETE /whatsapp/conexion', () => {
  it('logout + delete en Evolution, borra la fila y el cierre posterior NO avisa', async () => {
    const { svc, f, prisma, notificaciones } = armar({ filas: [conectada()] });
    const r = await svc.desconectar(1);
    expect(r.estado).toBe('NO_CONECTADO');
    expect(
      f.llamadas
        .filter((l) => l.method === 'DELETE')
        .map((l) => l.url.replace(/^.*8080/, '')),
    ).toEqual([
      '/instance/logout/krezka-1-a1b2c3d4e5f6',
      '/instance/delete/krezka-1-a1b2c3d4e5f6',
    ]);
    expect(prisma.filas).toHaveLength(0);
    await svc.webhook(SECRETO, evento('close'));
    expect(notificaciones.notificarAdminsEmpresa).not.toHaveBeenCalled();
  });

  it('el cierre que llega mientras se desconecta tampoco avisa', async () => {
    const { svc, notificaciones, f } = armar({ filas: [conectada()] });
    // Evolution manda el CONNECTION_UPDATE close justo durante el logout.
    const original = f.mock.getMockImplementation()!;
    f.mock.mockImplementation(async (url: any, init: any) => {
      if (/logout/.test(String(url)))
        await svc.webhook(SECRETO, evento('close'));
      return original(url, init);
    });
    await svc.desconectar(1);
    expect(notificaciones.notificarAdminsEmpresa).not.toHaveBeenCalled();
  });

  it('si Evolution no puede borrar, la conexión queda como estaba (502)', async () => {
    const { svc, prisma } = armar({
      filas: [conectada()],
      rutas: [
        { match: /delete/, error: new Error('ECONNREFUSED') },
        { match: /logout/, body: {} },
      ],
    });
    await expect(svc.desconectar(1)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(prisma.filas).toHaveLength(1);
    expect(prisma.filas[0].estado).toBe('CONECTADO');
  });

  it('si la instancia ya no existía, igual queda NO_CONECTADO', async () => {
    const { svc, prisma } = armar({
      filas: [conectada()],
      rutas: [{ match: /DELETE/, status: 404, body: {} }],
    });
    expect((await svc.desconectar(1)).estado).toBe('NO_CONECTADO');
    expect(prisma.filas).toHaveLength(0);
  });
});

describe('POST /whatsapp/conexion/prueba', () => {
  it('por defecto al celular del usuario, con el texto acordado', async () => {
    const { svc, f } = armar({ filas: [conectada()] });
    expect(await svc.probar(1, 10)).toEqual({ ok: true });
    expect(f.llamadas.at(-1)!.body).toMatchObject({
      number: '51987654321',
      text: MENSAJE_PRUEBA,
    });
  });

  it('a otro número si se indica', async () => {
    const { svc, f } = armar({ filas: [conectada()] });
    await svc.probar(1, 10, '911222333');
    expect(f.llamadas.at(-1)!.body.number).toBe('51911222333');
  });

  it('sin conexión: ok false con el motivo', async () => {
    const { svc } = armar();
    expect(await svc.probar(1, 10)).toEqual({
      ok: false,
      error: 'El WhatsApp del negocio no está conectado.',
    });
  });
});

describe('PATCH /whatsapp/conexion', () => {
  it('guarda "enviar comprobante al emitir"', async () => {
    const { svc, prisma } = armar();
    const r = await svc.configurar(1, { enviarComprobante: true });
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { takiyEnviarComprobante: true },
    });
    expect(r.enviarComprobante).toBe(true);
  });
  it('valor que no es booleano: 400', async () => {
    const { svc } = armar();
    await expect(
      svc.configurar(1, { enviarComprobante: 'si' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('helpers', () => {
  it('secretoValido: tiempo constante y tolera largos distintos', () => {
    expect(secretoValido('abc', 'abc')).toBe(true);
    expect(secretoValido('abcd', 'abc')).toBe(false);
    expect(secretoValido('abc', '')).toBe(false);
  });
  it('transicion: DESCONECTADO + close no vuelve a avisar', () => {
    expect(
      transicion(
        {
          estado: 'DESCONECTADO',
          conectadoEn: new Date(),
          avisoDesconexionEn: new Date(),
        },
        'close',
        new Date(),
      ),
    ).toBeNull();
  });
});
