import { CobrosApiService, PREFIJO_COBRO_API } from './cobros-api.service';

/**
 * El cobro mensual de la API, del lado del integrador. Lo que no puede fallar:
 * dar por pagado algo que no se pagó entero, aplicar dos veces el mismo pago,
 * dejar que un integrador vea o pague el cobro de otro, facturar dos veces o
 * a nombre equivocado, y mandar el mismo recordatorio dos veces.
 */
describe('CobrosApiService', () => {
  let prisma: any;
  let mp: any;
  let cobros: any;
  let facturacion: any;
  let comprobantes: any;
  let svc: CobrosApiService;
  const DATOS = { tipo: 'ruc', numero: '20601234567', nombre: 'MI SOFTWARE SAC', direccion: 'AV. LIMA 123', email: 'pagos@misoft.pe' };
  const cobro = (over: any = {}) => ({
    id: 11,
    empresaId: 1,
    periodo: '2026-10',
    concepto: 'API_FACTURACION',
    monto: 5.9,
    estado: 'PENDIENTE',
    descripcion: 'API de facturación 2026-10 — 30 comprobantes aceptados',
    fechaVencimiento: new Date('2026-11-17T15:00:00Z'),
    fechaCobro: null,
    medioPago: null,
    comprobanteId: null,
    avisoPrevioEn: null,
    avisoBloqueoEn: null,
    ...over,
  });
  const pago = (over: any = {}) => ({
    id: 987,
    status: 'approved',
    external_reference: `${PREFIJO_COBRO_API}11`,
    transaction_amount: 5.9,
    date_approved: '2026-11-03T15:00:00Z',
    ...over,
  });

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    process.env.PLATAFORMA_FACTURA_EMPRESA_ID = '22';
    delete process.env.COBROS_API_AVISOS_ENABLED;
    prisma = {
      cobroEmpresa: {
        findUnique: jest.fn(async () => cobro()),
        findFirst: jest.fn(async () => cobro()),
        findMany: jest.fn(async () => [cobro()]),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      empresa: { findUnique: jest.fn(async () => ({ datosFacturacion: DATOS })) },
      comprobante: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => ({ serie: 'F001', correlativo: 7 })) },
      consumoApiMes: { findUnique: jest.fn(async () => ({ subtotal: 5, cantidad: 30 })) },
      usuario: { findMany: jest.fn(async () => [{ email: 'dev@ejemplo.com' }]) },
    };
    mp = {
      registrarReceptor: jest.fn(),
      plataformaConfigurada: jest.fn(() => true),
      crearCobroPlataforma: jest.fn(async () => ({ preferenceId: 'p1', initPoint: 'https://mp/pagar' })),
      pagosPlataforma: jest.fn(async () => [pago()]),
    };
    cobros = { registrarPago: jest.fn(async () => ({})), registrarAlPagar: jest.fn() };
    facturacion = { emitirComoPlataforma: jest.fn(async () => ({ id: 500, numero: 'F001-00000007' })) };
    comprobantes = { generarBufferPdf: jest.fn(async () => ({ buffer: Buffer.from('pdf') })) };
    svc = new CobrosApiService(prisma, mp, cobros, facturacion, comprobantes);
  });

  it('se registra en el webhook de Mercado Pago y en los pagos del panel', () => {
    svc.onModuleInit();
    expect(mp.registrarReceptor).toHaveBeenCalledWith(PREFIJO_COBRO_API, expect.any(Function));
    expect(cobros.registrarAlPagar).toHaveBeenCalledWith(expect.any(Function));
  });

  describe('el pago', () => {
    it('un pago aprobado por el total salda el cobro', async () => {
      await svc.pagoRecibido(pago());
      expect(cobros.registrarPago).toHaveBeenCalledWith(11, expect.objectContaining({ medioPago: 'MERCADO_PAGO', referencia: '987', monto: 5.9 }));
    });

    it('un pago por menos de lo debido no lo da por pagado', async () => {
      await svc.pagoRecibido(pago({ transaction_amount: 3 }));
      expect(cobros.registrarPago).not.toHaveBeenCalled();
    });

    it('un pago no aprobado no hace nada', async () => {
      await svc.pagoRecibido(pago({ status: 'pending' }));
      expect(cobros.registrarPago).not.toHaveBeenCalled();
    });

    it('webhook y retorno a la vez: el segundo no rompe', async () => {
      cobros.registrarPago.mockRejectedValueOnce(new Error('Este cobro ya figura como pagado'));
      await expect(svc.pagoRecibido(pago())).resolves.toBeUndefined();
    });

    it('un cobro ya aplicado no se vuelve a aplicar', async () => {
      prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro({ estado: 'APLICADO' }));
      await svc.pagoRecibido(pago());
      expect(cobros.registrarPago).not.toHaveBeenCalled();
    });

    it('una mensualidad del ERP no se paga por este camino', async () => {
      prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro({ concepto: 'MENSUALIDAD' }));
      await svc.pagoRecibido(pago());
      expect(cobros.registrarPago).not.toHaveBeenCalled();
    });

    it('al volver del pago confirma sin esperar el webhook', async () => {
      prisma.cobroEmpresa.findFirst.mockResolvedValueOnce(cobro()).mockResolvedValueOnce(cobro({ estado: 'APLICADO' }));
      const r = await svc.verificar(1, 11, '987');
      expect(mp.pagosPlataforma).toHaveBeenCalledWith(`${PREFIJO_COBRO_API}11`, '987');
      expect(cobros.registrarPago).toHaveBeenCalled();
      expect(r.status).toBe('paid');
    });
  });

  describe('el link de pago', () => {
    it('sale para un cobro propio y pendiente', async () => {
      const r = await svc.linkDePago(1, 11);
      expect(r.url).toBe('https://mp/pagar');
      expect(prisma.cobroEmpresa.findFirst).toHaveBeenCalledWith({ where: { id: 11, empresaId: 1, concepto: 'API_FACTURACION' } });
      expect(mp.crearCobroPlataforma).toHaveBeenCalledWith(
        expect.objectContaining({ referencia: `${PREFIJO_COBRO_API}11`, total: 5.9, clienteEmail: 'pagos@misoft.pe' }),
      );
    });

    it('no sale para el cobro de otro ni para uno pagado', async () => {
      prisma.cobroEmpresa.findFirst.mockResolvedValueOnce(null);
      await expect(svc.linkDePago(2, 11)).rejects.toMatchObject({ status: 404 });
      prisma.cobroEmpresa.findFirst.mockResolvedValueOnce(cobro({ estado: 'APLICADO' }));
      await expect(svc.linkDePago(1, 11)).rejects.toMatchObject({ status: 409 });
    });

    it('sin datos de facturación no deja pagar', async () => {
      prisma.empresa.findUnique.mockResolvedValue({ datosFacturacion: null });
      await expect(svc.linkDePago(1, 11)).rejects.toThrow(/datos de facturación/);
      expect(mp.crearCobroPlataforma).not.toHaveBeenCalled();
    });
  });

  describe('la factura del pago', () => {
    beforeEach(() => prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro({ estado: 'APLICADO' })));

    it('factura al RUC con el subtotal congelado, como Krezka', async () => {
      const n = await svc.facturarPago(11);
      expect(n).toBe('F001-00000007');
      const [emisor, entrada] = facturacion.emitirComoPlataforma.mock.calls[0];
      expect(emisor).toBe(22);
      expect(entrada.document_type).toBe('invoice');
      expect(entrada.customer).toMatchObject({ document_type: 'ruc', document_number: '20601234567', name: 'MI SOFTWARE SAC', address: 'AV. LIMA 123' });
      expect(entrada.items[0]).toMatchObject({ quantity: 1, unit_value: 5 });
      expect(entrada.items[0].description).toContain('2026-10 (30 comprobantes)');
      expect(prisma.cobroEmpresa.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { comprobanteId: 500 } });
    });

    it('a un DNI le emite boleta', async () => {
      prisma.empresa.findUnique.mockResolvedValue({ datosFacturacion: { tipo: 'dni', numero: '47065472', nombre: 'DIEGO' } });
      await svc.facturarPago(11);
      expect(facturacion.emitirComoPlataforma.mock.calls[0][1].document_type).toBe('receipt');
    });

    it('no factura dos veces', async () => {
      prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro({ estado: 'APLICADO', comprobanteId: 500 }));
      expect(await svc.facturarPago(11)).toBeNull();
      expect(facturacion.emitirComoPlataforma).not.toHaveBeenCalled();
    });

    it('sin la empresa emisora configurada no emite a ciegas', async () => {
      delete process.env.PLATAFORMA_FACTURA_EMPRESA_ID;
      expect(await svc.facturarPago(11)).toBeNull();
      expect(facturacion.emitirComoPlataforma).not.toHaveBeenCalled();
    });

    it('un cobro pendiente no se factura', async () => {
      prisma.cobroEmpresa.findUnique.mockResolvedValue(cobro());
      expect(await svc.facturarPago(11)).toBeNull();
      expect(facturacion.emitirComoPlataforma).not.toHaveBeenCalled();
    });
  });

  describe('los recordatorios', () => {
    it('3 días antes de vencer sale el recordatorio, una vez', async () => {
      const r = await svc.recordatorios(new Date('2026-11-15T14:00:00Z'));
      expect(r).toEqual({ previos: 1, bloqueos: 0 });
      expect(prisma.cobroEmpresa.updateMany).toHaveBeenCalledWith({ where: { id: 11, avisoPrevioEn: null }, data: { avisoPrevioEn: expect.any(Date) } });
    });

    it('si otro backend ya tomó la marca, no lo manda', async () => {
      prisma.cobroEmpresa.updateMany.mockResolvedValue({ count: 0 });
      const r = await svc.recordatorios(new Date('2026-11-15T14:00:00Z'));
      expect(r).toEqual({ previos: 0, bloqueos: 0 });
    });

    it('con mucho margen todavía no avisa', async () => {
      const r = await svc.recordatorios(new Date('2026-11-05T14:00:00Z'));
      expect(r).toEqual({ previos: 0, bloqueos: 0 });
    });

    it('el día siguiente al vencimiento avisa que la emisión se pausó', async () => {
      const r = await svc.recordatorios(new Date('2026-11-18T14:00:00Z'));
      expect(r).toEqual({ previos: 0, bloqueos: 1 });
      expect(prisma.cobroEmpresa.updateMany).toHaveBeenCalledWith({ where: { id: 11, avisoBloqueoEn: null }, data: { avisoBloqueoEn: expect.any(Date) } });
    });

    it('se apaga por entorno', async () => {
      process.env.COBROS_API_AVISOS_ENABLED = 'false';
      expect(await svc.recordatorios(new Date('2026-11-18T14:00:00Z'))).toEqual({ previos: 0, bloqueos: 0 });
      expect(prisma.cobroEmpresa.findMany).not.toHaveBeenCalled();
    });
  });

  it('la lista dice si está vencido, si se puede pagar en línea y si faltan datos', async () => {
    const r = await svc.listar(1);
    expect(r.online_payment).toBe(true);
    expect(r.billing_details_complete).toBe(true);
    expect(r.data[0]).toMatchObject({ id: 11, period: '2026-10', amount: 5.9, status: 'pending' });
  });

  it('los datos de facturación incompletos no valen', () => {
    expect(CobrosApiService.datosValidos({ tipo: 'ruc', numero: '123', nombre: 'X' })).toBeNull();
    expect(CobrosApiService.datosValidos({ tipo: 'dni', numero: '47065472', nombre: '' })).toBeNull();
    expect(CobrosApiService.datosValidos(DATOS)).not.toBeNull();
  });
});
