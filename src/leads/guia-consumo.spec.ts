import { borradorDeGuia } from './leads-guia.service';
import { contextoHistorialCliente } from './pedidos-del-cliente';

describe('guía de consumo', () => {
  it('arma el borrador solo con lo que escribió el negocio y lista lo que falta', () => {
    const r = borradorDeGuia(
      { nombre: 'Rosa Quispe', edad: 52, sexo: 'F', sintomas: 'acidez por las noches' },
      [
        { nombre: 'Moringa x 100', modoDeUso: '2 cápsulas en ayunas.\nMayores de 60: 1 cápsula.' },
        { nombre: 'Uña de gato 250 ml', modoDeUso: null },
      ],
    );
    expect(r.texto).toContain('*Tu guía de consumo* — Rosa');
    expect(r.texto).toContain('Para: mujer, 52 años');
    expect(r.texto).toContain('Lo que nos contaste: acidez por las noches');
    expect(r.texto).toContain('*Moringa x 100*\n2 cápsulas en ayunas.');
    expect(r.texto).not.toContain('Uña de gato');
    expect(r.sinModoDeUso).toEqual(['Uña de gato 250 ml']);
  });

  it('sin ningún modo de uso no hay borrador (no se inventa nada)', () => {
    expect(borradorDeGuia({}, [{ nombre: 'Miel', modoDeUso: '  ' }])).toEqual({ texto: '', sinModoDeUso: ['Miel'] });
  });
});

describe('historial del cliente en el contexto del bot', () => {
  it('vacío no agrega nada', () => {
    expect(contextoHistorialCliente([], null)).toBe('');
  });

  it('compras anteriores y la guía enviada', () => {
    const t = contextoHistorialCliente(
      [{ fechaEmision: new Date('2026-10-05T17:00:00Z'), productos: ['Moringa x 2'] }],
      { texto: 'Moringa: 2 cápsulas en ayunas.', en: new Date('2026-10-06T17:00:00Z') },
    );
    expect(t).toContain('COMPRAS ANTERIORES DE ESTE CLIENTE');
    expect(t).toMatch(/5 oct\.? 2026: Moringa x 2\./);
    expect(t).toContain('"lo mismo"');
    expect(t).toContain('GUÍA DE CONSUMO QUE EL NEGOCIO LE ENVIÓ');
    expect(t).toContain('Moringa: 2 cápsulas en ayunas.');
    expect(t).toContain('no cambies dosis');
  });
});
