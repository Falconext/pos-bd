/**
 * F0 — las reglas del motor de disparadores.
 *
 * Esto no es una validación de formulario: cada regla de acá existe porque,
 * sin ella, el negocio pierde su número de WhatsApp o le escribe a un cliente
 * algo que no corresponde. Son las cuatro que importan: la ventana de 24 h de
 * Meta, el horario, la baja y el tope de marketing.
 */
import {
  CATALOGO_DISPAROS,
  CONFIG_DISPARADORES_DEFECTO,
  TipoDisparo,
  cuandoDisparar,
  decidirEnvio,
  demoraDe,
  enHorarioHabil,
  horaEnLima,
  pideBaja,
  proximoHorarioHabil,
  ventanaAbierta,
  type ConfigDisparadores,
} from './leads-disparadores';

const CONFIG: ConfigDisparadores = {
  ...CONFIG_DISPARADORES_DEFECTO,
  activos: Object.values(TipoDisparo),
};

/** Una hora de Lima como fecha UTC (Lima es UTC-5 todo el año). */
const lima = (dia: number, hora: number) =>
  new Date(Date.UTC(2026, 9, dia, hora + 5, 0, 0));

describe('los 7 disparadores del anexo', () => {
  it('están los 6 automáticos más la exclusión operativa, que es una regla', () => {
    // 33.7 no es un disparador: es la prohibición de disparar. Vive como
    // condición dentro de los que tocan productos.
    expect(Object.keys(CATALOGO_DISPAROS)).toHaveLength(6);
    expect(
      CATALOGO_DISPAROS[TipoDisparo.VUELTA_DISPONIBILIDAD].exigeProductoDisponible,
    ).toBe(true);
    expect(CATALOGO_DISPAROS[TipoDisparo.RECOMPRA].exigeProductoDisponible).toBe(
      true,
    );
  });

  it('con las demoras que pidió el cliente', () => {
    expect(demoraDe(TipoDisparo.RECUPERAR_COTIZACION, CONFIG)).toBe(3);
    expect(demoraDe(TipoDisparo.POST_ENTREGA, CONFIG)).toBe(24);
    expect(demoraDe(TipoDisparo.RECOMPRA, CONFIG)).toBe(25 * 24);
    expect(demoraDe(TipoDisparo.REACTIVACION, CONFIG)).toBe(45 * 24);
  });

  it('cada empresa puede cambiar la demora sin tocar código', () => {
    const otra: ConfigDisparadores = {
      ...CONFIG,
      demorasHoras: { [TipoDisparo.RECOMPRA]: 60 * 24 },
    };
    expect(demoraDe(TipoDisparo.RECOMPRA, otra)).toBe(60 * 24);
    // Lo que no se redefine sigue con el valor del catálogo.
    expect(demoraDe(TipoDisparo.POST_ENTREGA, otra)).toBe(24);
  });

  it('arranca con los dos que el cliente priorizó', () => {
    // "Recomendamos empezar por la recompra a 25 días y la recuperación de
    // cotización, por su retorno comercial."
    expect(CONFIG_DISPARADORES_DEFECTO.activos).toContain(TipoDisparo.RECOMPRA);
    expect(CONFIG_DISPARADORES_DEFECTO.activos).toContain(
      TipoDisparo.RECUPERAR_COTIZACION,
    );
    // Y los de más riesgo quedan apagados hasta que el negocio decida.
    expect(CONFIG_DISPARADORES_DEFECTO.activos).not.toContain(
      TipoDisparo.REACTIVACION,
    );
  });

  it('los de 25 y 45 días son MARKETING; el resto, transaccionales', () => {
    // No es un detalle: MARKETING se paga más, cuenta para el tope y exige
    // el pie de baja.
    expect(CATALOGO_DISPAROS[TipoDisparo.RECOMPRA].categoria).toBe('MARKETING');
    expect(CATALOGO_DISPAROS[TipoDisparo.REACTIVACION].categoria).toBe(
      'MARKETING',
    );
    expect(CATALOGO_DISPAROS[TipoDisparo.POST_ENTREGA].categoria).toBe('UTILITY');
  });
});

