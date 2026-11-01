import { origenTiktok } from './anuncio-origen';

describe('origenTiktok', () => {
  it.each([
    'Hola, vengo de TikTok',
    'hola vengo de tiktok quiero info',
    'Te vi en Tik Tok, cuánto cuesta?',
    'vi su video en TIKTOK',
    'Hola! Desde TikTok 😊',
    'me enteré de ustedes por tiktok',
    'vi el anuncio de tiktok',
  ])('reconoce la llegada: %s', (t) => {
    expect(origenTiktok(t)).toMatchObject({ anuncioId: 'tiktok', tipo: 'tiktok', titulo: 'TikTok', ctwaClid: null });
  });

  it.each(['¿Tienen TikTok?', '¿están en tiktok?', '¿venden por tiktok?', 'hola, precio?', '', undefined])(
    'no inventa la llegada: %s',
    (t) => {
      expect(origenTiktok(t as any)).toBeNull();
    },
  );

  it('guarda el mensaje como texto, recortado', () => {
    expect(origenTiktok('  Hola, vengo de TikTok  ')?.texto).toBe('Hola, vengo de TikTok');
  });
});
