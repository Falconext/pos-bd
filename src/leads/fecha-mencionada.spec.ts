import { fechaMencionada } from './fecha-mencionada';

// Lunes 19 de octubre de 2026, 6 p. m. de Lima.
const HOY = new Date('2026-10-19T23:00:00Z');

describe('la fecha que dijo el cliente', () => {
  it.each([
    ['cobro a fin de mes y ahí te escribo', '2026-10-31'],
    ['en una semana te aviso', '2026-10-26'],
    ['dentro de 3 días lo compro', '2026-10-22'],
    ['en dos semanas regreso de viaje', '2026-11-02'],
    ['la próxima semana te escribo', '2026-10-26'],
    ['el viernes te confirmo', '2026-10-23'],
    ['cuando cobre el 30', '2026-10-30'],
    ['el 15 de noviembre lo pido', '2026-11-15'],
    ['me pagan la quincena', '2026-11-15'],
    ['pasado mañana te escribo', '2026-10-21'],
    ['mañana te aviso', '2026-10-20'],
  ])('"%s" → %s', (texto, esperado) => {
    expect(fechaMencionada(texto, HOY)).toBe(esperado);
  });

  it.each([
    'lo voy a pensar',
    'mañana de 3 a 5 está bien',
    'quiero 2 frascos',
    'el 30% de descuento?',
  ])('sin fecha clara: "%s"', (texto) => {
    expect(fechaMencionada(texto, HOY)).toBeNull();
  });
});
