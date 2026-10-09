/**
 * C1, C2 y C3 — del chat al pedido registrado.
 *
 * Aquí se decide dinero, así que lo que importa no es que funcione el camino
 * feliz: es que NO registre un pedido a medias, que no cobre mal el envío y
 * que no registre dos veces si el cliente insiste.
 */
import { LeadsPedidoService } from './leads-pedido.service';

const EMPRESA = 89;
const CONV = 42;
const TELEFONO = '51987654321';

type Borrador = Record<string, unknown> | null;

function armar(opts: { borrador?: Borrador; config?: unknown } = {}) {
  let borrador: Borrador = opts.borrador === undefined ? null : opts.borrador;

  const prisma: any = {
    empresa: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ iaVentasConfigJson: opts.config ?? null }),
    },
    leadPedidoBorrador: {
      findUnique: jest.fn(() => Promise.resolve(borrador)),
      upsert: jest.fn(({ create, update }: any) => {
        borrador = { ...(borrador ?? {}), ...(borrador ? update : create) };
        // Prisma devuelve null en las columnas que nunca se escribieron.
        for (const c of [
          'zona',
          'tipoZona',
          'lugar',
          'nombre',
          'dni',
          'celular',
          'direccion',
          'referencia',
          'horario',
          'agenciaSede',
          'costoEnvio',
          'comprobanteId',
          'itemsJson',
        ]) {
          if (!(c in (borrador as object))) (borrador as any)[c] = null;
        }
        return Promise.resolve(borrador);
      }),
      update: jest.fn(({ data }: any) => {
        borrador = { ...(borrador ?? {}), ...data };
        return Promise.resolve(borrador);
      }),
    },
    producto: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, descripcion: 'Moringa 100 cápsulas', precioUnitario: 31 },
        { id: 2, descripcion: 'Berberina 90 cápsulas', precioUnitario: 60 },
      ]),
    },
  };
  const comprobante: any = {
    crearInformal: jest
      .fn()
      .mockResolvedValue({ id: 500, serie: 'NV01', correlativo: 7 }),
  };
  const despacho: any = { create: jest.fn().mockResolvedValue({}) };
  const notificaciones: any = {
    notificarAdminsEmpresa: jest.fn().mockResolvedValue({}),
  };

  const service = new LeadsPedidoService(
    prisma,
    comprobante,
    despacho,
    notificaciones,
  );
  return {
    service,
    prisma,
    comprobante,
    despacho,
    notificaciones,
    verBorrador: () => borrador,
  };
}

/** Un borrador de Lima al que solo le falta lo que se indique. */
const limaCompleto = (falta: string[] = []) => {
  const b: Record<string, unknown> = {
    tipoZona: 'DOMICILIO',
    zona: 'Lima',
    lugar: 'Miraflores',
    costoEnvio: 15,
    nombre: 'Juan Pérez',
    direccion: 'Av. Siempre Viva 123',
    referencia: 'frente al parque',
    horario: 'mañana de 3 a 4',
    celular: '987654321',
    dni: null,
    agenciaSede: null,
    itemsJson: [{ productoId: 1, cantidad: 2 }],
    comprobanteId: null,
  };
  for (const campo of falta) b[campo] = null;
  return b;
};

