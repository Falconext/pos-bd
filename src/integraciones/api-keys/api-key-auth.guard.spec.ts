/**
 * El guard que protege las APIs públicas, ahora compartido entre productos.
 *
 * Lo que de verdad hay que defender acá es el aislamiento por producto. Una
 * key de logística que sirviera para facturar significa que un integrador
 * —o quien le filtre la key— puede emitir comprobantes ante SUNAT a nombre de
 * la empresa. Es el peor escenario de toda la API, y no existía antes porque
 * solo había un producto.
 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { CLAVE_PRODUCTO_API } from './producto-api';

function armar(opts: {
  producto?: unknown;
  validacion?: any;
  metodo?: string;
  headers?: Record<string, unknown>;
  permitido?: boolean;
} = {}) {
  const res = { headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; } };
  const req: any = { method: opts.metodo ?? 'POST', headers: opts.headers ?? { authorization: 'Bearer sk_live_abc' } };
  const apiKeys: any = {
    validarParaProducto: jest.fn().mockResolvedValue(
      opts.validacion ?? { ok: true, registro: { id: 7, empresaId: 89, entorno: 'live', producto: 'facturacion' } },
    ),
  };
  const rateLimits: any = {
    consume: jest.fn(() => ({ allowed: opts.permitido !== false, limit: 120, remaining: 119, reset: 42 })),
  };
  const reflector: any = {
    getAllAndOverride: jest.fn((clave: string) =>
      clave === CLAVE_PRODUCTO_API ? ('producto' in opts ? opts.producto : 'facturacion') : undefined,
    ),
  };
  const ctx: any = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  };
  return { guard: new ApiKeyAuthGuard(apiKeys, rateLimits, reflector), ctx, req, res, apiKeys, rateLimits };
}

describe('aislamiento entre productos', () => {
  it('una key del producto correcto pasa', async () => {
    const { guard, ctx, req } = armar();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.apiEmpresaId).toBe(89);
    expect(req.apiProducto).toBe('facturacion');
  });

  it('valida contra el producto que declara el endpoint, no contra cualquiera', async () => {
    const { guard, ctx, apiKeys } = armar();
    await guard.canActivate(ctx);
    expect(apiKeys.validarParaProducto).toHaveBeenCalledWith('sk_live_abc', 'facturacion');
  });

  it('una key de logística NO puede emitir facturas: 403, no 401', async () => {
    // 401 lo mandaría a rotar una key que está bien y el problema seguiría.
    const { guard, ctx } = armar({ validacion: { ok: false, motivo: 'producto' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'product_forbidden' },
    });
  });

  it('un endpoint sin @ApiProducto no autentica: falla en vez de dejar pasar', async () => {
    // Prefiere romperse a aceptar una key de otra API. Ese error no se nota
    // hasta que alguien emite una factura con una key de logística.
    const { guard, ctx } = armar({ producto: undefined });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'api_product_not_configured' },
    });
  });

  it('un producto que no existe tampoco pasa', async () => {
    const { guard, ctx } = armar({ producto: 'inventado' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'api_product_not_configured' },
    });
  });
});

describe('la clave en la petición', () => {
  it('la toma de Authorization: Bearer', async () => {
    const { guard, ctx, apiKeys } = armar({ headers: { authorization: 'Bearer sk_live_xyz' } });
    await guard.canActivate(ctx);
    expect(apiKeys.validarParaProducto).toHaveBeenCalledWith('sk_live_xyz', 'facturacion');
  });

  it('también de x-api-key', async () => {
    const { guard, ctx, apiKeys } = armar({ headers: { 'x-api-key': 'sk_live_h' } });
    await guard.canActivate(ctx);
    expect(apiKeys.validarParaProducto).toHaveBeenCalledWith('sk_live_h', 'facturacion');
  });

  it('sin clave es 401', async () => {
    const { guard, ctx } = armar({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ response: { code: 'missing_api_key' } });
  });

  it('un Bearer vacío es 401, no una clave vacía válida', async () => {
    const { guard, ctx } = armar({ headers: { authorization: 'Bearer    ' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ response: { code: 'missing_api_key' } });
  });

  it('una key revocada es 401', async () => {
    const { guard, ctx } = armar({ validacion: { ok: false, motivo: 'invalida' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ response: { code: 'invalid_api_key' } });
  });
});

describe('las cabeceras de cuota', () => {
  it('salen en toda respuesta, no solo al pasarse', async () => {
    const { guard, ctx, res } = armar();
    await guard.canActivate(ctx);
    expect(res.headers).toMatchObject({
      'RateLimit-Limit': '120',
      'RateLimit-Remaining': '119',
      'RateLimit-Reset': '42',
    });
  });

  it('al superar el límite: 429 con Retry-After', async () => {
    const { guard, ctx, res } = armar({ permitido: false });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'too_many_requests' },
      status: 429,
    });
    expect(res.headers['Retry-After']).toBe('42');
  });

  it('la cuota se cuenta por key, no por empresa', async () => {
    // Dos integraciones de la misma empresa no se consumen la cuota entre sí.
    const { guard, ctx, rateLimits } = armar();
    await guard.canActivate(ctx);
    expect(rateLimits.consume).toHaveBeenCalledWith('7', 'POST');
  });
});
