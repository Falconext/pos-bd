import { enFormatoWhatsapp } from './formato-whatsapp';

describe('enFormatoWhatsapp', () => {
  it('la dirección de Hierba Sana (23-10) sale con un solo asterisco', () => {
    expect(
      enFormatoWhatsapp('Nuestra tienda física está en la **Av. Emancipación 687, interior del Mercado La Merced, stand D-27, Lima Cercado**.'),
    ).toBe('Nuestra tienda física está en la *Av. Emancipación 687, interior del Mercado La Merced, stand D-27, Lima Cercado*.');
  });

  it('respeta lo que ya está en formato WhatsApp', () => {
    const ok = 'Hola, soy Claudio de *Hierba Sana* 🌿\n_Total:_ S/ 59.90\n- Glucora x 1';
    expect(enFormatoWhatsapp(ok)).toBe(ok);
  });

  it('títulos, tachado, subrayado doble y enlaces', () => {
    expect(enFormatoWhatsapp('### Tu pedido\n~~S/ 70~~ S/ 59\n__Importante__')).toBe('*Tu pedido*\n~S/ 70~ S/ 59\n*Importante*');
    expect(enFormatoWhatsapp('Paga aquí: [link de pago](https://mpago.la/abc)')).toBe('Paga aquí: link de pago: https://mpago.la/abc');
    expect(enFormatoWhatsapp('Mapa: [https://g.co/kgs/AYvFGb](https://g.co/kgs/AYvFGb)')).toBe('Mapa: https://g.co/kgs/AYvFGb');
  });

  it('asteriscos dobles sin pareja no quedan a la vista', () => {
    expect(enFormatoWhatsapp('Total: **S/ 59.90')).toBe('Total: *S/ 59.90');
  });

  it('no toca multiplicaciones ni viñetas', () => {
    expect(enFormatoWhatsapp('2 * 3 = 6\n* Glucora\n* Té verde')).toBe('2 * 3 = 6\n* Glucora\n* Té verde');
  });
});
