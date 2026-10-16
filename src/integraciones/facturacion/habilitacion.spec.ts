/**
 * La puerta que evita quemar correlativos.
 *
 * El número de serie se asigna al CREAR el comprobante, antes de que SUNAT
 * opine. Así que cada intento contra un RUC no habilitado gasta un
 * correlativo que no vuelve. En producción, cuatro RUCs quemaron 15 entre
 * todos; uno insistió siete veces en nueve días porque nada le dijo que el
 * problema no se resolvía reintentando.
 *
 * Lo que se prueba acá es que eso cueste uno y no siete.
 */
import {
  CODIGOS_SIN_HABILITACION,
  ESPERA_ALTA_MS,
  esFaltaDeHabilitacion,
  estadoSegunRespuesta,
  puedeEmitir,
} from './habilitacion';

const AHORA = new Date('2026-10-16T12:00:00Z');
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3600_000);
const emisor = (x: Partial<Parameters<typeof puedeEmitir>[0]> = {}) => ({
  usuarioPse: 'KREZKA01',
  ...x,
});

describe('durante el alta no se deja emitir', () => {
  it('recién vinculado se rechaza, diciendo cuándo estará listo', () => {
    const v = puedeEmitir(emisor({ apiEmisorEstado: 'pendiente', apiEmisorDesde: haceHoras(2) }), AHORA);
    expect(v.puede).toBe(false);
    if (v.puede) return;
    expect(v.codigo).toBe('issuer_not_ready');
    expect(v.disponibleEn).toEqual(new Date(haceHoras(2).getTime() + ESPERA_ALTA_MS));
  });

  it('el mensaje explica el costo, no solo que no se puede', () => {
    const v = puedeEmitir(emisor({ apiEmisorEstado: 'pendiente', apiEmisorDesde: haceHoras(1) }), AHORA);
    if (v.puede) throw new Error('debía rechazar');
    expect(v.mensaje).toContain('día siguiente');
    expect(v.mensaje).toContain('correlativo');
  });

  it('pasadas las 24 h se deja intentar', () => {
    // QPSE dice ~24 h. Más allá de eso no podemos saber si está listo; el
    // único que puede decirlo es SUNAT, y para eso hay que intentar.
    expect(puedeEmitir(emisor({ apiEmisorEstado: 'pendiente', apiEmisorDesde: haceHoras(25) }), AHORA).puede).toBe(true);
    expect(puedeEmitir(emisor({ apiEmisorEstado: 'pendiente', apiEmisorDesde: haceHoras(23) }), AHORA).puede).toBe(false);
  });

  it('sin fecha de vinculación se deja pasar', () => {
    // Una puerta que bloquea sin poder justificarlo es peor que una abierta.
    expect(puedeEmitir(emisor({ apiEmisorEstado: 'pendiente' }), AHORA).puede).toBe(true);
  });
});

describe('un RUC rechazado por habilitación se corta', () => {
  it('no deja emitir y dice qué hay que arreglar', () => {
    const v = puedeEmitir(emisor({
      apiEmisorEstado: 'bloqueado',
      apiEmisorMotivo: 'SUNAT responde 0111: el RUC no tiene el perfil para enviar comprobantes electrónicos.',
    }), AHORA);
    expect(v.puede).toBe(false);
    if (v.puede) return;
    expect(v.codigo).toBe('issuer_not_authorized');
    expect(v.mensaje).toContain('0111');
  });

  it('sin motivo guardado igual explica el problema', () => {
    const v = puedeEmitir(emisor({ apiEmisorEstado: 'bloqueado' }), AHORA);
    if (v.puede) throw new Error('debía rechazar');
    expect(v.mensaje).toContain('No se resuelve reintentando');
  });
});

