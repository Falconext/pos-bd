/**
 * Que el comprobante diga lo que el cliente realmente paga.
 *
 * Dos cosas que el NV01-00000008 dejó al descubierto el 2026-10-17:
 *
 * 1) El total no incluía el descuento, así que un pedido con rebaja por
 *    volumen se facturaba de MÁS: 3×90 con S/ 10 de descuento salía en 270.
 *    El envío, en cambio, NO va en el comprobante y es a propósito: lo
 *    decidió la contadora del negocio, porque el delivery no se factura.
 *
 * 2) El pedido nacía "pagado" con saldo 0. El cliente había yapeado S/ 20 y
 *    el sistema daba por cobrados los S/ 46; en provincia pasaba al revés,
 *    daba por cobrada la mitad aunque no hubiera llegado nada.
 *
 * La regla que fijó el negocio: cualquier pago recibido queda como adelanto y
 * el resto figura como saldo por pagar, sea Lima, provincia o reserva.
 */
import { LeadsPedidoService } from './leads-pedido.service';
import { CONFIG_ENVIO_HIERBA_SANA } from './envio-zonas';
import { REGLAS_HIERBA_SANA } from './reglas-descuento';

const EMPRESA = 89;
const CONV = 212;

function armar(opts: { items?: any[]; pagos?: number[]; zona?: string; medio?: string } = {}) {
  const items = opts.items ?? [{ productoId: 1, cantidad: 1 }];
  const esAgencia = opts.zona === 'AGENCIA';
  const borrador: any = {
    tipoZona: opts.zona ?? 'DOMICILIO',
    zona: esAgencia ? 'Provincia' : 'Lima',
    lugar: esAgencia ? 'Cusco' : 'San Juan de Lurigancho',
    nombre: 'Diego Ortega',
    dni: esAgencia ? '70123456' : null,
    celular: '991065217',
    direccion: 'Mz N Lt 13',
    referencia: 'una ferretería',
    agenciaSede: esAgencia ? 'Shalom Cusco' : null,
    horario: 'mañana a las 4',
    costoEnvio: esAgencia ? 10 : 15,
    itemsJson: items,
    comprobanteId: null,
  };

  let emitido: any = null;
  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        iaVentasConfigJson: {
          envio: CONFIG_ENVIO_HIERBA_SANA,
          descuento: REGLAS_HIERBA_SANA,
        },
      }),
    },
    leadPedidoBorrador: {
      findUnique: jest.fn().mockResolvedValue(borrador),
      update: jest.fn().mockResolvedValue({}),
    },
    producto: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, precioUnitario: 31 },
        { id: 2, precioUnitario: 90 },
      ]),
    },
    cliente: {
      findFirst: jest.fn().mockResolvedValue({ id: 7, telefono: '991065217' }),
    },
    leadProspecto: { findFirst: jest.fn().mockResolvedValue(null) },
    leadComprobantePago: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (opts.pagos ?? []).map((m) => ({ montoLeido: m, medioLeido: opts.medio ?? null })),
        ),
    },
  };
  const comprobante: any = {
    crearInformal: jest.fn((dto: any) => {
      emitido = dto;
      return Promise.resolve({ id: 500, serie: 'NV01', correlativo: 9 });
    }),
  };
  const despacho: any = { create: jest.fn().mockResolvedValue({}) };
  const notificaciones: any = {
    notificarAdminsEmpresa: jest.fn().mockResolvedValue(undefined),
  };

  const servicio = new LeadsPedidoService(
    prisma,
    comprobante,
    despacho,
    notificaciones,
  );
  return {
    registrar: () => servicio.registrarPedido(EMPRESA, CONV, '51991065217'),
    emitido: () => emitido,
    despacho,
    /** Lo que suman las líneas del comprobante: el total que se emite. */
    totalEmitido: () =>
      emitido.detalles.reduce(
        (a: number, l: any) => a + l.nuevoValorUnitario * l.cantidad,
        0,
      ),
  };
}