describe('el horario', () => {
  it('lee la hora de Lima, no la del servidor', () => {
    // Las 02:00 UTC son las 21:00 del día anterior en Lima.
    expect(horaEnLima(new Date('2026-10-10T02:00:00Z'))).toBe(21);
    expect(horaEnLima(new Date('2026-10-10T14:00:00Z'))).toBe(9);
  });

  it('las 9 de la mañana sí, las 9 de la noche no', () => {
    expect(enHorarioHabil(lima(10, 9), CONFIG)).toBe(true);
    expect(enHorarioHabil(lima(10, 20), CONFIG)).toBe(true);
    expect(enHorarioHabil(lima(10, 21), CONFIG)).toBe(false);
    expect(enHorarioHabil(lima(10, 3), CONFIG)).toBe(false);
  });

  it('un mensaje de madrugada se corre a las 9 del mismo día', () => {
    const corrido = proximoHorarioHabil(lima(10, 3), CONFIG);
    expect(horaEnLima(corrido)).toBe(9);
    expect(corrido.getUTCDate()).toBe(10);
  });

  it('uno de la noche se corre a las 9 del día siguiente', () => {
    const corrido = proximoHorarioHabil(lima(10, 23), CONFIG);
    expect(horaEnLima(corrido)).toBe(9);
    expect(corrido.getUTCDate()).toBe(11);
  });

  it('a una hora buena no lo mueve', () => {
    const ok = lima(10, 15);
    expect(proximoHorarioHabil(ok, CONFIG)).toBe(ok);
  });
});

describe('cuándo toca mandarlo', () => {
  it('la cotización, 3 horas después', () => {
    const cuando = cuandoDisparar(
      TipoDisparo.RECUPERAR_COTIZACION,
      lima(10, 11),
      CONFIG,
    );
    expect(horaEnLima(cuando)).toBe(14);
  });

  it('si esas 3 horas caen de noche, espera a la mañana', () => {
    // Cotizó a las 8 de la noche: el recordatorio no va a las 11.
    const cuando = cuandoDisparar(
      TipoDisparo.RECUPERAR_COTIZACION,
      lima(10, 20),
      CONFIG,
    );
    expect(horaEnLima(cuando)).toBe(9);
    expect(cuando.getUTCDate()).toBe(11);
  });

  it('el "te aviso luego" va a la mañana siguiente, no a las N horas', () => {
    // Sumar horas a un "te aviso luego" de las 3 de la tarde daría las 3 de
    // la madrugada. El anexo pide la mañana siguiente.
    const cuando = cuandoDisparar(
      TipoDisparo.CARRITO_EN_ESPERA,
      lima(10, 15),
      CONFIG,
    );
    expect(horaEnLima(cuando)).toBe(9);
    expect(cuando.getUTCDate()).toBe(11);
  });

  it('y uno de las 11 de la noche también, al día siguiente', () => {
    const cuando = cuandoDisparar(
      TipoDisparo.CARRITO_EN_ESPERA,
      lima(10, 23),
      CONFIG,
    );
    expect(horaEnLima(cuando)).toBe(9);
    expect(cuando.getUTCDate()).toBe(11);
  });

  it('la recompra, 25 días después', () => {
    const cuando = cuandoDisparar(TipoDisparo.RECOMPRA, lima(1, 10), CONFIG);
    expect(cuando.getUTCDate()).toBe(26);
  });
});

describe('la ventana de 24 horas de Meta', () => {
  const ahora = new Date('2026-10-10T15:00:00Z');

  it('está abierta si el cliente escribió hace menos de 24 h', () => {
    expect(ventanaAbierta(new Date('2026-10-10T10:00:00Z'), ahora)).toBe(true);
  });

  it('cerrada a las 24 h justas', () => {
    expect(ventanaAbierta(new Date('2026-10-09T15:00:00Z'), ahora)).toBe(false);
  });

  it('cerrada si nunca escribió', () => {
    expect(ventanaAbierta(null, ahora)).toBe(false);
  });
});

