import { authRateLimit } from './rate-limit.middleware';

/** Llama al middleware como lo haría express y devuelve el status final. */
function llamar(
  mw: ReturnType<typeof authRateLimit>,
  method: string,
  path: string,
  ip: string,
): number {
  let status = 200;
  const finales: (() => void)[] = [];
  const res: any = {
    statusCode: 200,
    setHeader: () => undefined,
    status(c: number) {
      status = c;
      this.statusCode = c;
      return this;
    },
    json: () => undefined,
    on: (_: string, cb: () => void) => finales.push(cb),
  };
  let siguio = false;
  mw(
    { method, path, headers: { 'x-forwarded-for': ip }, ip } as any,
    res,
    () => {
      siguio = true;
    },
  );
  finales.forEach((cb) => cb());
  return siguio ? 200 : status;
}

describe('Rate limit del Libro de Reclamaciones público', () => {
  it('5 hojas por IP; la 6.ª → 429 aunque cambie de tienda', () => {
    const mw = authRateLimit();
    const ip = '203.0.113.10';
    for (let i = 0; i < 5; i += 1) {
      expect(
        llamar(
          mw,
          'POST',
          `/api/public/store/tienda-${i % 2}/libro-reclamaciones`,
          ip,
        ),
      ).toBe(200);
    }
    expect(
      llamar(mw, 'POST', '/api/public/store/otra/libro-reclamaciones', ip),
    ).toBe(429);
    // Otra IP sigue pudiendo.
    expect(
      llamar(
        mw,
        'POST',
        '/api/public/store/otra/libro-reclamaciones',
        '203.0.113.11',
      ),
    ).toBe(200);
  });

  it('GET del formulario y de la constancia no se limitan', () => {
    const mw = authRateLimit();
    const ip = '203.0.113.20';
    for (let i = 0; i < 20; i += 1) {
      expect(
        llamar(mw, 'GET', '/api/public/store/t/libro-reclamaciones', ip),
      ).toBe(200);
      expect(
        llamar(
          mw,
          'GET',
          '/api/public/store/t/libro-reclamaciones/2026-000001/constancia',
          ip,
        ),
      ).toBe(200);
    }
  });
});
