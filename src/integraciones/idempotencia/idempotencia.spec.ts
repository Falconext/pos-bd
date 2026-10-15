/**
 * Idempotencia: que un reintento no emita dos facturas.
 *
 * Es el riesgo número uno de abrir la facturación por API. Si el integrador
 * pierde la respuesta —timeout, 502 de un proxy, su proceso que muere— va a
 * reintentar, y sin esto el reintento emite una SEGUNDA factura: las dos
 * válidas ante SUNAT, las dos con correlativo, y deshacer una exige una
 * comunicación de baja.
 *
 * Lo que se defiende acá no es el camino feliz, que es obvio, sino los tres
 * casos que lo vuelven inútil si se hacen mal: una huella que cambia con el
 * orden de las claves, un 5xx que se queda pegado, y una clave en curso que
 * se confunde con una terminada.
 */
import {
  claveValida,
  debeGuardarse,
  decidir,
  huellaDelCuerpo,
  venceEn,
  VIGENCIA_IDEMPOTENCIA_MS,
  type RegistroIdempotente,
} from './idempotencia';

const FACTURA = {
  issuer_id: 'iss_8Kp2Qm3x',
  document_type: 'invoice',
  customer: { document_type: 'ruc', document_number: '20601234567', name: 'ANDINA S.A.C.' },
  items: [{ description: 'Consultoría', quantity: 1, unit_value: 1000 }],
};

const AHORA = new Date('2026-11-02T15:00:00Z');
const registro = (over: Partial<RegistroIdempotente> = {}): RegistroIdempotente => ({
  huella: huellaDelCuerpo(FACTURA),
  estadoHttp: 202,
  respuesta: { id: 'inv_3xK8p2Qm', full_number: 'F001-00001234' },
  expiraEn: new Date(AHORA.getTime() + 1000),
  ...over,
});

describe('la huella del cuerpo', () => {
  it('no cambia si el cliente serializa las claves en otro orden', () => {
    // Sin esto, un integrador cuyo serializador no garantiza orden vería su
    // reintento legítimo rechazado como conflicto.
    const a = { issuer_id: 'iss_1', document_type: 'invoice' };
    const b = { document_type: 'invoice', issuer_id: 'iss_1' };
    expect(huellaDelCuerpo(a)).toBe(huellaDelCuerpo(b));
  });

  it('tampoco cambia con claves anidadas en otro orden', () => {
    const a = { customer: { name: 'X', document_number: '2060' }, items: [] };
    const b = { items: [], customer: { document_number: '2060', name: 'X' } };
    expect(huellaDelCuerpo(a)).toBe(huellaDelCuerpo(b));
  });

  it('el orden de un arreglo SÍ cuenta: dos líneas invertidas son otro comprobante', () => {
    const a = { items: [{ d: 'A' }, { d: 'B' }] };
    const b = { items: [{ d: 'B' }, { d: 'A' }] };
    expect(huellaDelCuerpo(a)).not.toBe(huellaDelCuerpo(b));
  });

  it('cambia si cambia un monto, que es lo que importa', () => {
    const otro = { ...FACTURA, items: [{ description: 'Consultoría', quantity: 1, unit_value: 1200 }] };
    expect(huellaDelCuerpo(otro)).not.toBe(huellaDelCuerpo(FACTURA));
  });

  it('un campo ausente y uno en undefined son lo mismo', () => {
    // Es lo que el servidor ve en ambos casos después de parsear el JSON.
    expect(huellaDelCuerpo({ a: 1, b: undefined })).toBe(huellaDelCuerpo({ a: 1 }));
  });

  it('distingue tipos que se ven parecidos', () => {
    expect(huellaDelCuerpo({ n: 1 })).not.toBe(huellaDelCuerpo({ n: '1' }));
    expect(huellaDelCuerpo({ n: null })).not.toBe(huellaDelCuerpo({ n: 0 }));
  });
});

