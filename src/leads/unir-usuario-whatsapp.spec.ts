import { conversacionDelMismoCliente, esTelefono } from './unir-usuario-whatsapp';

describe('mismo cliente con @usuario y con número (Hierba Sana, Erica 23-10)', () => {
  const erica = { id: 873, telefonoProspecto: 'PE.1602933681519633', celularEntrega: '934312777' };
  const otra = { id: 900, telefonoProspecto: 'PE.999', celularEntrega: '911222333' };

  it('el BSUID del mensaje manda', () => {
    expect(conversacionDelMismoCliente('51934312777', 'PE.1602933681519633', [otra, erica])).toBe(873);
  });

  it('sin BSUID en el mensaje: por el celular que dio para la entrega', () => {
    expect(conversacionDelMismoCliente('51934312777', null, [otra, erica])).toBe(873);
  });

  it('si dos calzan no adivina; si ninguna, tampoco', () => {
    expect(conversacionDelMismoCliente('51934312777', null, [erica, { ...erica, id: 874 }])).toBeNull();
    expect(conversacionDelMismoCliente('51955555555', null, [erica, otra])).toBeNull();
  });

  it('solo une a un número; un BSUID que llega no se une a nada', () => {
    expect(conversacionDelMismoCliente('PE.1602933681519633', null, [erica])).toBeNull();
    expect(esTelefono('51934312777')).toBe(true);
    expect(esTelefono('PE.1602933681519633')).toBe(false);
  });
});
