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
    catalogoProductos: jest.fn().mockResolvedValue({}),
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
    envioDespacho: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      // Historial de claves de retiro (estadoClavesRetiro): sin guías recientes.
      findMany: jest.fn().mockResolvedValue([]),
    },
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
    const { svc, prisma, lat } = build();
    prisma.empresa.findUnique.mockResolvedValue({ shalomInstanceId: 'inst-1' });
    const r = await svc.label('66479331', '3KTH', 400);
    expect(lat.label).toHaveBeenCalledWith('66479331', '3KTH', 'inst-1');
    expect(r.contentType).toBe('application/pdf');
  });

  it('etiqueta: sin cuenta Shalom Pro conectada, rechaza antes de pedirla al proveedor', async () => {
    const { svc, prisma, lat } = build();
    prisma.empresa.findUnique.mockResolvedValue({ shalomInstanceId: null });
    await expect(svc.label('66479331', '3KTH', 400)).rejects.toThrow(
      /Conecta tu cuenta Shalom Pro/,
    );
    expect(lat.label).not.toHaveBeenCalled();
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

  describe('claves de retiro', () => {
    const guia = (clave: string, diasAtras: number) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - diasAtras);
      return { claveEnvio: clave, shalomGuiaCreadaEn: d };
    };

    it('repite la clave del día si hoy ya se generó una guía', async () => {
      const { svc, prisma } = build();
      prisma.empresa.findUnique.mockResolvedValue({ shalomClavesRetiro: '1010,1011' });
      prisma.envioDespacho.findMany.mockResolvedValue([guia('7777', 0), guia('1010', 1)]);
      const r = await svc.claveSugerida(1);
      expect(r).toMatchObject({ clave: '7777', origen: 'HOY', usadasAyer: ['1010'], claveHoy: '7777' });
    });

    it('primera guía del día: toma la configurada que no se usó ayer', async () => {
      const { svc, prisma } = build();
      prisma.empresa.findUnique.mockResolvedValue({ shalomClavesRetiro: '1010, 1011' });
      prisma.envioDespacho.findMany.mockResolvedValue([guia('1010', 1)]);
      const r = await svc.claveSugerida(1);
      expect(r).toMatchObject({ clave: '1011', origen: 'CONFIGURADA', configuradas: ['1010', '1011'] });
    });

    it('sin claves configuradas ni guías de hoy: aleatoria de 4 dígitos distinta a la de ayer', async () => {
      const { svc, prisma } = build();
      prisma.empresa.findUnique.mockResolvedValue({ shalomClavesRetiro: null });
      prisma.envioDespacho.findMany.mockResolvedValue([guia('4321', 1)]);
      const r = await svc.claveSugerida(1);
      expect(r.origen).toBe('ALEATORIA');
      expect(r.clave).toMatch(/^\d{4}$/);
      expect(r.clave).not.toBe('4321');
    });

    it('la clave escrita por el usuario se respeta, salvo que sea la de ayer', async () => {
      const { svc, prisma } = build();
      prisma.empresa.findUnique.mockResolvedValue({ shalomClavesRetiro: '1010,1011' });
      prisma.envioDespacho.findMany.mockResolvedValue([guia('1010', 1)]);
      await expect((svc as any).generarClaveRetiro(1, '2024')).resolves.toBe('2024');
      await expect((svc as any).generarClaveRetiro(1, '1010')).rejects.toThrow(/fue la de ayer.*1011/);
      await expect((svc as any).generarClaveRetiro(1, '12')).rejects.toThrow(/4 dígitos/);
    });

    it('si Shalom rechaza la clave, reintenta una vez con una aleatoria y guarda esa', async () => {
      const { svc, prisma, lat } = build();
      lat.getAgencias.mockResolvedValue({ success: true, data: [agencia('7', 'Lima Centro'), agencia('582', 'Cusco Centro')], total: 2 });
      prisma.empresa.findUnique.mockResolvedValue({ ...empresaCorporativa(), shalomClavesRetiro: '1010' });
      prisma.envioDespacho.findFirst.mockResolvedValue({
        id: 55, nroOrden: null, claveOrden: null, claveEnvio: '', agenciaDestino: 'Cusco Centro', shalomAgenciaDestinoId: '582',
        celularDest: '987654321', nroPaquetes: 1, dniDestinatario: '', nombreDestinatario: '',
        comprobante: { id: 9, serie: 'NV01', correlativo: 1, cliente: { nombre: 'JUAN PEREZ', nroDoc: '12345678', telefono: '987654321', direccion: '' }, detalles: [] },
      });
      prisma.envioDespacho.update.mockResolvedValue({ id: 55, nroOrden: '77', claveOrden: 'ABCD' });
      lat.createOrder
        .mockResolvedValueOnce({ success: false, message: 'No puede usar la clave del día anterior' })
        .mockResolvedValueOnce({ success: true, data: { orderNumber: '77', orderCode: 'ABCD' } });
      const r = await svc.crearGuiaDesdeDespacho(9, 1, {});
      expect(lat.createOrder).toHaveBeenCalledTimes(2);
      expect(lat.createOrder.mock.calls[0][0].clave).toBe('1010');
      const segunda = lat.createOrder.mock.calls[1][0].clave;
      expect(segunda).toMatch(/^\d{4}$/);
      expect(segunda).not.toBe('1010');
      expect(prisma.envioDespacho.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ claveEnvio: segunda }) }));
      expect(r.nroOrden).toBe('77');
    });
  });

  describe('tamaño del paquete y flete', () => {
    const quoteLimaArequipa = { success: true, data: { tariff: { sobre: 8, cajapaquetexxs: 8, cajapaquetexs: 10, cajapaquetes: 12, cajapaquetem: 20, cajapaquetel: 28 }, lead_time: '96 horas' } };
    const despachoBase = (extra: any = {}) => ({
      id: 55, nroOrden: null, claveOrden: null, claveEnvio: '', agenciaDestino: 'Cusco Centro', shalomAgenciaDestinoId: '582',
      celularDest: '987654321', nroPaquetes: 1, dniDestinatario: '', nombreDestinatario: '',
      comprobante: { id: 9, serie: 'NV01', correlativo: 1, cliente: { nombre: 'JUAN PEREZ', nroDoc: '12345678', telefono: '987654321', direccion: '' }, detalles: [] },
      ...extra,
    });

    it('productos(): lista fija universal, marca el tamaño por defecto de la empresa', async () => {
      const { svc, prisma } = build();
      prisma.empresa.findUnique.mockResolvedValue({ shalomTamanoDefault: 'XXS' });
      const r = await svc.productos(1);
      expect(r.map((t: any) => t.key)).toEqual(['SOBRE', 'XXS', 'XS', 'S', 'M', 'L']);
      expect(r.find((t: any) => t.porDefecto)?.key).toBe('XXS');
      expect(r.find((t: any) => t.key === 'XS')?.content).toBe('PAQUETE XS');
    });

    it('tarifaPorTamano(): precio por tamaño desde /account/quote de la ruta', async () => {
      const { svc, prisma, lat } = build();
      prisma.empresa.findUnique.mockResolvedValue({ shalomAgenciaOrigenId: '128' });
      lat.quote.mockResolvedValue(quoteLimaArequipa);
      const r = await svc.tarifaPorTamano(1, '7');
      expect(lat.quote).toHaveBeenCalledWith(128, 7);
      expect(r.leadTime).toBe('96 horas');
      expect(r.tamanos.map((t: any) => [t.key, t.precio])).toEqual([['SOBRE', 8], ['XXS', 8], ['XS', 10], ['S', 12], ['M', 20], ['L', 28]]);
    });

    it('crear guía con tamaño fijo XXS manda content "PAQUETE XXS" sin tocar el catálogo y guarda el flete', async () => {
      const { svc, prisma, lat } = build();
      lat.getAgencias.mockResolvedValue({ success: true, data: [agencia('7', 'Lima Centro'), agencia('582', 'Cusco Centro')], total: 2 });
      prisma.empresa.findUnique.mockResolvedValue(empresaCorporativa());
      prisma.envioDespacho.findFirst.mockResolvedValue(despachoBase({ shalomTipoProducto: 900002 }));
      prisma.envioDespacho.update.mockResolvedValue({ id: 55, nroOrden: '77', claveOrden: 'ABCD' });
      lat.quote.mockResolvedValue(quoteLimaArequipa);
      lat.createOrder.mockResolvedValue({ success: true, data: { orderNumber: '77', orderCode: 'ABCD' } });
      await svc.crearGuiaDesdeDespacho(9, 1, {});
      expect(lat.catalogoProductos).not.toHaveBeenCalled();
      expect(lat.createOrder.mock.calls[0][0].content).toBe('PAQUETE XXS');
      expect(prisma.envioDespacho.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shalomTamano: 'XXS', shalomFleteCotizado: 8 }) }));
    });

    it('sin tamaño elegido usa el default de la empresa (SOBRE) y, sin default, XS', async () => {
      const { svc, prisma, lat } = build();
      lat.getAgencias.mockResolvedValue({ success: true, data: [agencia('7', 'Lima Centro'), agencia('582', 'Cusco Centro')], total: 2 });
      prisma.envioDespacho.update.mockResolvedValue({ id: 55, nroOrden: '77', claveOrden: 'ABCD' });
      lat.quote.mockResolvedValue(quoteLimaArequipa);
      lat.createOrder.mockResolvedValue({ success: true, data: { orderNumber: '77', orderCode: 'ABCD' } });
      prisma.empresa.findUnique.mockResolvedValue({ ...empresaCorporativa(), shalomTamanoDefault: 'SOBRE' });
      prisma.envioDespacho.findFirst.mockResolvedValue(despachoBase({ shalomTipoProducto: null }));
      await svc.crearGuiaDesdeDespacho(9, 1, {});
      expect(lat.createOrder.mock.calls[0][0].content).toBe('SOBRE');
      prisma.empresa.findUnique.mockResolvedValue({ ...empresaCorporativa(), shalomTamanoDefault: null });
      await svc.crearGuiaDesdeDespacho(9, 1, {});
      expect(lat.createOrder.mock.calls[1][0].content).toBe('PAQUETE XS');
    });
  });
});
