import { filtroBusquedaEmpresa } from './busqueda-empresa';

describe('filtroBusquedaEmpresa', () => {
  it('sin texto no filtra', () => {
    expect(filtroBusquedaEmpresa('')).toBeNull();
    expect(filtroBusquedaEmpresa('   ')).toBeNull();
    expect(filtroBusquedaEmpresa(undefined)).toBeNull();
  });

  it('no distingue mayúsculas y mira también el nombre comercial', () => {
    const f = filtroBusquedaEmpresa('henko');
    expect(f.AND).toHaveLength(1);
    expect(f.AND[0].OR).toEqual([
      { ruc: { contains: 'henko' } },
      { razonSocial: { contains: 'henko', mode: 'insensitive' } },
      { nombreComercial: { contains: 'henko', mode: 'insensitive' } },
    ]);
  });

  it('cada palabra debe estar, en cualquier orden', () => {
    const f = filtroBusquedaEmpresa('  importaciones   henko ');
    expect(f.AND.map((c: any) => c.OR[1].razonSocial.contains)).toEqual(['importaciones', 'henko']);
  });
});