describe('qué se decide con una clave', () => {
  const huella = huellaDelCuerpo(FACTURA);

  it('sin registro previo, se ejecuta', () => {
    expect(decidir(null, huella, AHORA)).toEqual({ tipo: 'nueva' });
  });

  it('misma clave y mismo cuerpo: devuelve lo guardado SIN volver a emitir', () => {
    expect(decidir(registro(), huella, AHORA)).toEqual({
      tipo: 'repetida',
      estadoHttp: 202,
      respuesta: { id: 'inv_3xK8p2Qm', full_number: 'F001-00001234' },
    });
  });

  it('misma clave con otro cuerpo: es un error del integrador, no un reintento', () => {
    const otraHuella = huellaDelCuerpo({ ...FACTURA, document_type: 'receipt' });
    expect(decidir(registro(), otraHuella, AHORA)).toEqual({ tipo: 'conflicto' });
  });

  it('la primera llamada sigue en curso: no se ejecuta en paralelo', () => {
    // Dos reintentos simultáneos emitirían dos facturas si este caso se
    // tratara como "nueva".
    const enCurso = registro({ respuesta: null, estadoHttp: null });
    expect(decidir(enCurso, huella, AHORA)).toEqual({ tipo: 'en_curso' });
  });

  it('una clave vencida se trata como nueva', () => {
    const vieja = registro({ expiraEn: new Date(AHORA.getTime() - 1) });
    expect(decidir(vieja, huella, AHORA)).toEqual({ tipo: 'nueva' });
  });

  it('justo en el instante del vencimiento ya está vencida', () => {
    const justa = registro({ expiraEn: new Date(AHORA.getTime()) });
    expect(decidir(justa, huella, AHORA)).toEqual({ tipo: 'nueva' });
  });

  it('una clave vencida con OTRO cuerpo tampoco es conflicto', () => {
    // Pasadas 24 h, reusar la clave para otra cosa es legítimo.
    const vieja = registro({ expiraEn: new Date(AHORA.getTime() - 1) });
    expect(decidir(vieja, 'otra-huella', AHORA)).toEqual({ tipo: 'nueva' });
  });
});

describe('qué respuestas se guardan', () => {
  it('se guarda lo que el servidor decidió: 2xx y 4xx', () => {
    // Un 422 por un RUC inválido va a repetirse igual; devolverlo de memoria
    // es correcto y le ahorra al integrador una llamada a SUNAT.
    for (const codigo of [200, 201, 202, 400, 409, 422]) {
      expect(debeGuardarse(codigo)).toBe(true);
    }
  });

  it('un 5xx NO se guarda: el reintento tiene que volver a intentarlo', () => {
    // Guardarlo dejaría al integrador clavado en un error que ya pasó, sin
    // más salida que cambiar la clave — justo lo contrario de lo que la
    // idempotencia promete.
    for (const codigo of [500, 502, 503, 504]) {
      expect(debeGuardarse(codigo)).toBe(false);
    }
  });
});

describe('la clave que manda el integrador', () => {
  it('acepta un UUID y también el id del pedido en su sistema', () => {
    expect(claveValida('5f7c1e2a-9b3d-4a6e-8c1f-2d4b6e8a0c12')).toBe(true);
    // Rechazar esto rompería el mejor uso posible: su propio identificador.
    expect(claveValida('ORD-10482')).toBe(true);
  });

  it('rechaza vacío, espacios y lo que no es texto', () => {
    for (const mala of ['', '   ', null, undefined, 42, {}, []]) {
      expect(claveValida(mala)).toBe(false);
    }
  });

  it('rechaza una clave desmedida', () => {
    expect(claveValida('x'.repeat(128))).toBe(true);
    expect(claveValida('x'.repeat(129))).toBe(false);
  });
});

describe('la vigencia', () => {
  it('vence a las 24 horas, que es lo que publica el contrato', () => {
    expect(venceEn(AHORA).getTime() - AHORA.getTime()).toBe(VIGENCIA_IDEMPOTENCIA_MS);
    expect(VIGENCIA_IDEMPOTENCIA_MS).toBe(86_400_000);
  });
});
