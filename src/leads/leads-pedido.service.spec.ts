/**
 * C1, C2 y C3 — del chat al pedido registrado.
 *
 * Aquí se decide dinero, así que lo que importa no es que funcione el camino
 * feliz: es que NO registre un pedido a medias, que no cobre mal el envío y
 * que no registre dos veces si el cliente insiste.
 */
import { LeadsPedidoService } from './leads-pedido.service';
import { CONFIG_ENVIO_HIERBA_SANA } from './envio-zonas';
import { REGLAS_HIERBA_SANA } from './reglas-descuento';

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
        // Sin config, la empresa NO tiene zonas ni descuentos: eso se prueba
        // aparte. Acá se le da la de Hierba Sana, que es lo que tiene un
        // cliente real una vez configurado.
        .mockResolvedValue({
          iaVentasConfigJson:
            opts.config ??
            ({
              envio: CONFIG_ENVIO_HIERBA_SANA,
              descuento: REGLAS_HIERBA_SANA,
            } as unknown),
        }),
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
    expect(r.texto).toContain('Envío Miraflores: S/ 15.00');
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

  it('sin pago recibido, la agencia cobra el total', async () => {
    // La regla la fijó el negocio el 2026-10-17: el adelanto es lo que el
    // cliente PAGÓ, no el 50% que se le pide. Antes se daba por cobrada la
    // mitad aunque no hubiera llegado un sol, y la agencia cobraba de menos.
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
    expect(r.adelanto).toBeUndefined();
    expect(despacho.create.mock.calls[0][2].montoCOD).toBe(72);
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

  it('las observaciones de la COT son la cotización que leyó el cliente', async () => {
    // Antes decían "Cotización de la IA de Ventas por WhatsApp — Lima." y el
    // vendedor no veía el envío, que no es un ítem de la COT.
    const { service, comprobante } = armar({
      borrador: { ...limaCompleto(), itemsJson: null, cotizacionId: null },
    });
    await service.cotizar(
      EMPRESA,
      CONV,
      [
        { productoId: 1, cantidad: 2 },
        { productoId: 2, cantidad: 1 },
      ],
      'Pack Detox',
    );
    const obs: string = comprobante.crearInformal.mock.calls[0][0].observaciones;
    expect(obs.startsWith('Te adjunto la Cotización 📋 Pack Detox\n2x Moringa 100 cápsulas - P.U. S/ 31.00')).toBe(true);
    expect(obs).toContain('Guía de consumo de REGALO 🎁\nEnvío Miraflores: S/ 15.00\nTOTAL: S/ 137.00');
    expect(obs).toContain('MONTO A PAGAR: S/ 127.00');
    expect(obs).not.toContain('*');
    expect(obs).not.toContain('¿Deseas que agendemos');
  });

  it('si cambió lo que lleva, reemplaza la COT: sigue habiendo una sola y dice lo nuevo', async () => {
    // 20-10: el cliente quitó y agregó productos y el panel seguía mostrando
    // la primera cotización. Ahora la vieja se borra y se crea la nueva.
    const { service, comprobante, verBorrador } = armar({
      borrador: { ...limaCompleto(), itemsJson: null, cotizacionId: null },
    });
    comprobante.eliminarCotizacion = jest.fn().mockResolvedValue({});
    comprobante.crearInformal
      .mockResolvedValueOnce({ id: 501 })
      .mockResolvedValueOnce({ id: 502 });

    await service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 2 }]);
    // Mismo pedido: no toca la COT.
    await service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 2 }]);
    expect(comprobante.eliminarCotizacion).not.toHaveBeenCalled();

    // Agrega un producto: se reemplaza.
    await service.cotizar(EMPRESA, CONV, [
      { productoId: 1, cantidad: 2 },
      { productoId: 2, cantidad: 1 },
    ]);
    expect(comprobante.eliminarCotizacion).toHaveBeenCalledWith(501, EMPRESA);
    expect(comprobante.crearInformal).toHaveBeenCalledTimes(2);
    expect(comprobante.crearInformal.mock.calls[1][0].observaciones).toContain('Berberina');
    const b: any = verBorrador();
    expect(b.cotizacionId).toBe(502);
    expect(b.itemsJson).toEqual([
      { productoId: 1, cantidad: 2 },
      { productoId: 2, cantidad: 1 },
    ]);
  });
});

