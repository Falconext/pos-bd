/**
 * El reintento automático borra los comprobantes que SUNAT rechaza por datos.
 * Antes borraba solo sus filas del kardex: una nota de crédito dejaba el stock
 * sumado y una boleta lo dejaba descontado, sin rastro de por qué. Ahora usa
 * el mismo borrado que al emitir, que corrige el stock.
 */
import { VerificarPendientesSunatService } from './verificar-pendientes-sunat.service';

describe('autoEliminarComprobante', () => {
  function crear() {
    const prisma: any = {
      comprobante: {
        findUnique: jest.fn().mockResolvedValue({
          id: 50,
          empresaId: 88,
          serie: 'FC01',
          correlativo: 1,
          tipoDoc: '07',
          sunatErrorMsg: null,
        }),
      },
      $transaction: jest.fn(),
    };
    const comprobanteService: any = {
      guardarLogErrorFatal: jest.fn().mockResolvedValue(undefined),
      eliminarComprobante: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new VerificarPendientesSunatService(
      prisma,
      {} as any,
      comprobanteService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { svc: svc as any, prisma, comprobanteService };
  }

  it('deja el log y borra con eliminarComprobante, que corrige el stock', async () => {
    const { svc, prisma, comprobanteService } = crear();
    await svc.autoEliminarComprobante(50, '[DATOS] RUC inválido');
    expect(comprobanteService.guardarLogErrorFatal).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 88,
        tipoDoc: '07',
        errorMsg: '[DATOS] RUC inválido',
      }),
    );
    expect(comprobanteService.eliminarComprobante).toHaveBeenCalledWith(50);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('si el borrado falla, no revienta el job', async () => {
    const { svc, comprobanteService } = crear();
    comprobanteService.eliminarComprobante.mockRejectedValue(new Error('FK'));
    await expect(svc.autoEliminarComprobante(50)).resolves.toBeUndefined();
  });
});
