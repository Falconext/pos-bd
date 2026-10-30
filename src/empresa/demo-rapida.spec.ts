import { contrasenaInicial, datosDesdeSunat, planDeLimpiezaDemo, ClaveConRegla } from './demo-rapida';

const fk = (hija: string, columna: string, padre: string, regla: string): ClaveConRegla => ({
  hija,
  columna,
  padre,
  padreColumna: 'id',
  regla,
});

describe('planDeLimpiezaDemo', () => {
  const fks = [
    fk('DetalleComprobante', 'comprobanteId', 'Comprobante', 'RESTRICT'),
    fk('Pago', 'comprobanteId', 'Comprobante', 'CASCADE'),
    fk('MovimientoKardex', 'comprobanteId', 'Comprobante', 'SET NULL'),
    fk('Comprobante', 'comprobanteOrigenId', 'Comprobante', 'SET NULL'),
    fk('ProductoSerie', 'detalleComprobanteId', 'DetalleComprobante', 'SET NULL'),
    fk('DetalleGuiaRemision', 'guiaRemisionId', 'GuiaRemision', 'CASCADE'),
    fk('Comprobante', 'empresaId', 'Empresa', 'RESTRICT'),
    fk('Producto', 'empresaId', 'Empresa', 'RESTRICT'),
  ];
  const plan = planDeLimpiezaDemo(fks);
  const tablas = plan.map((p) => p.tabla);

  it('borra los comprobantes y guías de la empresa y lo que cuelga de ellos', () => {
    expect(tablas).toEqual(
      expect.arrayContaining(['Comprobante', 'GuiaRemision', 'DetalleComprobante', 'Pago', 'DetalleGuiaRemision']),
    );
    expect(plan.find((p) => p.tabla === 'Comprobante')!.donde).toBe('"empresaId" = $1');
    expect(plan.find((p) => p.tabla === 'DetalleComprobante')!.donde).toBe(
      '"comprobanteId" IN (SELECT "id" FROM "Comprobante" WHERE ("empresaId" = $1))',
    );
  });

  it('deja el kardex, las series de producto y el catálogo: se anulan solos o no cuelgan', () => {
    expect(tablas).not.toContain('MovimientoKardex');
    expect(tablas).not.toContain('ProductoSerie');
    expect(tablas).not.toContain('Producto');
    expect(tablas).not.toContain('Empresa');
  });

  it('hijas antes que padres', () => {
    expect(tablas.indexOf('DetalleComprobante')).toBeLessThan(tablas.indexOf('Comprobante'));
    expect(tablas.indexOf('DetalleGuiaRemision')).toBeLessThan(tablas.indexOf('GuiaRemision'));
  });

  it('un ciclo de FK no lo cuelga', () => {
    const ciclo = [fk('A', 'bId', 'B', 'CASCADE'), fk('B', 'aId', 'A', 'CASCADE'), fk('A', 'cId', 'Comprobante', 'CASCADE')];
    expect(() => planDeLimpiezaDemo(ciclo)).not.toThrow();
  });
});

describe('contrasenaInicial', () => {
  it('10 caracteres sin los que se confunden al dictarlos', () => {
    for (let i = 0; i < 50; i++) {
      const c = contrasenaInicial();
      expect(c).toHaveLength(10);
      expect(c).not.toMatch(/[0O1lI]/);
    }
  });
});

describe('datosDesdeSunat', () => {
  it('toma el ubigeo de distrito y la dirección completa', () => {
    const d = datosDesdeSunat({
      nombre_o_razon_social: ' ACME SAC ',
      direccion_completa: 'AV. LIMA 123',
      ubigeo: ['15', '1501', '150101'],
      departamento: 'LIMA',
      estado: 'activo',
    });
    expect(d).toMatchObject({ razonSocial: 'ACME SAC', direccion: 'AV. LIMA 123', ubigeo: '150101', estado: 'ACTIVO' });
  });
});