describe('cliente que vuelve a comprar (prueba del 19-10)', () => {
  const YA_ENTREGADO = {
    zona: 'Lima', tipoZona: 'DOMICILIO', lugar: 'Lince', costoEnvio: 15,
    nombre: 'Diego Ortega Ramos', dni: '45879632', celular: '991065217',
    direccion: 'Av. Arequipa 2100', referencia: 'frente al colegio',
    horario: 'mañana de 4 a 6', comprobanteId: 21893, cotizacionId: 9,
    itemsJson: [{ productoId: 1, cantidad: 1 }],
  };

  function conPedidoCerrado(estadoPago: string) {
    const a = armar({ borrador: { ...YA_ENTREGADO } });
    a.prisma.comprobante = {
      findUnique: jest.fn().mockResolvedValue({
        estadoPago, estadoEnvioSunat: 'NO_APLICA', envioDespacho: { estado: 'ENTREGADO' },
      }),
    };
    a.prisma.leadProspecto = {
      findFirst: jest.fn().mockResolvedValue({ id: 260, etapa: 'ENTREGADO' }),
      update: jest.fn().mockResolvedValue({}),
    };
    a.prisma.leadEtapaHistorial = { create: jest.fn().mockResolvedValue({}) };
    a.prisma.$transaction = jest.fn((ops: any[]) => Promise.all(ops));
    return a;
  }

  it('una cotización nueva abre otro pedido y conserva la dirección', async () => {
    const a = conPedidoCerrado('COMPLETADO');
    const r = await a.service.cotizar(EMPRESA, CONV, [{ productoId: 2, cantidad: 2 }]);
    expect(r.texto).toBeDefined();
    const b: any = a.verBorrador();
    expect(b.comprobanteId).toBeNull();
    expect(b.direccion).toBe('Av. Arequipa 2100');
    expect(b.horario).toBeNull();
    // El embudo vuelve a empezar: desde ENTREGADO no avanzaba.
    expect(a.prisma.leadProspecto.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ etapa: 'NUEVO' }) }),
    );
  });

  it('registrar sin cotizar lo nuevo no dice "ya estaba registrado"', async () => {
    const a = conPedidoCerrado('COMPLETADO');
    const r: any = await a.service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(r.registrado).toBeFalsy();
    expect(r.falta?.[0]).toMatch(/cotízalos primero/);
  });

  it('con el pedido anterior aún en curso, sigue la idempotencia', async () => {
    const a = conPedidoCerrado('PENDIENTE_PAGO');
    a.prisma.comprobante.findUnique.mockResolvedValue({
      estadoPago: 'PENDIENTE_PAGO', estadoEnvioSunat: 'NO_APLICA', envioDespacho: { estado: 'PREPARANDO' },
    });
    const r: any = await a.service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(r.registrado).toBe(true);
    expect(r.error).toMatch(/ya estaba registrado/);
  });
});

