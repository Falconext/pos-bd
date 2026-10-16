/**
 * La traducción del estado interno al que ve el integrador.
 *
 * Lo que se defiende acá no es un mapa de strings: es qué hace el integrador
 * cuando lee la respuesta. Un estado mal traducido no rompe nada visible —
 * hace que alguien emita dos veces el mismo comprobante, o que dé por perdido
 * uno que SUNAT ya aceptó.
 *
 * Los casos salen de la base de producción, no de la imaginación: los códigos
 * y combinaciones de acá son los que existen de verdad.
 */
import {
  codigoDelCdr,
  cdrDisponible,
  esFinal,
  esObservacion,
  estadoPublico,
} from './estado-publico';

const cdr = (code: string | null, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ code, state_label: 'x', ...extra });

describe('un comprobante aceptado por SUNAT', () => {
  it('con CDR 0 es accepted', () => {
    expect(
      estadoPublico({ estadoEnvioSunat: 'EMITIDO', sunatCdrResponse: cdr('0') }),
    ).toBe('accepted');
  });

  it('sin CDR guardado sigue siendo accepted', () => {
    // 331 comprobantes EMITIDO en producción no tienen code en el CDR. El
    // estado interno ya es definitivo: la ausencia del código no lo degrada.
    expect(estadoPublico({ estadoEnvioSunat: 'EMITIDO' })).toBe('accepted');
    expect(
      estadoPublico({ estadoEnvioSunat: 'EMITIDO', sunatCdrResponse: null }),
    ).toBe('accepted');
  });
});

describe('una observación NO es un rechazo', () => {
  // Un 4xxx significa que el comprobante quedó ACEPTADO y es válido; SUNAT
  // solo le anotó algo. Si se expusiera como rejected, el integrador lo
  // corregiría y lo reemitiría: dos comprobantes por una sola venta.
  it('el CDR 4000 es observed, no rejected', () => {
    const e = estadoPublico({
      estadoEnvioSunat: 'EMITIDO',
      sunatCdrResponse: cdr('4000'),
    });
    expect(e).toBe('observed');
    expect(e).not.toBe('rejected');
  });

  it('todo el rango 4xxx cuenta como observación', () => {
    for (const c of ['4000', '4321', '4999']) expect(esObservacion(c)).toBe(true);
  });

  it('los vecinos del rango no se contagian', () => {
    // 3999 es rechazo y 40000 no es un código del Anexo VIII.
    for (const c of ['3999', '40000', '400', '0', null]) {
      expect(esObservacion(c)).toBe(false);
    }
  });
});

describe('el comprobante que SUNAT da por registrado pero sin CDR', () => {
  // 118 en producción, todos con código 1033. Es el caso que no cabía en el
  // contrato original y el que más caro sale traducir mal.
  const registrado = {
    estadoEnvioSunat: 'PENDIENTE_CONCILIACION',
    sunatCdrResponse: cdr('1033', { state_label: 'indeterminado' }),
  };

  it('es reconciling', () => {
    expect(estadoPublico(registrado)).toBe('reconciling');
  });

  it('NO se reporta como rejected: reemitirlo duplicaría el comprobante', () => {
    expect(estadoPublico(registrado)).not.toBe('rejected');
  });

  it('NO se reporta como accepted: no hay CDR que descargar', () => {
    expect(estadoPublico(registrado)).not.toBe('accepted');
    expect(cdrDisponible('reconciling', true)).toBe(false);
  });

  it('no es un estado final: todavía se está resolviendo', () => {
    expect(esFinal('reconciling')).toBe(false);
  });
});

describe('un envío que no llegó a SUNAT', () => {
  it('FALLIDO_ENVIO se ve como pending, porque el sistema lo reintenta solo', () => {
    // Para el integrador no hay nada que hacer: no es un error suyo ni algo
    // que deba reintentar él.
    expect(estadoPublico({ estadoEnvioSunat: 'FALLIDO_ENVIO' })).toBe('pending');
  });

  it('pending no es final', () => {
    expect(esFinal('pending')).toBe(false);
    expect(esFinal('sent')).toBe(false);
  });
});

describe('los documentos que no van a SUNAT no se publican', () => {
  it('NO_APLICA no tiene estado público', () => {
    // Son notas de venta: 12,793 filas, el estado más común de la base.
    // Devolverlas como comprobantes confundiría sobre qué tiene valor
    // tributario.
    expect(estadoPublico({ estadoEnvioSunat: 'NO_APLICA' })).toBeNull();
  });

  it('un estado desconocido tampoco se inventa', () => {
    expect(estadoPublico({ estadoEnvioSunat: 'ALGO_NUEVO' })).toBeNull();
    expect(estadoPublico({ estadoEnvioSunat: null })).toBeNull();
    expect(estadoPublico({ estadoEnvioSunat: undefined })).toBeNull();
  });
});

describe('anulación', () => {
  it('ANULADO es voided', () => {
    expect(estadoPublico({ estadoEnvioSunat: 'ANULADO' })).toBe('voided');
  });

  it('voided es final y su CDR sí se puede descargar', () => {
    expect(esFinal('voided')).toBe(true);
    expect(cdrDisponible('voided', true)).toBe(true);
  });
});

describe('leer el código del CDR sin reventar', () => {
  // Lo guardado es texto libre: a veces JSON del proveedor, a veces el mensaje
  // de un envío que ni llegó a armar respuesta. Un parse que falle acá tumba
  // la consulta de un comprobante que por lo demás está bien.
  it('saca el código del JSON', () => {
    expect(codigoDelCdr(cdr('2116'))).toBe('2116');
  });

  it('aguanta texto que no es JSON', () => {
    expect(codigoDelCdr('Error de conexión con el proveedor')).toBeNull();
    expect(codigoDelCdr('{roto')).toBeNull();
    expect(codigoDelCdr('')).toBeNull();
  });

  it('aguanta null, undefined y formas raras', () => {
    expect(codigoDelCdr(null)).toBeNull();
    expect(codigoDelCdr(undefined)).toBeNull();
    expect(codigoDelCdr(123)).toBeNull();
    expect(codigoDelCdr({ code: null })).toBeNull();
    expect(codigoDelCdr({ code: 'null' })).toBeNull();
  });

  it('acepta el objeto ya parseado y el código numérico', () => {
    expect(codigoDelCdr({ code: 0 })).toBe('0');
    expect(codigoDelCdr({ codigo: '4000' })).toBe('4000');
  });
});

describe('cuándo se promete la descarga del CDR', () => {
  it('solo si SUNAT lo devolvió de verdad', () => {
    expect(cdrDisponible('accepted', true)).toBe(true);
    expect(cdrDisponible('observed', true)).toBe(true);
  });

  it('nunca si no hay nada guardado, por más aceptado que esté', () => {
    // Prometer una descarga que va a dar 404 es peor que decir que no está.
    expect(cdrDisponible('accepted', false)).toBe(false);
  });

  it('nunca en los estados donde no existe', () => {
    for (const e of ['pending', 'sent', 'rejected', 'reconciling'] as const) {
      expect(cdrDisponible(e, true)).toBe(false);
    }
  });
});
