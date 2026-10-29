import { ForbiddenException } from '@nestjs/common';
import { verificarPuedeVenderEnSede } from './puede-vender-en-sede.util';

describe('verificarPuedeVenderEnSede', () => {
  const vendedor = { rol: 'USUARIO_EMPRESA', sedeId: 2, sedesSinVenta: [2] };

  it('bloquea boleta/factura/NV en una sede sin venta', () => {
    expect(() => verificarPuedeVenderEnSede(vendedor)).toThrow(ForbiddenException);
    expect(() => verificarPuedeVenderEnSede(vendedor, 'NV')).toThrow(ForbiddenException);
    expect(() => verificarPuedeVenderEnSede(vendedor, 'TICKET')).toThrow(ForbiddenException);
  });

  it('deja cotizar, nota de pedido y OT en esa sede', () => {
    for (const t of ['COT', 'NP', 'OT', 'cot']) {
      expect(() => verificarPuedeVenderEnSede(vendedor, t)).not.toThrow();
    }
  });

  it('deja vender en las otras sedes', () => {
    expect(() => verificarPuedeVenderEnSede({ ...vendedor, sedeId: 1 }, 'NV')).not.toThrow();
  });

  it('el admin de la empresa nunca se restringe', () => {
    expect(() => verificarPuedeVenderEnSede({ ...vendedor, rol: 'ADMIN_EMPRESA' })).not.toThrow();
  });

  it('sin la lista (token viejo) no bloquea', () => {
    expect(() => verificarPuedeVenderEnSede({ rol: 'USUARIO_EMPRESA', sedeId: 2 })).not.toThrow();
  });
});
