/**
 * C1 y C16 — validar antes de agendar.
 *
 * Un celular mal escrito es un pedido que no se puede entregar, y se descubre
 * cuando el repartidor ya salió. Las reglas vienen de la base de conocimiento
 * del cliente.
 */
import {
  HORARIO_HIERBA_SANA,
  normalizarCelular,
  validarCelular,
  validarDni,
  validarFranja,
} from './validaciones-pedido';

const hhmm = (h: number, m = 0) => h * 60 + m;
/** Un lunes a las 10:00. */
const LUNES_10AM = new Date(2026, 9, 12, 10, 0, 0);

describe('validarDni', () => {
  it('acepta 8 dígitos', () => {
    expect(validarDni('45678912')).toBeNull();
    expect(validarDni('45.678.912')).toBeNull();
  });

  it.each([
    ['4567891', 7],
    ['456789123', 9],
  ])('rechaza %s y dice cuántos dígitos tiene', (valor, cuantos) => {
    expect(validarDni(valor)?.detalle).toContain(`tiene ${cuantos}`);
  });

  it('avisa si no vino', () => {
    expect(validarDni('')?.detalle).toBe('Falta el DNI.');
  });
});

describe('validarCelular', () => {
  it('acepta 9 dígitos que empiezan en 9', () => {
    expect(validarCelular('987654321')).toBeNull();
    expect(validarCelular('987 654 321')).toBeNull();
  });

  it('tolera el prefijo del país, que la gente sí escribe', () => {
    expect(validarCelular('+51 987654321')).toBeNull();
    expect(normalizarCelular('+51 987654321')).toBe('987654321');
  });

  it('rechaza un fijo: no empieza en 9', () => {
    expect(validarCelular('014567891')?.detalle).toContain('empieza en 9');
  });

  it('rechaza el que tiene dígitos de menos', () => {
    expect(validarCelular('98765432')?.detalle).toContain('tiene 8');
  });
});

describe('validarFranja', () => {
  const franja = (h: number, hFin: number, dia = 12) => ({
    fecha: new Date(2026, 9, dia),
    inicioMin: hhmm(h),
    finMin: hhmm(hFin),
  });

  it('acepta una franja normal con suficiente anticipación', () => {
    // Lunes 10:00, entrega de 15:00 a 16:00.
    expect(validarFranja(franja(15, 16), LUNES_10AM)).toBeNull();
  });

  it('rechaza antes de abrir y después de cerrar', () => {
    expect(validarFranja(franja(7, 8), LUNES_10AM)?.detalle).toContain(
      'Se entrega de',
    );
    expect(validarFranja(franja(19, 20), LUNES_10AM)?.detalle).toContain(
      'Se entrega de',
    );
  });

  it('los domingos cierra más temprano', () => {
    // 18 de octubre de 2026 es domingo.
    const domingo = {
      fecha: new Date(2026, 9, 18),
      inicioMin: hhmm(15),
      finMin: hhmm(16),
    };
    expect(validarFranja(domingo, LUNES_10AM)?.detalle).toContain('domingos');
  });

  it('exige franja de al menos una hora', () => {
    const corta = {
      fecha: new Date(2026, 9, 12),
      inicioMin: hhmm(15),
      finMin: hhmm(15, 30),
    };
    expect(validarFranja(corta, LUNES_10AM)?.detalle).toContain('al menos 60');
  });

  it('exige 3 horas de anticipación', () => {
    // Pide para las 11:00 cuando son las 10:00.
    expect(validarFranja(franja(11, 12), LUNES_10AM)?.detalle).toContain(
      '3 horas',
    );
  });

  it('después de las 5 p. m. ya no agenda para hoy', () => {
    const lunes6pm = new Date(2026, 9, 12, 18, 0, 0);
    const hoy = franja(18, 19);
    // Falla por el límite del mismo día, no por el rango.
    expect(validarFranja(hoy, lunes6pm)?.detalle).toContain('mismo día');
  });

  it('pero sí agenda para mañana a esa misma hora', () => {
    const lunes6pm = new Date(2026, 9, 12, 18, 0, 0);
    expect(validarFranja(franja(10, 11, 13), lunes6pm)).toBeNull();
  });
});

describe('el horario es configuración, no código', () => {
  it('otra empresa define sus propias franjas', () => {
    const otra = {
      ...HORARIO_HIERBA_SANA,
      desdeMin: hhmm(8),
      hastaMin: hhmm(22),
      anticipacionMinimaMin: 60,
    };
    const tarde = {
      fecha: new Date(2026, 9, 12),
      inicioMin: hhmm(20),
      finMin: hhmm(21),
    };
    // Para Hierba Sana las 20:00 están fuera; para esta empresa, no.
    expect(validarFranja(tarde, LUNES_10AM)).not.toBeNull();
    expect(validarFranja(tarde, LUNES_10AM, otra)).toBeNull();
  });
});
