import {
  FilaStockSede,
  leerCorreos,
  masUrgentes,
  normalizarCelular,
  productosStockBajo,
  textoWhatsApp,
  yaSalioHoy,
} from './alerta-stock';

const fila = (p: Partial<FilaStockSede>): FilaStockSede => ({
  productoId: 1,
  codigo: 'P1',
  descripcion: 'Producto',
  sedeId: 1,
  sedeNombre: 'Principal',
  stock: 0,
  minimoSede: null,
  minimoProducto: null,
  ...p,
});

describe('productosStockBajo', () => {
  it('entra el que está en su mínimo o por debajo, no el que está por encima', () => {
    const r = productosStockBajo([
      fila({ productoId: 1, descripcion: 'Peluche', stock: 10, minimoProducto: 10 }),
      fila({ productoId: 2, descripcion: 'Billetera', stock: 11, minimoProducto: 10 }),
      fila({ productoId: 3, descripcion: 'Correa', stock: 3, minimoProducto: 10 }),
    ]);
    expect(r.map((p) => p.descripcion)).toEqual(['Correa', 'Peluche']);
    expect(r[0].faltan).toBe(7);
  });

  it('sin mínimo no se vigila, aunque esté en cero (servicios, productos que no se reponen)', () => {
    expect(productosStockBajo([fila({ stock: 0, minimoProducto: 0 })])).toEqual([]);
    expect(productosStockBajo([fila({ stock: 0, minimoProducto: null })])).toEqual([]);
  });

  it('el mínimo de la sede manda sobre el del producto', () => {
    const r = productosStockBajo([
      fila({ sedeId: 1, sedeNombre: 'Centro', stock: 4, minimoSede: 5, minimoProducto: 2 }),
      fila({ sedeId: 2, sedeNombre: 'Mall', stock: 4, minimoSede: 0, minimoProducto: 2 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ sedeNombre: 'Centro', minimo: 5 });
  });

  it('agotados primero, después los más lejos de su mínimo', () => {
    const r = productosStockBajo([
      fila({ productoId: 1, descripcion: 'A', stock: 9, minimoProducto: 10 }),
      fila({ productoId: 2, descripcion: 'B', stock: 1, minimoProducto: 10 }),
      fila({ productoId: 3, descripcion: 'C', stock: 0, minimoProducto: 2 }),
    ]);
    expect(r.map((p) => p.descripcion)).toEqual(['C', 'B', 'A']);
    expect(r[0].agotado).toBe(true);
  });

  it('en cero sin haberse movido nunca en esa sede no cuenta (sede nueva, catálogo compartido)', () => {
    const r = productosStockBajo(
      [
        fila({ productoId: 1, sedeId: 1, sedeNombre: 'Centro', stock: 0, minimoProducto: 5 }),
        fila({ productoId: 1, sedeId: 2, sedeNombre: 'Nueva', stock: 0, minimoProducto: 5 }),
        fila({ productoId: 2, sedeId: 2, sedeNombre: 'Nueva', stock: 3, minimoProducto: 5 }),
      ],
      (productoId, sedeId) => productoId === 1 && sedeId === 1,
    );
    expect(r.map((p) => [p.productoId, p.sedeNombre])).toEqual([
      [1, 'Centro'], // se vendió hasta agotarse
      [2, 'Nueva'], // tiene stock: está bajo aunque no tenga movimientos
    ]);
  });

  it('stock negativo cuenta como agotado y lo que falta se mide desde ahí', () => {
    const [p] = productosStockBajo([fila({ stock: -2, minimoProducto: 5 })]);
    expect(p).toMatchObject({ agotado: true, faltan: 7 });
  });
});

describe('textos', () => {
  const lista = productosStockBajo([
    fila({ productoId: 1, descripcion: 'Peluche oso', stock: 0, minimoProducto: 5 }),
    fila({ productoId: 2, descripcion: 'Papel coreano', stock: 3, minimoProducto: 20 }),
    fila({ productoId: 3, descripcion: 'Chocolate', stock: 8, minimoProducto: 10 }),
    fila({ productoId: 4, descripcion: 'Caja regalo', stock: 9, minimoProducto: 10 }),
  ]);

  it('los más urgentes para la plantilla, con cuántos quedan fuera', () => {
    expect(masUrgentes(lista)).toBe('Peluche oso (0), Papel coreano (3), Chocolate (8) y 1 más');
  });

  it('el WhatsApp lista cada producto con su mínimo y el enlace al panel', () => {
    const t = textoWhatsApp('Regalos Lucía', lista, 'https://app.x/kardex');
    expect(t).toContain('4 productos están');
    expect(t).toContain('🔴 Peluche oso: 0 (mín. 5)');
    expect(t).toContain('🟠 Papel coreano: 3 (mín. 20)');
    expect(t).toContain('https://app.x/kardex');
    expect(t).not.toContain('🏬'); // una sola sede: sin encabezados de sede
  });

  it('con varias sedes, agrupa por sede', () => {
    const t = textoWhatsApp(
      'X',
      productosStockBajo([
        fila({ sedeId: 1, sedeNombre: 'Centro', stock: 0, minimoProducto: 1 }),
        fila({ sedeId: 2, sedeNombre: 'Mall', stock: 0, minimoProducto: 1 }),
      ]),
      'u',
    );
    expect(t).toContain('🏬 *Centro*');
    expect(t).toContain('🏬 *Mall*');
  });

  it('corta en 30 líneas y remite al correo', () => {
    const muchos = productosStockBajo(
      Array.from({ length: 35 }, (_, i) =>
        fila({ productoId: i, descripcion: `P${i}`, stock: 0, minimoProducto: 1 }),
      ),
    );
    const t = textoWhatsApp('X', muchos, 'u');
    expect(t).toContain('…y 5 más');
    expect(t.split('\n').filter((l) => l.startsWith('🔴'))).toHaveLength(30);
  });
});

describe('destinatarios', () => {
  it('lee correos separados por coma, espacio o línea, sin repetir', () => {
    expect(leerCorreos('a@x.com, B@x.com\nb@x.com;  c@y.pe')).toEqual({
      validos: ['a@x.com', 'b@x.com', 'c@y.pe'],
      invalidos: [],
    });
  });

  it('separa lo que no es correo para avisar al guardar', () => {
    expect(leerCorreos('a@x.com, lucia').invalidos).toEqual(['lucia']);
  });

  it('celular peruano a 51 + 9 dígitos', () => {
    expect(normalizarCelular('987 654 321')).toBe('51987654321');
    expect(normalizarCelular('+51 987-654-321')).toBe('51987654321');
    expect(normalizarCelular('12345')).toBeNull();
    expect(normalizarCelular('')).toBeNull();
  });
});

describe('una vez por día (hora de Lima)', () => {
  it('a las 23:30 de Lima del día anterior no cuenta como hoy', () => {
    const ayerNoche = new Date('2026-10-20T04:30:00Z'); // 19/10 23:30 Lima
    const hoy8am = new Date('2026-10-20T13:00:00Z'); // 20/10 08:00 Lima
    expect(yaSalioHoy(ayerNoche, hoy8am)).toBe(false);
    expect(yaSalioHoy(new Date('2026-10-20T13:00:05Z'), hoy8am)).toBe(true);
    expect(yaSalioHoy(null, hoy8am)).toBe(false);
  });
});
