import { ShalomService } from './shalom.service';

/**
 * QA del servicio Shalom: toda falconext-mype usa el proveedor api.shalom-api.lat
 * (`ShalomLatService`). El proveedor legacy quedó retirado.
 */
describe('ShalomService (proveedor único api.shalom-api.lat)', () => {
  const makeLat = () => ({
    getAgencias: jest.fn().mockResolvedValue({ success: true, data: [], total: 0 }),
    track: jest.fn().mockResolvedValue({ success: true, search: {}, statuses: {} }),
    quote: jest.fn().mockResolvedValue({ ok: true }),
    createOrder: jest.fn().mockResolvedValue({ ok: true }),
    ticketImage: jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('png'), contentType: 'image/png' }),
    label: jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('pdf'), contentType: 'application/pdf' }),
  });
  const makePrisma = () => ({
    empresa: { findUnique: jest.fn() },
    envioDespacho: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  });

  const build = () => {
    const lat = makeLat();
    const prisma = makePrisma();
    const svc = new ShalomService(prisma as any, lat as any);
    return { svc, lat, prisma };
  };

  it('getAgencias/track delegan en el proveedor lat', async () => {
    const { svc, lat } = build();
    await svc.getAgencias(100);
    await svc.track('66479331', '3KTH', 100);
    expect(lat.getAgencias).toHaveBeenCalledTimes(1);
    expect(lat.track).toHaveBeenCalledWith('66479331', '3KTH', 100);
  });

  it('funciona sin empresaId', async () => {
    const { svc, lat } = build();
    await svc.getAgencias(undefined);
    expect(lat.getAgencias).toHaveBeenCalledTimes(1);
  });

  it('comprobante: passthrough de { buffer, contentType } del proveedor', async () => {
    const { svc } = build();
    const r = await svc.ticketImage('66479331', '3KTH', 400);
    expect(Buffer.isBuffer(r.buffer)).toBe(true);
    expect(r.contentType).toBe('image/png');
  });

  it('etiqueta: passthrough de { buffer, contentType }', async () => {
    const { svc } = build();
    const r = await svc.label('66479331', '3KTH', 400);
    expect(r.contentType).toBe('application/pdf');
  });
});