describe('prueba en vivo del 20-10: id inventado y nota borrada', () => {
  it('cotizar con un id que no existe no arma una cotización a medias', async () => {
    const { service, comprobante, verBorrador } = armar({
      borrador: { ...limaCompleto(), itemsJson: null, cotizacionId: null },
    });
    // El 1 existe; el 3844 lo inventó el modelo.
    const r = await service.cotizar(EMPRESA, CONV, [
      { productoId: 1, cantidad: 1 },
      { productoId: 3844, cantidad: 1 },
    ]);
    expect(r.texto).toBeUndefined();
    expect(r.error).toContain('3844');
    expect(r.error).toContain('buscar_productos');
    expect(comprobante.crearInformal).not.toHaveBeenCalled();
    // Y no deja guardado el id malo para que registrar falle después.
    expect((verBorrador() as any).itemsJson).toBeNull();
  });

  it('con el nombre del producto corrige el id mal escrito y cotiza todo', async () => {
    const catalogo = [
      { id: 31468, descripcion: 'Uña de Gato - OASIS ( 100 capsulas )', precioUnitario: 30 },
      { id: 31000, descripcion: 'aceite de copaiba - SAYAL ( 30ml )', precioUnitario: 15 },
    ];
    const { service, prisma, verBorrador } = armar({
      borrador: { ...limaCompleto(), itemsJson: null, cotizacionId: null },
    });
    prisma.producto.findMany.mockImplementation(({ where }: any) => {
      if (where.descripcion) {
        const n = String(where.descripcion.equals).toLowerCase();
        return Promise.resolve(catalogo.filter((p) => p.descripcion.toLowerCase() === n));
      }
      return Promise.resolve(catalogo.filter((p) => where.id.in.includes(p.id)));
    });
    const r = await service.cotizar(EMPRESA, CONV, [
      { productoId: 31468, cantidad: 1, nombre: 'Uña de Gato - OASIS ( 100 capsulas )' },
      { productoId: 3844, cantidad: 1, nombre: 'aceite de copaiba - SAYAL ( 30ml )' },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.texto).toContain('1x aceite de copaiba - SAYAL ( 30ml ) - P.U. S/ 15.00');
    expect(r.texto).toContain('*TOTAL: S/ 60.00*');
    expect((verBorrador() as any).itemsJson).toEqual([
      { productoId: 31468, cantidad: 1 },
      { productoId: 31000, cantidad: 1 },
    ]);
  });

  it('registrar con un id guardado que no existe pide recotizar, no revienta', async () => {
    const b = limaCompleto();
    b.itemsJson = [
      { productoId: 1, cantidad: 1 },
      { productoId: 3844, cantidad: 1 },
    ];
    const { service, comprobante } = armar({ borrador: b });
    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(r.registrado).toBeUndefined();
    expect(r.error).toMatch(/vuelve a cotizar/);
    expect(comprobante.crearInformal).not.toHaveBeenCalled();
  });

  it('si la nota del pedido fue borrada, registra de nuevo en vez de decir "ya estaba"', async () => {
    const a = armar({ borrador: { ...limaCompleto(), comprobanteId: 21707 } });
    a.prisma.comprobante = { findUnique: jest.fn().mockResolvedValue(null) };
    const r = await a.service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(r.registrado).toBe(true);
    expect(r.pedido).toBe('NV01-00000007');
    expect(a.comprobante.crearInformal).toHaveBeenCalledTimes(1);
  });

  it('si la consulta de la nota falla, no se registra dos veces', async () => {
    const a = armar({ borrador: { ...limaCompleto(), comprobanteId: 21707 } });
    a.prisma.comprobante = {
      findUnique: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const r = await a.service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(a.comprobante.crearInformal).not.toHaveBeenCalled();
    expect(r.error).toMatch(/ya estaba registrado/);
  });
});

describe('datos para agendar en un solo mensaje (pedido de Hierba Sana 20-10)', () => {
  it('guardar el destino devuelve el bloque con todo lo que falta, celular al final', async () => {
    const { service } = armar({
      borrador: limaCompleto(['nombre', 'direccion', 'referencia', 'horario', 'celular']),
    });
    const r = await service.guardarDatos(EMPRESA, CONV, {} as any);
    expect(r.pedirTodoJunto).toBe(
      [
        'Para agendar tu pedido, compárteme estos datos en un solo mensaje:',
        '',
        '*DATOS PARA AGENDAR TU PEDIDO*',
        '- Nombres y apellidos:',
        '- Dirección (calle y número):',
        '- Referencia:',
        '- Horario para recibir tu pedido:',
        '- Número de celular:',
      ].join('\n'),
    );
  });

  it('la cotización trae el bloque listo para cuando acepte', async () => {
    const { service } = armar({
      borrador: { ...limaCompleto(['nombre', 'celular']), itemsJson: null, cotizacionId: null },
    });
    const r = await service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 1 }]);
    expect(r.texto).toBeDefined();
    expect(r.pedirTodoJunto).toContain('- Nombres y apellidos:\n- Número de celular:');
  });

  it('registrar con datos pendientes también lo devuelve', async () => {
    const { service } = armar({ borrador: limaCompleto(['referencia', 'celular']) });
    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(r.falta).toHaveLength(2);
    expect(r.pedirTodoJunto).toContain('*DATOS PARA AGENDAR TU PEDIDO*');
  });

  it('con un solo dato pendiente no hace falta el bloque', async () => {
    const { service } = armar({ borrador: limaCompleto(['celular']) });
    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(r.pedirTodoJunto).toBeUndefined();
  });

  it('provincia pide DNI y agencia, no dirección', async () => {
    const { service } = armar({
      borrador: {
        ...limaCompleto(['nombre', 'celular', 'direccion', 'referencia', 'horario']),
        tipoZona: 'AGENCIA', zona: 'Provincia', lugar: 'Cusco', costoEnvio: 10,
      },
    });
    const r = await service.registrarPedido(EMPRESA, CONV, TELEFONO);
    expect(r.pedirTodoJunto).toContain('- DNI:');
    expect(r.pedirTodoJunto).toContain('- Agencia y sede donde recogerás:');
    expect(r.pedirTodoJunto).not.toContain('Dirección');
  });

  it('si el lugar guardado es una dirección entera, el envío dice la zona', async () => {
    const { service } = armar({
      borrador: {
        ...limaCompleto(), lugar: 'CALLAO MZ N LT 13 URB LAS FRESAS', itemsJson: null, cotizacionId: null,
      },
    });
    const r = await service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 1 }]);
    expect(r.texto).toContain('Envío Lima: S/ 15.00');
  });
});