describe('guardarDatos: ir acumulando y decir qué falta', () => {
  it('resuelve el destino y devuelve tarifa y forma de pago', async () => {
    const { service } = armar();
    const r = await service.guardarDatos(EMPRESA, CONV, {
      destino: 'vivo en Miraflores',
    });
    expect(r.zona).toBe('Lima');
    expect(r.costoEnvio).toBe(15);
    expect(r.formaPago).toContain('contraentrega');
  });

  it('a provincia cobra S/ 10 y avisa del 50%', async () => {
    const { service } = armar();
    const r = await service.guardarDatos(EMPRESA, CONV, { destino: 'Cusco' });
    expect(r.zona).toBe('Provincia');
    expect(r.costoEnvio).toBe(10);
    expect(r.formaPago).toContain('50%');
  });

  it('pide aclarar en vez de adivinar cuando el destino es ambiguo', async () => {
    const { service } = armar({
      config: {
        envio: {
          zonaPorDefecto: 'Provincia',
          zonas: [
            {
              nombre: 'Lima',
              tipo: 'DOMICILIO',
              tarifa: 15,
              lugares: [{ nombre: 'San Juan' }],
            },
            {
              nombre: 'Norte',
              tipo: 'AGENCIA',
              tarifa: 10,
              lugares: [{ nombre: 'San Juan' }],
            },
            { nombre: 'Provincia', tipo: 'AGENCIA', tarifa: 10 },
          ],
        },
      },
    });
    const r = await service.guardarDatos(EMPRESA, CONV, {
      destino: 'San Juan',
    });
    expect(r.aclarar).toContain('más de una zona');
    expect(r.zona).toBeUndefined();
  });

  it('lo primero que pide es el destino: sin él no sabe qué más pedir', async () => {
    const { service } = armar();
    const r = await service.guardarDatos(EMPRESA, CONV, { nombre: 'Juan' });
    expect(r.faltan).toEqual(['el distrito o ciudad de entrega']);
  });

  it('a domicilio pide dirección; a agencia pide DNI y sede', async () => {
    const lima = armar();
    const rLima = await lima.service.guardarDatos(EMPRESA, CONV, {
      destino: 'Surco',
    });
    expect(rLima.faltan).toContain('dirección con calle y número');
    expect(rLima.faltan).not.toContain('DNI');

    const prov = armar();
    const rProv = await prov.service.guardarDatos(EMPRESA, CONV, {
      destino: 'Trujillo',
    });
    expect(rProv.faltan).toContain('DNI');
    expect(rProv.faltan).toContain('la sede de la agencia donde recogerá');
    expect(rProv.faltan).not.toContain('dirección con calle y número');
  });

  it('no guarda un celular inválido y dice por qué', async () => {
    const { service, verBorrador } = armar();
    const r = await service.guardarDatos(EMPRESA, CONV, {
      destino: 'Lince',
      celular: '12345',
    });
    expect(r.problemas?.[0]).toContain('9 dígitos');
    expect((verBorrador() as any).celular).toBeNull();
  });

  it('acepta el celular con +51, que la gente sí escribe', async () => {
    const { service, verBorrador } = armar();
    await service.guardarDatos(EMPRESA, CONV, {
      destino: 'Lince',
      celular: '+51 987 654 321',
    });
    expect((verBorrador() as any).celular).toBe('987654321');
  });

  it('deja de pedir lo que ya tiene', async () => {
    const { service } = armar();
    await service.guardarDatos(EMPRESA, CONV, { destino: 'Lince' });
    const r = await service.guardarDatos(EMPRESA, CONV, {
      nombre: 'Juan Pérez',
      direccion: 'Av. Siempre Viva 123',
    });
    expect(r.faltan).not.toContain('nombre completo');
    expect(r.faltan).not.toContain('dirección con calle y número');
  });
});

