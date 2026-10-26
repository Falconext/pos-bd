/**
 * Envíos masivos: a quién se le manda justo antes de mandar, y cuándo parar.
 *
 * Entre que se confirma un envío y sale pueden pasar días. Se cuida que en
 * ese momento se respete la baja, el tope de comerciales y al asesor que esté
 * atendiendo; que Instagram solo reciba dentro de las 24 h; y que un error de
 * la plantilla detenga el envío en vez de fallar con toda la lista.
 */
import {
  RITMO_MAX,
  RITMO_MIN,
  cambiosPorEstado,
  compraDelEnvio,
  decidirDestinatario,
  inicioDelDiaLima,
  esFallaDePlantilla,
  excedeNivel,
  fechaProgramada,
  ritmoValido,
} from './envios-masivos';

const AHORA = new Date('2026-10-27T15:00:00Z');
const base = {
  canal: 'WHATSAPP',
  interno: false,
  deBaja: false,
  marketingRecientes: 0,
  tope: 2,
  botPausado: false,
  ultimoMensajeDelCliente: new Date(AHORA.getTime() - 10 * 24 * 3600_000),
  ahora: AHORA,
};

describe('decidirDestinatario', () => {
  it('WhatsApp va por plantilla aunque haga días que no escribe', () => {
    expect(decidirDestinatario(base)).toEqual({
      enviar: true,
      via: 'plantilla',
    });
  });

  it('la baja, el número interno y el tope frenan', () => {
    expect(decidirDestinatario({ ...base, deBaja: true })).toMatchObject({
      enviar: false,
    });
    expect(decidirDestinatario({ ...base, interno: true })).toMatchObject({
      enviar: false,
    });
    expect(
      decidirDestinatario({ ...base, marketingRecientes: 2 }),
    ).toMatchObject({
      enviar: false,
      motivo: expect.stringMatching(/Ya recibió 2/),
    });
  });

  it('no se mete en medio de una conversación con un asesor', () => {
    expect(decidirDestinatario({ ...base, botPausado: true })).toEqual({
      enviar: false,
      motivo: 'Había alguien atendiendo este chat.',
    });
  });

  it('Instagram: texto dentro de las 24 h, nada fuera', () => {
    expect(
      decidirDestinatario({
        ...base,
        canal: 'INSTAGRAM',
        ultimoMensajeDelCliente: new Date(AHORA.getTime() - 3600_000),
      }),
    ).toEqual({ enviar: true, via: 'texto' });
    expect(decidirDestinatario({ ...base, canal: 'INSTAGRAM' })).toMatchObject({
      enviar: false,
      motivo: expect.stringMatching(/^Instagram/),
    });
    expect(decidirDestinatario({ ...base, canal: 'MESSENGER' })).toMatchObject({
      motivo: expect.stringMatching(/^Messenger/),
    });
  });
});

describe('fechaProgramada', () => {
  it('sin fecha es ahora', () => {
    expect(fechaProgramada(null, AHORA)).toEqual({ fecha: AHORA });
  });

  it('una fecha pasada o muy lejana es un error, no un "ya"', () => {
    expect(fechaProgramada('2026-10-20T10:00:00Z', AHORA)).toEqual({
      error: 'La fecha programada ya pasó.',
    });
    expect(fechaProgramada('2027-03-01T10:00:00Z', AHORA)).toMatchObject({
      error: expect.stringMatching(/30 días/),
    });
    expect(fechaProgramada('mañana', AHORA)).toMatchObject({
      error: expect.any(String),
    });
  });

  it('unos minutos atrás se toleran (el reloj del navegador)', () => {
    expect(fechaProgramada('2026-10-27T14:58:00Z', AHORA)).toHaveProperty(
      'fecha',
    );
  });
});

describe('ritmo y nivel', () => {
  it('el ritmo queda entre el mínimo y el máximo', () => {
    expect(ritmoValido(1)).toBe(RITMO_MIN);
    expect(ritmoValido(1000)).toBe(RITMO_MAX);
    expect(ritmoValido('abc')).toBe(30);
  });

  it('pasarse del nivel de Meta se ve antes de confirmar', () => {
    expect(excedeNivel(300, 250)).toBe(true);
    expect(excedeNivel(250, 250)).toBe(false);
    expect(excedeNivel(300, null)).toBe(false);
  });
});

describe('esFallaDePlantilla', () => {
  it('reconoce los errores de plantilla de Meta y no los del destinatario', () => {
    expect(
      esFallaDePlantilla(
        '(#132001) Template name does not exist in the translation',
      ),
    ).toBe(true);
    expect(esFallaDePlantilla('(#132015) Template is paused')).toBe(true);
    expect(esFallaDePlantilla('(#131026) Message undeliverable')).toBe(false);
    expect(esFallaDePlantilla(null)).toBe(false);
  });
});

describe('estados de WhatsApp', () => {
  it('read implica entregado; failed trae el motivo', () => {
    expect(
      cambiosPorEstado({
        id: 'w',
        status: 'delivered',
        timestamp: '1793050000',
      }),
    ).toEqual({
      entregadoEn: new Date(1793050000 * 1000),
    });
    expect(
      cambiosPorEstado({ id: 'w', status: 'read', timestamp: 1793050060 }),
    ).toEqual({
      entregadoEn: new Date(1793050060 * 1000),
      leidoEn: new Date(1793050060 * 1000),
    });
    expect(
      cambiosPorEstado({
        id: 'w',
        status: 'failed',
        errors: [
          {
            code: 131049,
            title: 'x',
            error_data: { details: 'No entregado por salud del ecosistema' },
          },
        ],
      }),
    ).toEqual({ fallo: '(#131049) No entregado por salud del ecosistema' });
    expect(cambiosPorEstado({ id: 'w', status: 'sent' })).toBeNull();
  });
});

describe('compraDelEnvio', () => {
  // 27-10 a las 15:00 de Lima.
  const enviado = new Date('2026-10-27T20:00:00Z');

  it('cuenta las compras del mismo día (aunque la nota diga 00:00) hasta 7 días después', () => {
    expect(compraDelEnvio(new Date('2026-10-27T05:00:00Z'), enviado)).toBe(
      true,
    );
    expect(compraDelEnvio(new Date('2026-11-03T19:00:00Z'), enviado)).toBe(
      true,
    );
  });

  it('no cuenta lo del día anterior ni lo de después de la semana', () => {
    expect(compraDelEnvio(new Date('2026-10-27T04:59:00Z'), enviado)).toBe(
      false,
    );
    expect(compraDelEnvio(new Date('2026-11-03T21:00:00Z'), enviado)).toBe(
      false,
    );
  });

  it('inicioDelDiaLima es la medianoche de Lima', () => {
    expect(
      inicioDelDiaLima(new Date('2026-10-28T03:00:00Z')).toISOString(),
    ).toBe('2026-10-27T05:00:00.000Z');
  });
});
