import { HttpException } from '@nestjs/common';
import { ConsolaFacturacionService } from './consola.service';

/**
 * El pase a producción contra la cuenta QPSE. QPSE va simulado: en la cuenta
 * real `produccion` no se puede deshacer.
 */
describe('ConsolaFacturacionService.pasarAProduccion', () => {
  const RUC = '20601234567';
  let cuenta: any[];
  let qpse: any;
  let prisma: any;
  let emisor: any;
  let svc: ConsolaFacturacionService;

  const errorQpse = (msg: string, status = 500) => new HttpException(`QPSE: ${msg}`, status);

  beforeEach(() => {
    cuenta = [];
    emisor = { id: 7, apiPublicId: 'iss_1', ruc: RUC, usaDemo: true, usuarioPse: null };
    qpse = {
      cuentaEmpresas: jest.fn(async () => cuenta.map((f) => ({ ...f }))),
      cuentaCrearEmpresa: jest.fn(async (ruc: string) => {
        cuenta.push({ external_id: 'ext-1', ruc, environment: 'demo', username: 'U1', password: 'P1' });
        return { success: true };
      }),
      cuentaPasarAProduccion: jest.fn(async (id: string) => {
        cuenta.find((f) => f.external_id === id).environment = 'production';
        return { success: true };
      }),
    };
    prisma = {
      empresa: {
        findUnique: jest.fn(async () => ({ id: 1, razonSocial: 'Dev', esIntegradorApi: true, _count: { emisores: 1 } })),
        update: jest.fn(async ({ data }: any) => Object.assign(emisor, data)),
      },
    };
    const emisores: any = {
      resolverParaIntegrador: jest.fn(async () => ({ ...emisor })),
      vistaPublica: jest.fn((e: any) => ({ id: e.apiPublicId, environment: e.usaDemo ? 'test' : 'live' })),
    };
    svc = new ConsolaFacturacionService(prisma, {} as any, {} as any, emisores, {} as any, {} as any, qpse);
  });

  it('sin confirmación no toca QPSE', async () => {
    await expect(svc.pasarAProduccion(1, 'iss_1', {})).rejects.toThrow(/no se puede deshacer/);
    expect(qpse.cuentaEmpresas).not.toHaveBeenCalled();
  });

  it('RUC nuevo: registra, pasa a producción y guarda las credenciales', async () => {
    const r = await svc.pasarAProduccion(1, 'iss_1', { confirm: true });
    expect(qpse.cuentaCrearEmpresa).toHaveBeenCalledWith(RUC);
    expect(qpse.cuentaPasarAProduccion).toHaveBeenCalledWith('ext-1');
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ usuarioPse: 'U1', contrasenaPse: 'P1', usaDemo: false, apiEmisorEstado: 'pendiente', apiEmisorMotivo: null }),
    });
    expect(r).toEqual({ id: 'iss_1', environment: 'live' });
  });

  it('ya registrado en demo: no lo vuelve a crear', async () => {
    cuenta.push({ external_id: 'ext-9', ruc: RUC, environment: 'demo', username: 'U9', password: 'P9' });
    await svc.pasarAProduccion(1, 'iss_1', { confirm: true });
    expect(qpse.cuentaCrearEmpresa).not.toHaveBeenCalled();
    expect(qpse.cuentaPasarAProduccion).toHaveBeenCalledWith('ext-9');
  });

  it('ya en producción en QPSE: no llama al paso irreversible', async () => {
    cuenta.push({ external_id: 'ext-9', ruc: RUC, environment: 'production', username: 'U9', password: 'P9' });
    await svc.pasarAProduccion(1, 'iss_1', { confirm: true });
    expect(qpse.cuentaPasarAProduccion).not.toHaveBeenCalled();
    expect(prisma.empresa.update).toHaveBeenCalled();
  });

  it('la empresa ya está en vivo: devuelve sin llamar a QPSE', async () => {
    emisor.usaDemo = false;
    emisor.usuarioPse = 'U1';
    await svc.pasarAProduccion(1, 'iss_1', {});
    expect(qpse.cuentaEmpresas).not.toHaveBeenCalled();
  });

  it('RUC en otra cuenta de QPSE: 409 entendible, sin guardar nada', async () => {
    qpse.cuentaCrearEmpresa.mockRejectedValueOnce(errorQpse('La empresa ya se encuentra registrada y activa en otra cuenta'));
    await expect(svc.pasarAProduccion(1, 'iss_1', { confirm: true })).rejects.toMatchObject({ status: 409 });
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('doble clic: "ya registrada en su cuenta" se toma como hecho', async () => {
    qpse.cuentaCrearEmpresa.mockImplementationOnce(async (ruc: string) => {
      cuenta.push({ external_id: 'ext-2', ruc, environment: 'demo', username: 'U2', password: 'P2' });
      throw errorQpse('La empresa ya se encuentra registrada en su cuenta');
    });
    await svc.pasarAProduccion(1, 'iss_1', { confirm: true });
    expect(qpse.cuentaPasarAProduccion).toHaveBeenCalledWith('ext-2');
  });

  it('"ya se encuentra en producción" al pasar: se sigue', async () => {
    cuenta.push({ external_id: 'ext-9', ruc: RUC, environment: 'demo', username: 'U9', password: 'P9' });
    qpse.cuentaPasarAProduccion.mockRejectedValueOnce(errorQpse('La empresa ya se encuentra en producción', 400));
    await svc.pasarAProduccion(1, 'iss_1', { confirm: true });
    expect(prisma.empresa.update).toHaveBeenCalled();
  });

  it('QPSE sin credenciales: 503 y la empresa sigue en prueba', async () => {
    cuenta.push({ external_id: 'ext-9', ruc: RUC, environment: 'production', username: '', password: '' });
    await expect(svc.pasarAProduccion(1, 'iss_1', { confirm: true })).rejects.toMatchObject({ status: 503 });
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });
});
