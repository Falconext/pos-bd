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
    createOrder: jest.fn().mockResolvedValue({
      data: { orderNumber: '66479331', orderCode: '3KTH' },
    }),
    crearInstancia: jest.fn().mockResolvedValue({ instanceId: 'inst-1' }),
    loginInstancia: jest.fn().mockResolvedValue({ ok: true }),
    pendingShipments: jest.fn().mockResolvedValue({ data: [] }),
    eliminarInstancia: jest.fn().mockResolvedValue({ success: true }),
    consultarDni: jest.fn().mockResolvedValue({
      data: { nombres: 'JOSE CARLOS', apellidoPaterno: 'MENDOZA', apellidoMaterno: 'BUSTAMANTE' },
    }),
    ticketImage: jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('png'), contentType: 'image/png' }),
    label: jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('pdf'), contentType: 'application/pdf' }),
  });
  const makePrisma = () => ({
    empresa: { findUnique: jest.fn(), update: jest.fn() },
    envioDespacho: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  });

  // Agencia tal como la devuelve el proveedor ya normalizada por ShalomLatService.
  const agencia = (terId: string, nombre: string) => ({
    terId,
    nombre,
    departamento: 'CUSCO',
    provincia: 'CUSCO',
    distrito: 'WANCHAQ',
    estado: 'ACTIVO',
    aereo: false,
    label: `${nombre} - CUSCO - CUSCO`,
  });

  const empresaCorporativa = (extra: Record<string, unknown> = {}) => ({
    id: 100,
    nombreComercial: 'Tienda Demo',
    razonSocial: 'Tienda Demo SAC',
    shalomEmail: 'demo@tienda.com',
    shalomPassword: 'secreta',
    shalomInstanceId: 'inst-1',
    shalomInstanceNombre: 'Tienda Demo',
    shalomInstanceEstado: 'CONECTADA',
    shalomInstanceError: null,
    shalomInstanceSyncAt: new Date(),
    shalomSecurityCode: null,
    shalomAgenciaOrigenId: '7',
    shalomAgenciaOrigenNombre: 'Lima Centro - LIMA - LIMA',
    // El gate ya no mira el NOMBRE del plan sino sus características
    // (Sistema → Planes), así que el fixture trae la fila de PlanFeature.
    plan: {
      nombre: 'CORPORATIVO',
      features: [{ featureKey: 'tieneShalomGuias', enabled: true }],
    },
    ...extra,
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

  // ─── Cuenta Shalom Pro (crear guías) ──────────────────────────────────────

  it('sin empresa (ADMIN_SISTEMA) la sección Shalom Pro no aplica', async () => {
    const { svc, prisma } = build();
    const r = await svc.getInstancia(undefined);
    expect(r.habilitadoPorPlan).toBe(false);
    expect(prisma.empresa.findUnique).not.toHaveBeenCalled();
  });

  it('un plan sin la característica tieneShalomGuias no puede conectar la cuenta Shalom Pro', async () => {
    const { svc, prisma, lat } = build();
    prisma.empresa.findUnique.mockResolvedValue(
      empresaCorporativa({
        plan: {
          nombre: 'NEGOCIO_MENSUAL',
          features: [{ featureKey: 'tieneShalomGuias', enabled: false }],
        },
      }),
    );
    await expect(svc.conectarInstancia(100, {})).rejects.toThrow(
      /no incluye la creación de guías/,
    );
    expect(lat.crearInstancia).not.toHaveBeenCalled();
  });

  it('crea la guía resolviendo la agencia destino por nombre y guarda N° de orden', async () => {
    const { svc, prisma, lat } = build();
    lat.getAgencias.mockResolvedValue({
      success: true,
      data: [agencia('7', 'Lima Centro'), agencia('582', 'Cusco Centro')],
      total: 2,
    });
    prisma.empresa.findUnique.mockResolvedValue(empresaCorporativa());
    prisma.envioDespacho.findFirst.mockResolvedValue({
      id: 55,
      nroOrden: null,
      claveOrden: null,
      agenciaDestino: 'Cusco Centro - CUSCO - CUSCO',
      shalomAgenciaDestinoId: null,
      celularDest: '999888777',
      direccionDestino: null,
      nombreDestinatario: 'María Quispe',
      dniDestinatario: '44273815',
      contenidoPaquete: '1 Caja',
      nroPaquetes: 1,
      montoCOD: null,
      comprobante: { id: 9, serie: 'B001', correlativo: 12, cliente: null, detalles: [] },
    });
    prisma.envioDespacho.update.mockResolvedValue({
      id: 55,
      nroOrden: '66479331',
      claveOrden: '3KTH',
      claveEnvio: null,
      shalomGuiaCreadaEn: new Date(),
    });

    const r = await svc.crearGuiaDesdeDespacho(9, 100);

    expect(lat.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: 'inst-1',
        origen: 7,
        destino: 582,
        documento: '44273815',
        name: 'JOSE CARLOS',
        phone: 999888777,
      }),
    );
    expect(prisma.envioDespacho.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nroOrden: '66479331', claveOrden: '3KTH' }),
      }),
    );
    expect(r.nroOrden).toBe('66479331');
  });

  it('sin agencia de origen configurada no se genera la guía', async () => {
    const { svc, prisma, lat } = build();
    lat.getAgencias.mockResolvedValue({ success: true, data: [agencia('582', 'Cusco Centro')] });
    prisma.empresa.findUnique.mockResolvedValue(
      empresaCorporativa({ shalomAgenciaOrigenId: null, shalomAgenciaOrigenNombre: null }),
    );
    prisma.envioDespacho.findFirst.mockResolvedValue({
      id: 55,
      agenciaDestino: 'Cusco Centro - CUSCO - CUSCO',
      comprobante: { detalles: [] },
    });
    await expect(svc.crearGuiaDesdeDespacho(9, 100)).rejects.toThrow(/agencia Shalom de origen/);
    expect(lat.createOrder).not.toHaveBeenCalled();
  });

  it('no regenera la guía de un despacho que ya la tiene (salvo forzar)', async () => {
    const { svc, prisma, lat } = build();
    prisma.empresa.findUnique.mockResolvedValue(empresaCorporativa());
    prisma.envioDespacho.findFirst.mockResolvedValue({
      id: 55,
      nroOrden: '66479331',
      claveOrden: '3KTH',
      comprobante: { detalles: [] },
    });
    await expect(svc.crearGuiaDesdeDespacho(9, 100)).rejects.toThrow(/ya tiene la guía/);
    expect(lat.createOrder).not.toHaveBeenCalled();
  });

  it('desconectar elimina la instancia en el proveedor para liberar el cupo', async () => {
    const { svc, prisma, lat } = build();
    prisma.empresa.findUnique.mockResolvedValue(empresaCorporativa());
    prisma.empresa.update.mockResolvedValue({});
    await svc.desconectarInstancia(100);
    expect(lat.eliminarInstancia).toHaveBeenCalledWith('inst-1');
  });

  it('si el proveedor falla al eliminar, la desconexión local igual ocurre', async () => {
    const { svc, prisma, lat } = build();
    prisma.empresa.findUnique.mockResolvedValue(empresaCorporativa());
    prisma.empresa.update.mockResolvedValue({});
    lat.eliminarInstancia.mockRejectedValue(new Error('proveedor caído'));
    await expect(svc.desconectarInstancia(100)).resolves.toBeDefined();
    expect(prisma.empresa.update).toHaveBeenCalled();
  });

  it('cae al cliente del comprobante cuando el despacho guardó cadenas vacías', async () => {
    const { svc, prisma, lat } = build();
    lat.getAgencias.mockResolvedValue({
      success: true,
      data: [agencia('7', 'Lima Centro'), agencia('582', 'Cusco Centro')],
    });
    prisma.empresa.findUnique.mockResolvedValue(empresaCorporativa());
    prisma.envioDespacho.findFirst.mockResolvedValue({
      id: 55,
      agenciaDestino: 'Cusco Centro - CUSCO - CUSCO',
      // El modal de coordinación guarda '' (no null) cuando no se llenan.
      nombreDestinatario: '',
      dniDestinatario: '',
      celularDest: '',
      contenidoPaquete: '',
      nroPaquetes: 1,
      comprobante: {
        cliente: {
          nombre: 'ROJAS MALLQUI, ELSON ALFREDO',
          nroDoc: '48455339',
          telefono: '999888777',
          direccion: 'Av. Siempre Viva 123',
        },
        detalles: [{ descripcion: 'Zapatillas', cantidad: 2 }],
      },
    });
    prisma.envioDespacho.update.mockResolvedValue({ id: 55, nroOrden: '1', claveOrden: 'A' });

    await svc.crearGuiaDesdeDespacho(9, 100);

    expect(lat.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        documento: '48455339',
        name: 'JOSE CARLOS',
        firstname: 'MENDOZA',
        lastname: 'BUSTAMANTE',
        phone: 999888777,
      }),
    );
  });

  it('un 200 con success:false NO se guarda como guía creada', async () => {
    const { svc, prisma, lat } = build();
    lat.getAgencias.mockResolvedValue({
      success: true,
      data: [agencia('7', 'Lima Centro'), agencia('582', 'Cusco Centro')],
    });
    // Shalom responde HTTP 200 pero rechaza el registro.
    lat.createOrder.mockResolvedValue({ success: false, message: 'Seleccione un producto' });
    prisma.empresa.findUnique.mockResolvedValue(empresaCorporativa());
    prisma.envioDespacho.findFirst.mockResolvedValue({
      id: 55,
      agenciaDestino: 'Cusco Centro - CUSCO - CUSCO',
      nombreDestinatario: 'María Quispe',
      dniDestinatario: '44273815',
      celularDest: '999888777',
      nroPaquetes: 1,
      comprobante: { cliente: null, detalles: [] },
    });

    await expect(svc.crearGuiaDesdeDespacho(9, 100)).rejects.toThrow(/Seleccione un producto/);
    // Lo crítico: no debe quedar marcado como generado.
    expect(prisma.envioDespacho.update).not.toHaveBeenCalled();
  });
});
