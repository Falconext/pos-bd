import { ForbiddenException } from '@nestjs/common';
import { verificarPuedeAnularComprobante } from './puede-anular-comprobante.util';

/**
 * Anular/eliminar comprobante: por defecto solo ADMIN_EMPRESA puede.
 * Un USUARIO_EMPRESA puede si el admin le activó `puedeAnularComprobantes`
 * (permiso fino, re-consultado en cada request por JwtStrategy).
 */
describe('verificarPuedeAnularComprobante', () => {
  it('ADMIN_EMPRESA siempre puede, sin importar el flag', () => {
    expect(() =>
      verificarPuedeAnularComprobante({
        rol: 'ADMIN_EMPRESA',
        puedeAnularComprobantes: false,
      }),
    ).not.toThrow();
  });

  it('USUARIO_EMPRESA sin el permiso: lanza 403', () => {
    expect(() =>
      verificarPuedeAnularComprobante({
        rol: 'USUARIO_EMPRESA',
        puedeAnularComprobantes: false,
      }),
    ).toThrow(ForbiddenException);
  });

  it('USUARIO_EMPRESA con puedeAnularComprobantes undefined (default): lanza 403', () => {
    expect(() =>
      verificarPuedeAnularComprobante({ rol: 'USUARIO_EMPRESA' }),
    ).toThrow(ForbiddenException);
  });

  it('USUARIO_EMPRESA con el permiso activado: no lanza', () => {
    expect(() =>
      verificarPuedeAnularComprobante({
        rol: 'USUARIO_EMPRESA',
        puedeAnularComprobantes: true,
      }),
    ).not.toThrow();
  });
});
