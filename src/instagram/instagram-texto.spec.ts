import { enTextoPlano, partirMensaje, esDestinoInstagram, idInstagram, destinoInstagram } from './instagram-texto';

describe('Instagram: texto', () => {
  it('quita el formato de WhatsApp, que Instagram muestra literal', () => {
    expect(enTextoPlano('Te espero en *Av. Emancipación 687*')).toBe('Te espero en Av. Emancipación 687');
    expect(enTextoPlano('**Precio:** S/ 30 y _envío gratis_ ~antes 40~')).toBe('Precio: S/ 30 y envío gratis antes 40');
    expect(enTextoPlano('### Horario\nLunes a sábado')).toBe('Horario\nLunes a sábado');
  });

  it('no rompe asteriscos sueltos ni multiplicaciones', () => {
    expect(enTextoPlano('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(enTextoPlano('nota_de_voz.ogg')).toBe('nota_de_voz.ogg');
  });

  it('un mensaje corto va entero', () => {
    expect(partirMensaje('Hola!')).toEqual(['Hola!']);
    expect(partirMensaje('   ')).toEqual([]);
  });

  it('uno largo se parte por párrafo sin pasar de 1000 bytes', () => {
    const parrafo = 'á'.repeat(300); // 600 bytes
    const partes = partirMensaje([parrafo, parrafo, parrafo].join('\n\n'));
    expect(partes).toHaveLength(3);
    for (const p of partes) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(1000);
  });

  it('una palabra que sola no entra se corta por caracteres', () => {
    const link = 'https://x.com/' + 'a'.repeat(2500);
    const partes = partirMensaje(link);
    expect(partes.join('')).toBe(link);
    for (const p of partes) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(1000);
  });

  it('el destino de Instagram lleva prefijo y no parece un teléfono', () => {
    const d = destinoInstagram('17841400000000001');
    expect(d).toBe('ig:17841400000000001');
    expect(esDestinoInstagram(d)).toBe(true);
    expect(esDestinoInstagram('51987654321')).toBe(false);
    expect(idInstagram(d)).toBe('17841400000000001');
    expect(/^\+?\d{8,15}$/.test(d)).toBe(false);
  });
});