describe('cotizar', () => {
  it('se niega a cotizar sin saber a dónde va', async () => {
    const { service } = armar({ borrador: null });
    const r = await service.cotizar(EMPRESA, CONV, [
      { productoId: 1, cantidad: 2 },
    ]);
    expect(r.falta).toContain('distrito o ciudad');
    expect(r.texto).toBeUndefined();
  });

  it('arma el texto con el formato exacto del negocio', async () => {
    const { service } = armar({ borrador: limaCompleto() });
    const r = await service.cotizar(
      EMPRESA,
      CONV,
      [
        { productoId: 1, cantidad: 2 },
        { productoId: 2, cantidad: 1 },
      ],
      'Pack Detox',
    );
    // 2×31 + 1×60 = 122, + 15 de envío = 137. Tres unidades sobre S/ 20 y
    // total > 90 → S/ 10 de descuento.
    expect(r.texto).toContain('Cotización 📋 *Pack Detox*');
    expect(r.texto).toContain('2x Moringa 100 cápsulas - P.U. S/ 31.00');
    expect(r.texto).toContain('Guía de consumo de REGALO 🎁');
    expect(r.texto).toContain('Envío Lima: S/ 15.00');
    expect(r.texto).toContain('*TOTAL: S/ 137.00*');
    expect(r.texto).toContain('Descuento: S/ 10.00');
    expect(r.texto).toContain('*MONTO A PAGAR: S/ 127.00*');
    expect(r.texto).toContain('¿Deseas que agendemos tu entrega?');
  });

  it('sin descuento no imprime la línea: lo pide su documento', async () => {
    const { service } = armar({ borrador: limaCompleto() });
    const r = await service.cotizar(EMPRESA, CONV, [
      { productoId: 1, cantidad: 1 },
    ]);
    expect(r.texto).not.toContain('Descuento');
    expect(r.texto).not.toContain('MONTO A PAGAR');
  });

  it('el precio sale del catálogo, no de lo que diga el modelo', async () => {
    const { service, prisma } = armar({ borrador: limaCompleto() });
    prisma.producto.findMany.mockResolvedValue([
      { id: 1, descripcion: 'Moringa', precioUnitario: 99 },
    ]);
    const r = await service.cotizar(EMPRESA, CONV, [
      { productoId: 1, cantidad: 1 },
    ]);
    expect(r.texto).toContain('S/ 99.00');
  });

  it('ignora productos que no son de este negocio', async () => {
    const { service, prisma } = armar({ borrador: limaCompleto() });
    prisma.producto.findMany.mockResolvedValue([]);
    const r = await service.cotizar(EMPRESA, CONV, [
      { productoId: 999, cantidad: 1 },
    ]);
    expect(r.error).toContain('es de este negocio');
  });
});

describe('registrarPedido', () => {
  it('se niega si falta un dato, y dice cuál', async () => {
    const { service, comprobante } = armar({
      borrador: limaCompleto(['celular']),
    });
    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(r.falta).toContain('celular de contacto');
    expect(r.registrado).toBeUndefined();
    // Y sobre todo: no creó nada.
    expect(comprobante.crearInformal).not.toHaveBeenCalled();
  });

  it('se niega si no hay productos confirmados', async () => {
    const b = limaCompleto();
    b.itemsJson = [];
    const { service, comprobante } = armar({ borrador: b });
    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(r.error).toContain('Cotiza primero');
    expect(comprobante.crearInformal).not.toHaveBeenCalled();
  });

  it('registra la nota de venta y el despacho con los datos del cliente', async () => {
    const { service, comprobante, despacho } = armar({
      borrador: limaCompleto(),
    });
    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);

    expect(r.registrado).toBe(true);
    expect(r.pedido).toBe('NV01-00000007');
    // 2×31 = 62 + 15 = 77, sin descuento (2 unidades).
    expect(r.montoAPagar).toBe(77);
    expect(comprobante.crearInformal.mock.calls[0][0].tipoDoc).toBe('NV');

    const dto = despacho.create.mock.calls[0][2];
    expect(dto.tipoEnvio).toBe('DOMICILIO');
    expect(dto.nombreDestinatario).toBe('Juan Pérez');
    expect(dto.celularDest).toBe('987654321');
    expect(dto.direccionDestino).toBe('Av. Siempre Viva 123');
    expect(dto.costoEnvio).toBe(15);
    // En Lima se cobra todo al entregar.
    expect(dto.montoCOD).toBe(77);
  });

  it('en provincia cobra la mitad por adelantado', async () => {
    const b = limaCompleto();
    b.tipoZona = 'AGENCIA';
    b.zona = 'Provincia';
    b.costoEnvio = 10;
    b.dni = '45678912';
    b.agenciaSede = 'Shalom Cusco Centro';
    const { service, despacho } = armar({ borrador: b });

    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);

    // 2×31 = 62 + 10 = 72.
    expect(r.montoAPagar).toBe(72);
    expect(r.adelanto).toBe(36);
    // Lo que queda por cobrar al recoger.
    expect(despacho.create.mock.calls[0][2].montoCOD).toBe(36);
  });

  it('no registra dos veces por más que el cliente insista', async () => {
    const b = limaCompleto();
    b.comprobanteId = 500;
    const { service, comprobante } = armar({ borrador: b });

    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);

    expect(r.registrado).toBe(true);
    expect(r.error).toContain('ya estaba registrado');
    expect(comprobante.crearInformal).not.toHaveBeenCalled();
  });

  it('si falla el despacho, el pedido NO se pierde', async () => {
    // Perder una venta ya tomada es peor que un despacho a medias: queda el
    // aviso para completarlo a mano.
    const { service, despacho } = armar({ borrador: limaCompleto() });
    despacho.create.mockRejectedValue(new Error('courier caído'));

    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);

    expect(r.registrado).toBe(true);
    expect(r.pedido).toBe('NV01-00000007');
  });

  it('avisa al equipo con todo lo que necesita para despachar', async () => {
    const { service, notificaciones } = armar({ borrador: limaCompleto() });
    await service.registrarPedido(EMPRESA, CONV, TELEFONO);

    const aviso = notificaciones.notificarAdminsEmpresa.mock.calls[0][0];
    expect(aviso.titulo).toContain('NV01-00000007');
    expect(aviso.mensaje).toContain('Juan Pérez');
    expect(aviso.mensaje).toContain('Av. Siempre Viva 123');
    expect(aviso.mensaje).toContain('mañana de 3 a 4');
  });
});