describe('lo que sí puede emitir', () => {
  it('un emisor activo', () => {
    expect(puedeEmitir(emisor({ apiEmisorEstado: 'activo' }), AHORA).puede).toBe(true);
  });

  it('uno sin estado: los que existían antes del ciclo de vida', () => {
    // Bloquearlos retroactivamente rompería lo que hoy funciona.
    expect(puedeEmitir(emisor(), AHORA).puede).toBe(true);
    expect(puedeEmitir(emisor({ apiEmisorEstado: null }), AHORA).puede).toBe(true);
  });

  it('pero nunca uno sin credenciales de firma', () => {
    const v = puedeEmitir({ usuarioPse: '  ', apiEmisorEstado: 'activo' }, AHORA);
    expect(v.puede).toBe(false);
    if (!v.puede) expect(v.codigo).toBe('issuer_not_configured');
  });
});

describe('qué códigos significan falta de habilitación', () => {
  it('0111 y 0154, los dos que aparecen en producción', () => {
    expect(esFaltaDeHabilitacion('0111')).toBe(true);
    expect(esFaltaDeHabilitacion('0154')).toBe(true);
    expect([...CODIGOS_SIN_HABILITACION].sort()).toEqual(['0111', '0154']);
  });

  it('un rechazo normal de datos NO bloquea al emisor', () => {
    // 2xxx/3xxx son errores del comprobante: se corrige y se reemite. Si
    // bloquearan el RUC, un error de tipeo dejaría al emisor sin operar.
    for (const c of ['2116', '3105', '0', null, '4000']) {
      expect(esFaltaDeHabilitacion(c)).toBe(false);
    }
  });
});

describe('qué aprende el sistema de cada respuesta de SUNAT', () => {
  it('una aceptación es la única prueba de que el alta funcionó', () => {
    expect(estadoSegunRespuesta('accepted', '0')).toEqual({ estado: 'activo' });
    expect(estadoSegunRespuesta('observed', '4000')).toEqual({ estado: 'activo' });
  });

  it('un rechazo por habilitación bloquea a un emisor que nunca emitió', () => {
    const r = estadoSegunRespuesta('rejected', '0111', 'pendiente');
    expect(r!.estado).toBe('bloqueado');
    expect(r!.motivo).toContain('emisor electrónico');
    expect(estadoSegunRespuesta('rejected', '0154', 'pendiente')!.motivo).toContain('clave SOL');
  });

  it('un rechazo por datos no toca al emisor', () => {
    expect(estadoSegunRespuesta('rejected', '2116', 'pendiente')).toBeNull();
    expect(estadoSegunRespuesta('rejected', '3105', 'pendiente')).toBeNull();
  });

  it('a un emisor que YA emitió bien, un 0111 NO le corta la facturación', () => {
    // El proveedor de firma avisó que esos códigos tambien saltan cuando los
    // servidores de SUNAT estan caídos, y los datos lo confirman: MATERIALES
    // ORTEGA recibió un 0154 después de 1,165 comprobantes aceptados y
    // M3-RAKI un 0111 tras 201. Bloquearlos habría dejado sin facturar a dos
    // clientes sanos por una intermitencia.
    expect(estadoSegunRespuesta('rejected', '0111', 'activo')).toBeNull();
    expect(estadoSegunRespuesta('rejected', '0154', 'activo')).toBeNull();
  });

  it('pero al que nunca emitió, sí', () => {
    // LA DESPENSA HM y DEMISKIN BEAUTY: cero comprobantes aceptados. Para
    // ellos el código significa exactamente lo que dice.
    expect(estadoSegunRespuesta('rejected', '0111', 'pendiente')!.estado).toBe('bloqueado');
    expect(estadoSegunRespuesta('rejected', '0154', null)!.estado).toBe('bloqueado');
    expect(estadoSegunRespuesta('rejected', '0111', undefined)!.estado).toBe('bloqueado');
  });

  it('una aceptación reactiva aunque estuviera bloqueado', () => {
    // El contribuyente arregló su habilitación: la prueba es que SUNAT
    // aceptó, y el emisor vuelve solo.
    expect(estadoSegunRespuesta('accepted', '0', 'bloqueado')).toEqual({ estado: 'activo' });
  });

  it('lo que todavía no resolvió tampoco', () => {
    for (const e of ['pending', 'sent', 'reconciling', 'voided', null]) {
      expect(estadoSegunRespuesta(e, '0')).toBeNull();
    }
  });
});
