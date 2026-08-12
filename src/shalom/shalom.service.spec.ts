import { ShalomService } from './shalom.service';

/**
 * QA del dispatcher: enruta por empresa.resellerId.
 *  - resellerId != null → proveedor NUEVO (shalom-api.lat)
 *  - resellerId == null / sin empresa → proveedor ANTIGUO (shalom-api-peru)
 */
describe('ShalomService (dispatcher por reseller)', () => {
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
  const makeLegacy = () => ({
    getAgencias: jest.fn().mockResolvedValue({ success: true, data: [], total: 0 }),
    track: jest.fn().mockResolvedValue({ success: true, search: {}, statuses: {} }),
    quote: jest.fn().mockResolvedValue({ ok: true }),
    createOrder: jest.fn().mockResolvedValue({ ok: true }),
    ticketImage: jest.fn().mockResolvedValue(Buffer.from('legacy-pdf')),
    label: jest.fn().mockResolvedValue(Buffer.from('legacy-pdf')),
  });
  const makePrisma = (resellerId: number | null) => ({
    empresa: { findUnique: jest.fn().mockResolvedValue({ resellerId }) },
  });

  const build = (resellerId: number | null) => {
    const lat = makeLat();
    const legacy = makeLegacy();
    const prisma = makePrisma(resellerId);
    const svc = new ShalomService(prisma as any, legacy as any, lat as any);
    return { svc, lat, legacy, prisma };
  };

  it('empresa de reseller → usa proveedor NUEVO (lat)', async () => {
    const { svc, lat, legacy } = build(7);
    await svc.getAgencias(100);
    await svc.track('66479331', '3KTH', 100);
    expect(lat.getAgencias).toHaveBeenCalledTimes(1);
    expect(lat.track).toHaveBeenCalledWith('66479331', '3KTH', 100);
    expect(legacy.getAgencias).not.toHaveBeenCalled();
    expect(legacy.track).not.toHaveBeenCalled();
  });

  it('empresa directa (resellerId null) → usa proveedor ANTIGUO (legacy)', async () => {
    const { svc, lat, legacy } = build(null);
    await svc.getAgencias(200);
    await svc.track('66479331', '3KTH', 200);
    expect(legacy.getAgencias).toHaveBeenCalledTimes(1);
    expect(legacy.track).toHaveBeenCalledWith('66479331', '3KTH', 200);
    expect(lat.getAgencias).not.toHaveBeenCalled();
    expect(lat.track).not.toHaveBeenCalled();
  });

  it('sin empresaId → usa proveedor ANTIGUO (default falconext-mype)', async () => {
    const { svc, lat, legacy } = build(null);
    await svc.getAgencias(undefined);
    expect(legacy.getAgencias).toHaveBeenCalledTimes(1);
    expect(lat.getAgencias).not.toHaveBeenCalled();
  });

  it('comprobante: legacy devuelve Buffer → se normaliza a PDF', async () => {
    const { svc } = build(null);
    const r = await svc.ticketImage('66479331', '3KTH', 300, 999);
    expect(Buffer.isBuffer(r.buffer)).toBe(true);
    expect(r.contentType).toBe('application/pdf');
  });

  it('comprobante: nuevo (reseller) devuelve PNG passthrough', async () => {
    const { svc } = build(7);
    const r = await svc.ticketImage('66479331', '3KTH', 400);
    expect(r.contentType).toBe('image/png');
  });

  it('cachea la relación empresa→reseller (una sola consulta por empresa)', async () => {
    const { svc, prisma } = build(7);
    await svc.getAgencias(500);
    await svc.track('1', '2', 500);
    await svc.getAgencias(500);
    expect(prisma.empresa.findUnique).toHaveBeenCalledTimes(1);
  });
});