describe('la configuración manda sobre los valores por defecto', () => {
  it('otra empresa cobra otras tarifas por los mismos distritos', async () => {
    const { service } = armar({
      config: {
        envio: {
          zonaPorDefecto: 'Resto',
          zonas: [
            {
              nombre: 'Centro',
              tipo: 'DOMICILIO',
              tarifa: 5,
              lugares: [{ nombre: 'Miraflores' }],
              notaPago: 'pago al recibir',
            },
            { nombre: 'Resto', tipo: 'AGENCIA', tarifa: 20 },
          ],
        },
      },
    });
    const r = await service.guardarDatos(EMPRESA, CONV, {
      destino: 'Miraflores',
    });
    expect(r.zona).toBe('Centro');
    expect(r.costoEnvio).toBe(5);
  });
});

describe('no ensuciar el panel con cotizaciones duplicadas', () => {
  // El modelo vuelve a cotizar cuando el cliente confirma. Antes eso creaba
  // una COT nueva cada vez: dos documentos para la misma venta.
  it('no emite otra COT si el cliente lleva lo mismo', async () => {
    const { service, comprobante, verBorrador } = armar({
      borrador: { ...limaCompleto(), itemsJson: null, cotizacionId: null },
    });
    const items = [{ productoId: 1, cantidad: 2 }];

    await service.cotizar(EMPRESA, CONV, items);
    expect(comprobante.crearInformal).toHaveBeenCalledTimes(1);
    expect((verBorrador() as any).cotizacionId).toBe(500);

    await service.cotizar(EMPRESA, CONV, items);
    expect(comprobante.crearInformal).toHaveBeenCalledTimes(1);
  });

  it('tampoco si cambió lo que lleva: una COT por conversación', async () => {
    // El QA del flujo completo midió cuatro llamadas a cotizar en una sola
    // venta. Un documento por cada una deja al vendedor sin saber cuál mirar.
    // Lo que se lleva de verdad queda en la nota de venta.
    const { service, comprobante, verBorrador } = armar({
      borrador: { ...limaCompleto(), itemsJson: null, cotizacionId: null },
    });

    await service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 2 }]);
    await service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 5 }]);
    await service.cotizar(EMPRESA, CONV, [{ productoId: 2, cantidad: 1 }]);

    expect(comprobante.crearInformal).toHaveBeenCalledTimes(1);
    // Pero el borrador sí refleja lo último que pidió.
    expect((verBorrador() as any).itemsJson).toEqual([
      { productoId: 2, cantidad: 1 },
    ]);
  });
});
