import { coordenadasDeMaps, fechaDeVisita, textoComoLlegar, tiendaValida } from './visita-tienda';

// Domingo 25 de octubre de 2026, 7 p. m. de Lima (el chat de Percy).
const HOY = new Date('2026-10-26T00:00:00Z');

describe('el día de la visita', () => {
  it.each([
    ['Primero quiero visitarte la tienda, el día martes 27 octubre, 8am', '2026-10-27'],
    ['mañana a las 2 de la tarde', '2026-10-26'],
    ['mañana en la mañana', '2026-10-26'],
    ['pasado mañana', '2026-10-27'],
    ['hoy en la tarde paso', '2026-10-25'],
    ['el sábado en la mañana', '2026-10-31'],
  ])('"%s" → %s', (cuando, esperado) => {
    expect(fechaDeVisita(cuando, undefined, HOY)).toBe(esperado);
  });

  it('manda la fecha del modelo si es razonable', () => {
    expect(fechaDeVisita('el martes', '2026-10-27', HOY)).toBe('2026-10-27');
    expect(fechaDeVisita('cuando pueda', '2025-01-01', HOY)).toBeNull();
  });

  it('sin día queda como "dice que vendrá"', () => {
    expect(fechaDeVisita('un día de estos paso', undefined, HOY)).toBeNull();
  });
});

describe('la tienda y cómo llegar', () => {
  it('saca las coordenadas de un link de Google Maps', () => {
    expect(
      coordenadasDeMaps('https://www.google.com/maps/place/Mercado/@-12.0489,-77.0367,17z/data=!3d-12.04895!4d-77.03671'),
    ).toEqual({ lat: -12.04895, lng: -77.03671 });
    expect(coordenadasDeMaps('https://maps.google.com/?q=-12.05,-77.03')).toEqual({ lat: -12.05, lng: -77.03 });
    expect(coordenadasDeMaps('https://maps.app.goo.gl/abc123')).toBeNull();
  });

  it('con un link corto no hay mapa, pero el link va en el texto', () => {
    const t = tiendaValida({
      direccion: 'Av. Emancipación 687, Mercado La Merced, stand D-27',
      mapsUrl: 'https://maps.app.goo.gl/abc123',
      indicaciones: 'Entra por la puerta 3 y sigue al fondo a la derecha.',
    });
    expect(t.lat).toBeNull();
    expect(textoComoLlegar(t, 'Hierba Sana')).toContain('https://maps.app.goo.gl/abc123');
    expect(textoComoLlegar(t, 'Hierba Sana')).toContain('stand D-27');
  });

  it('con coordenadas el link no se repite en el texto: ya va el mapa', () => {
    const t = tiendaValida({ mapsUrl: 'https://maps.google.com/?q=-12.05,-77.03', direccion: 'X' });
    expect(t.lat).toBe(-12.05);
    expect(textoComoLlegar(t, 'N')).not.toContain('maps.google');
  });
});
