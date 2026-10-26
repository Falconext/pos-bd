import { avisoOtroNumero, esOtroNumero, lineaCelular } from './celular-de-otro';

describe('el celular de la entrega no es el del chat', () => {
  it('el mismo número, escrito como sea, no es otro', () => {
    expect(esOtroNumero('987 654 321', '51987654321')).toBe(false);
    expect(esOtroNumero('+51 987654321', '51987654321')).toBe(false);
  });

  it('el de un familiar sí, y se le avisa al cliente con qué número se coordina', () => {
    expect(esOtroNumero('912345678', '51987654321')).toBe(true);
    const aviso = avisoOtroNumero('912345678', '51987654321');
    expect(aviso).toContain('coordinaremos la entrega y el seguimiento del envío con el 912345678');
    expect(aviso).toContain('recibeNombre');
  });

  it('un chat sin número (@nick o Instagram): el celular dado es el único contacto', () => {
    expect(esOtroNumero('912345678', 'percy.rojas')).toBe(true);
    expect(esOtroNumero('912345678', 'ig:17841400000')).toBe(true);
    expect(avisoOtroNumero('912345678', 'percy.rojas')).toContain('no muestra el número del cliente');
  });

  it('en la nota del pedido queda marcado para el repartidor', () => {
    expect(lineaCelular('912345678', '51987654321', 'Rosa (hija)')).toBe(
      'Celular para la entrega: 912345678 (de Rosa (hija)) — NO es el WhatsApp del chat (51987654321)',
    );
    expect(lineaCelular('987654321', '51987654321')).toBe('Celular: 987654321');
  });
});
