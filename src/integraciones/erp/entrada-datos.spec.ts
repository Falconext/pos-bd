import { leerCambioCliente, leerClienteNuevo, leerNombre } from './entrada-datos';

const error = (f: () => unknown) => {
  try {
    f();
  } catch (e: any) {
    return e.getResponse();
  }
  throw new Error('se esperaba un error');
};

describe('categorías y marcas', () => {
  it('limpia los espacios del nombre', () => {
    expect(leerNombre({ name: '  Bebidas   frías ' }, 'categoría')).toBe('Bebidas frías');
  });
  it('el nombre es obligatorio y en `name`', () => {
    expect(error(() => leerNombre({}, 'marca')).param).toBe('name');
    expect(error(() => leerNombre({ nombre: 'x' }, 'marca')).message).toMatch(/`name`/);
  });
});

describe('clientes', () => {
  it('alta con RUC, normaliza el celular', () => {
    expect(leerClienteNuevo({ document_type: 'ruc', document_number: '20123456789', name: 'ACME SAC', phone: '987 654-321' })).toMatchObject({
      tipo: 'RUC',
      numero: '20123456789',
      nombre: 'ACME SAC',
      telefono: '987654321',
    });
  });
  it('valida DNI, RUC, correo y celular', () => {
    expect(error(() => leerClienteNuevo({ document_type: 'dni', document_number: '123', name: 'X' })).message).toMatch(/8 dígitos/);
    expect(error(() => leerClienteNuevo({ document_type: 'ruc', document_number: '30123456789', name: 'X' })).message).toMatch(/11 dígitos/);
    expect(error(() => leerClienteNuevo({ document_type: 'dni', document_number: '47065472', name: 'X', email: 'mal' })).param).toBe('email');
    expect(error(() => leerClienteNuevo({ document_type: 'dni', document_number: '47065472', name: 'X', phone: 'abc' })).param).toBe('phone');
  });
  it('tipo de documento desconocido', () => {
    expect(error(() => leerClienteNuevo({ document_type: 'cuit', document_number: '1', name: 'X' })).message).toMatch(/dni, ruc, ce, passport/);
  });
  it('el cambio no toca el documento y null borra el dato', () => {
    expect(error(() => leerCambioCliente({ document_number: '1' })).message).toMatch(/identifica/);
    expect(leerCambioCliente({ address: null, email: 'a@b.pe' })).toMatchObject({ direccion: '', email: 'a@b.pe' });
    expect(error(() => leerCambioCliente({})).message).toMatch(/ningún campo/);
  });
});