describe('cambiar el pedido después de registrado (validación del 20-10)', () => {
  function registrado(pagos: { monto: number; medioPago: string }[] = []) {
    const a = armar({
      borrador: {
        ...limaCompleto(),
        tipoZona: 'AGENCIA', zona: 'Provincia', lugar: 'Arequipa', costoEnvio: 10,
        dni: '47065472', agenciaSede: 'Shalom Jr Parra',
        itemsJson: [{ productoId: 1, cantidad: 1 }],
        comprobanteId: 22055, cotizacionId: 22052,
      },
    });
    a.prisma.comprobante = {
      // Pedido en curso: ni pagado del todo ni entregado.
      findUnique: jest.fn().mockResolvedValue({
        id: 22055, estadoPago: 'PENDIENTE_PAGO', estadoEnvioSunat: 'NO_APLICA', envioDespacho: { estado: 'PENDIENTE' },
      }),
    };
    a.prisma.pago = { findMany: jest.fn().mockResolvedValue(pagos) };
    a.prisma.leadConversacion = { findUnique: jest.fn().mockResolvedValue({ telefonoProspecto: TELEFONO }) };
    a.prisma.leadProspecto = { findFirst: jest.fn().mockResolvedValue(null) };
    a.prisma.envioDespacho = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    a.comprobante.eliminarCotizacion = jest.fn().mockResolvedValue({});
    a.comprobante.editarNotaVenta = jest.fn().mockResolvedValue({ serie: 'NV01', correlativo: 10 });
    return a;
  }

  it('edita la nota con lo nuevo (envío incluido) y el despacho cobra el total nuevo', async () => {
    const a = registrado();
    const r: any = await a.service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 2 }]);

    expect(r.pedidoActualizado).toBe('NV01-00000010');
    const [id, input] = a.comprobante.editarNotaVenta.mock.calls[0];
    expect(id).toBe(22055);
    expect(input.detalles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productoId: 1, cantidad: 2 }),
        expect.objectContaining({ productoId: null, descripcion: 'ENVÍO AREQUIPA (AGENCIA)', nuevoValorUnitario: 10 }),
      ]),
    );
    expect(input.formaPagoTipo).toBe('CREDITO');
    // 2×31 + 10 = 72, sin pagos todavía.
    expect(a.prisma.envioDespacho.updateMany).toHaveBeenCalledWith({
      where: { comprobanteId: 22055 },
      data: { montoCOD: 72 },
    });
  });

  it('lo ya pagado se conserva como adelanto y el saldo baja', async () => {
    const a = registrado([{ monto: 20, medioPago: 'YAPE' }]);
    const r: any = await a.service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 2 }]);
    const input = a.comprobante.editarNotaVenta.mock.calls[0][1];
    expect(input.adelanto).toBe(20);
    expect(input.medioPago).toBe('YAPE');
    expect(r.porCobrar).toBe(52);
  });

  it('si ya pagó más que el total nuevo, no toca la nota y avisa', async () => {
    const a = registrado([{ monto: 100, medioPago: 'YAPE' }]);
    const r: any = await a.service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 1 }, { productoId: 2, cantidad: 0 }]);
    // Mismos ítems que los registrados: ni siquiera intenta editar.
    expect(a.comprobante.editarNotaVenta).not.toHaveBeenCalled();
    const r2: any = await registrado([{ monto: 100, medioPago: 'YAPE' }]).service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 2 }]);
    expect(r2.aviso).toMatch(/NO se pudo actualizar/);
    expect(r.pedidoActualizado).toBeUndefined();
  });

  it('si la edición falla, el modelo no puede confirmar el cambio', async () => {
    const a = registrado();
    a.comprobante.editarNotaVenta.mockRejectedValue(new Error('convertida'));
    const r: any = await a.service.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 2 }]);
    expect(r.aviso).toMatch(/No le digas que el pedido quedó actualizado/);
    expect(a.prisma.envioDespacho.updateMany).not.toHaveBeenCalled();
  });
});

describe('id válido pero de otro producto (validación del 20-10)', () => {
  it('manda el nombre que se le ofreció al cliente', async () => {
    const catalogo = [
      { id: 30001, descripcion: 'aceite de almendra - LAB. GERWILL ( 30ML )', precioUnitario: 5 },
      { id: 30002, descripcion: 'aceite esencial de almendra - ARTESANAL DESTILADO ( 10ml )', precioUnitario: 15 },
    ];
    const { service, prisma, verBorrador } = armar({
      borrador: { ...limaCompleto(), itemsJson: null, cotizacionId: null },
    });
    prisma.producto.findMany.mockImplementation(({ where }: any) => {
      if (where.descripcion) {
        const n = String(where.descripcion.equals).toLowerCase();
        return Promise.resolve(catalogo.filter((p) => p.descripcion.toLowerCase() === n));
      }
      return Promise.resolve(catalogo.filter((p) => where.id.in.includes(p.id)));
    });
    const r = await service.cotizar(EMPRESA, CONV, [
      { productoId: 30002, cantidad: 1, nombre: 'aceite de almendra - LAB. GERWILL ( 30ML )' },
    ]);
    expect(r.texto).toContain('GERWILL ( 30ML ) - P.U. S/ 5.00');
    expect((verBorrador() as any).itemsJson).toEqual([{ productoId: 30001, cantidad: 1 }]);
  });
});