describe('la baja', () => {
  it('"BAJA" sola la pide, en cualquier capitalización', () => {
    expect(pideBaja('BAJA')).toBe(true);
    expect(pideBaja('baja')).toBe(true);
    expect(pideBaja(' Baja ')).toBe(true);
    expect(pideBaja('STOP')).toBe(true);
  });

  it('y las frases claras también', () => {
    expect(pideBaja('ya no me escriban por favor')).toBe(true);
    expect(pideBaja('Por favor dejen de escribir')).toBe(true);
    expect(pideBaja('quiero que borren mi número')).toBe(true);
  });

  it('pero "baja" dentro de una frase NO es una baja', () => {
    // Darla por error deja al negocio sin poder avisarle nunca más.
    expect(pideBaja('me das de baja el precio?')).toBe(false);
    expect(pideBaja('tienes algo para la baja presión')).toBe(false);
    expect(pideBaja('la caja llegó abierta')).toBe(false);
  });

  it('un mensaje vacío no es una baja', () => {
    expect(pideBaja('')).toBe(false);
    expect(pideBaja('   ')).toBe(false);
  });
});

describe('la decisión final, justo antes de mandar', () => {
  const base = {
    tipo: TipoDisparo.RECOMPRA,
    config: CONFIG,
    ahora: lima(10, 11),
    dioDeBaja: false,
    plantillaAprobada: true,
    productoDisponible: true,
  };

  it('con la ventana abierta manda texto: es gratis y más natural', () => {
    const v = decidirEnvio({
      ...base,
      ultimoMensajeDelCliente: lima(10, 9),
    });
    expect(v).toEqual({ enviar: true, via: 'texto' });
  });

  it('con la ventana cerrada manda plantilla', () => {
    const v = decidirEnvio({
      ...base,
      ultimoMensajeDelCliente: lima(1, 9),
    });
    expect(v).toEqual({ enviar: true, via: 'plantilla' });
  });

  it('sin plantilla aprobada NO manda nada: el texto no llegaría', () => {
    // Meta no devuelve error visible: simplemente no entrega, y el negocio
    // cree que avisó.
    const v = decidirEnvio({
      ...base,
      ultimoMensajeDelCliente: lima(1, 9),
      plantillaAprobada: false,
    });
    expect(v.enviar).toBe(false);
    expect(v.reprogramar).toBe(true);
    expect(v.motivo).toMatch(/recompra_25.*no está aprobada/i);
  });

  it('la baja manda sobre todo lo demás', () => {
    const v = decidirEnvio({ ...base, dioDeBaja: true });
    expect(v.enviar).toBe(false);
    expect(v.reprogramar).toBeUndefined();
    expect(v.motivo).toMatch(/no recibir más avisos/i);
  });

  it('33.7: nunca sobre un producto que ya no hay', () => {
    const v = decidirEnvio({ ...base, productoDisponible: false });
    expect(v.enviar).toBe(false);
    expect(v.motivo).toMatch(/ya no está disponible/i);
  });

  it('si hay una persona atendiendo, espera', () => {
    const v = decidirEnvio({ ...base, botPausado: true });
    expect(v.enviar).toBe(false);
    // No se descarta: se reintenta cuando el asesor termine.
    expect(v.reprogramar).toBe(true);
  });

  it('fuera de horario espera, no se pierde', () => {
    const v = decidirEnvio({ ...base, ahora: lima(10, 2) });
    expect(v.enviar).toBe(false);
    expect(v.reprogramar).toBe(true);
    expect(v.motivo).toMatch(/horario/i);
  });

  it('el tope de marketing corta el tercer aviso del mes', () => {
    const v = decidirEnvio({ ...base, marketingRecientes: 2 });
    expect(v.enviar).toBe(false);
    expect(v.motivo).toMatch(/2 avisos comerciales en los últimos 30 días/i);
  });

  it('pero el tope NO aplica a los transaccionales', () => {
    // Avisarle que su pedido llegó no es publicidad.
    const v = decidirEnvio({
      ...base,
      tipo: TipoDisparo.POST_ENTREGA,
      marketingRecientes: 9,
      ultimoMensajeDelCliente: lima(1, 9),
    });
    expect(v.enviar).toBe(true);
  });

  it('un disparador apagado por el negocio no se manda', () => {
    const v = decidirEnvio({
      ...base,
      config: { ...CONFIG, activos: [TipoDisparo.POST_ENTREGA] },
    });
    expect(v.enviar).toBe(false);
    expect(v.motivo).toMatch(/apagado/i);
  });
});