describe('el total del comprobante', () => {
  it('lleva el envío como una línea más: el total es el de la cotización', async () => {
    // Pedido de Hierba Sana (20-10): "ya no sería 14 sino 24". Hasta el 17-10
    // el envío quedaba afuera por pedido de su contadora; el negocio lo cambió.
    const { registrar, emitido, totalEmitido } = armar();
    const r = await registrar();

    expect(r.montoAPagar).toBe(46);
    expect(Math.round(totalEmitido() * 100) / 100).toBe(46);
    const envio = emitido().detalles.find((l: any) => l.productoId == null);
    expect(envio).toMatchObject({ descripcion: 'ENVÍO DELIVERY', cantidad: 1, nuevoValorUnitario: 15 });
  });

  it('el envío sí queda escrito, para que el equipo lo vea', async () => {
    // Fuera del total, pero no perdido: va en las observaciones y en lo que
    // el repartidor tiene que cobrar.
    const { registrar, emitido, despacho } = armar();
    await registrar();

    expect(emitido().observaciones).toMatch(/Envío: S\/ 15\.00/);
    expect(despacho.create.mock.calls[0][2].montoCOD).toBe(46);
  });

  it('el descuento sí entra: ese es mercadería', async () => {
    // 3×90 = 270 con S/ 10 de rebaja por volumen = 260. Antes se facturaban
    // los 270 completos, S/ 10 de más.
    const { registrar, totalEmitido, emitido } = armar({
      items: [{ productoId: 2, cantidad: 3 }],
      zona: 'AGENCIA',
    });
    const r = await registrar();

    const mercaderia = emitido()
      .detalles.filter((l: any) => l.productoId)
      .reduce((a: number, l: any) => a + l.cantidad * l.nuevoValorUnitario, 0);
    expect(Math.round(mercaderia * 100) / 100).toBe(260);
    // Y con el envío de la agencia, la nota suma lo mismo que la cotización.
    expect(Math.round(totalEmitido() * 100) / 100).toBe(r.montoAPagar);
    expect(emitido().detalles.find((l: any) => l.productoId == null).descripcion).toMatch(/^ENVÍO .*\(AGENCIA\)$/);
  });

  it('el descuento se reparte, no cae entero en una línea', async () => {
    const { registrar, emitido } = armar({
      items: [
        { productoId: 1, cantidad: 2 },
        { productoId: 2, cantidad: 3 },
      ],
      zona: 'AGENCIA',
    });
    await registrar();

    const productos = emitido().detalles.filter((l: any) => l.productoId);
    // Ninguna línea queda regalada ni a precio lleno mientras otra absorbe todo.
    for (const l of productos) {
      expect(l.nuevoValorUnitario).toBeGreaterThan(0);
    }
    expect(productos[0].nuevoValorUnitario).toBeLessThan(31);
    expect(productos[1].nuevoValorUnitario).toBeLessThan(90);
  });
});

describe('el adelanto y el saldo', () => {
  it('toma lo que el cliente pagó de verdad', async () => {
    const { registrar, emitido, despacho } = armar({ pagos: [20] });
    const r = await registrar();

    expect(r.adelanto).toBe(20);
    expect(emitido().adelanto).toBe(20);
    // Lo que el repartidor cobra en la puerta: 46 − 20.
    expect(despacho.create.mock.calls[0][2].montoCOD).toBe(26);
  });

  it('suma varios comprobantes', async () => {
    const { registrar } = armar({ pagos: [10, 15.5] });
    const r = await registrar();

    expect(r.adelanto).toBe(25.5);
  });

  describe('lo que NO debe pasar', () => {
    it('sin ningún pago no se inventa un adelanto', async () => {
      const { registrar, emitido, despacho } = armar();
      const r = await registrar();

      expect(r.adelanto).toBeUndefined();
      expect(emitido().adelanto).toBeUndefined();
      expect(despacho.create.mock.calls[0][2].montoCOD).toBe(46);
    });

    it('y sin pago la nota NACE PENDIENTE, no cobrada', async () => {
      // El agujero que se vio en el NV01-00000009: el adelanto ya se pasaba,
      // pero sin pago no había adelanto que pasar, la nota caía en "contado"
      // y nacía COMPLETADO con saldo 0 — contradiciendo a su propio despacho,
      // que decía CONTRAENTREGA con S/ 45 por cobrar. Es el caso NORMAL de
      // Lima, así que era el que más veces salía mal.
      const { registrar, emitido } = armar();
      await registrar();

      expect(emitido().formaPagoTipo).toBe('CREDITO');
    });

    it('si el cliente ya pagó todo, la nota sale saldada', async () => {
      const { registrar, emitido, despacho } = armar({ pagos: [46] });
      await registrar();

      expect(emitido().formaPagoTipo).toBe('CONTADO');
      expect(despacho.create.mock.calls[0][2].montoCOD).toBe(0);
    });

    it('un monto mal leído no deja el pedido sobrepagado', async () => {
      // La IA puede leer 4600 donde decía 46.00. El saldo no puede quedar
      // negativo ni el pedido nacer con vuelto.
      const { registrar, despacho } = armar({ pagos: [4600] });
      const r = await registrar();

      expect(r.adelanto).toBe(46);
      expect(despacho.create.mock.calls[0][2].montoCOD).toBe(0);
    });

    it('un comprobante rechazado no cuenta como pago', async () => {
      // Lo filtra la consulta: alguien lo miró y dijo que no.
      const { registrar } = armar({ pagos: [] });
      const r = await registrar();

      expect(r.adelanto).toBeUndefined();
    });
  });
});

describe('el medio del adelanto (pedido de Hierba Sana 20-10)', () => {
  it('un adelanto por Yape queda como YAPE en la nota, no EFECTIVO', async () => {
    const { registrar, emitido } = armar({ pagos: [20], medio: 'Yape' });
    await registrar();
    expect(emitido().adelanto).toBe(20);
    expect(emitido().medioPago).toBe('YAPE');
  });

  it('y por Plin, PLIN', async () => {
    const { registrar, emitido } = armar({ pagos: [20], medio: 'Plin' });
    await registrar();
    expect(emitido().medioPago).toBe('PLIN');
  });

  it('sin adelanto no se le pone medio', async () => {
    const { registrar, emitido } = armar();
    await registrar();
    expect(emitido().medioPago).toBeUndefined();
  });
});
