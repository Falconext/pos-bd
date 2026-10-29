import { ForbiddenException } from '@nestjs/common';
import { SoloImagenesGuard, esRutaDeImagen } from './solo-imagenes.guard';

const ctx = (method: string, path: string, user: any) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ method, route: { path }, user }) }) }) as any;

describe('SoloImagenesGuard', () => {
  const guard = new SoloImagenesGuard();
  const fotografo = { rol: 'USUARIO_EMPRESA', soloImagenesProductos: true };

  it('reconoce las rutas de fotos', () => {
    expect(esRutaDeImagen('/api/productos/:id/imagen')).toBe(true);
    expect(esRutaDeImagen('/api/productos/:id/imagen-color-url')).toBe(true);
    expect(esRutaDeImagen('/api/productos/ia/aprobar-imagen')).toBe(true);
    expect(esRutaDeImagen('/api/productos/:id')).toBe(false);
    expect(esRutaDeImagen('/api/productos/:id/estado')).toBe(false);
  });

  it('deja leer y subir fotos', () => {
    expect(guard.canActivate(ctx('GET', '/api/productos', fotografo))).toBe(true);
    expect(guard.canActivate(ctx('POST', '/api/productos/:id/imagen', fotografo))).toBe(true);
    expect(guard.canActivate(ctx('PATCH', '/api/productos/:id/imagenes-extra', fotografo))).toBe(true);
  });

  it('bloquea precio, alta, baja, estado e importación', () => {
    for (const [m, p] of [
      ['PUT', '/api/productos/:id'],
      ['POST', '/api/productos'],
      ['DELETE', '/api/productos/:id'],
      ['PATCH', '/api/productos/:id/estado'],
      ['POST', '/api/productos/importar'],
    ]) {
      expect(() => guard.canActivate(ctx(m, p, fotografo))).toThrow(ForbiddenException);
    }
  });

  it('no afecta a usuarios normales ni al admin', () => {
    expect(guard.canActivate(ctx('PUT', '/api/productos/:id', { rol: 'USUARIO_EMPRESA' }))).toBe(true);
    expect(
      guard.canActivate(ctx('PUT', '/api/productos/:id', { rol: 'ADMIN_EMPRESA', soloImagenesProductos: true })),
    ).toBe(true);
  });
});
