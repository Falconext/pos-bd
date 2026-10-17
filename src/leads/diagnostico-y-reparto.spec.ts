/**
 * Dos cosas que el pedido NV01-00000008 dejó al descubierto el 2026-10-17.
 *
 * 1) El diagnóstico se perdía. Los síntomas que el cliente contaba se
 *    guardaban en `LeadProspecto.resumen`, el MISMO campo que el análisis BANT
 *    reescribe en cada mensaje con su resumen de venta. Para cuando el pedido
 *    se cerraba, la guía de consumo se armaba con "eligió el producto X y ya
 *    envió el comprobante" en vez de "acidez por las noches". Ahora los
 *    síntomas tienen campo propio.
 *
 * 2) El pedido no salía en el Excel de reparto. Al despacho le faltaban las
 *    dos columnas de la plantilla del motorizado —tipo de venta y forma de
 *    cobro—, así que el panel lo marcaba "con datos incompletos" y el
 *    repartidor nunca se enteraba.
 */
import { LeadsPedidoService } from './leads-pedido.service';
import { CONFIG_ENVIO_HIERBA_SANA } from './envio-zonas';
import { REGLAS_HIERBA_SANA } from './reglas-descuento';

const EMPRESA = 89;
const CONV = 212;

describe('el diagnóstico del cliente', () => {
  function armar() {
    const escrito: any[] = [];
    const prisma: any = {
      empresa: {
        findUnique: jest.fn().mockResolvedValue({
          iaVentasConfigJson: {
            envio: CONFIG_ENVIO_HIERBA_SANA,
            descuento: REGLAS_HIERBA_SANA,
          },
        }),
      },
      leadMensaje: { findMany: jest.fn().mockResolvedValue([]) },
      leadPedidoBorrador: {
        upsert: jest.fn().mockResolvedValue({ tipoZona: null }),
      },
      leadProspecto: {
        updateMany: jest.fn((args: any) => {
          escrito.push(args.data);
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const servicio = new LeadsPedidoService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
    );
    return {
      guardar: (datos: any) => servicio.guardarDatos(EMPRESA, CONV, datos),
      escrito,
    };
  }

  it('los síntomas van a su propio campo, no al resumen del BANT', async () => {
    const { guardar, escrito } = armar();
    await guardar({ sintomas: 'acidez por las noches hace dos meses' });

    expect(escrito[0].sintomas).toBe('acidez por las noches hace dos meses');
    // Lo que importa: si cayera en `resumen`, el análisis BANT lo pisaría al
    // mensaje siguiente y la guía de consumo se armaría con otra cosa.
    expect(escrito[0].resumen).toBeUndefined();
  });

  it('guarda también la edad y el sexo, que mandan la dosis', async () => {
    const { guardar, escrito } = armar();
    await guardar({ sintomas: 'me duele la próstata', edad: 58, sexo: 'hombre' });

    expect(escrito[0]).toMatchObject({ edad: 58, sexo: 'M' });
  });
});

describe('el pedido sale en el Excel de reparto', () => {
  function armar(tipoZona: string, opts: { adelanto?: boolean } = {}) {
    const despachos: any[] = [];
    const borrador: any = {
      tipoZona,
      zona: tipoZona === 'AGENCIA' ? 'Provincia' : 'Lima',
      lugar: tipoZona === 'AGENCIA' ? 'Cusco' : 'San Juan de Lurigancho',
      nombre: 'Diego Ortega',
      dni: tipoZona === 'AGENCIA' ? '70123456' : null,
      celular: '991065217',
      direccion: 'Mz N Lt 13',
      referencia: 'una ferretería',
      agenciaSede: tipoZona === 'AGENCIA' ? 'Shalom Cusco' : null,
      horario: 'mañana a las 4',
      costoEnvio: 15,
      itemsJson: [{ productoId: 1, cantidad: 1 }],
      comprobanteId: null,
    };

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
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 1, precioUnitario: 31 }]),
      },
      cliente: {
        findFirst: jest.fn().mockResolvedValue({ id: 7, telefono: '991065217' }),
      },
      leadProspecto: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const comprobante: any = {
      crearInformal: jest
        .fn()
        .mockResolvedValue({ id: 500, serie: 'NV01', correlativo: 9 }),
    };
    const despacho: any = {
      create: jest.fn((_c: number, _e: number, datos: any) => {
        despachos.push(datos);
        return Promise.resolve({});
      }),
    };
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
      registrar: () =>
        servicio.registrarPedido(EMPRESA, CONV, '51991065217'),
      despachos,
    };
  }

  it('un pedido a domicilio declara contraentrega y cómo se cobra', async () => {
    // Son las dos columnas de la plantilla del motorizado. Sin ellas el panel
    // lo marca "con datos incompletos" y queda fuera del Excel del día.
    const { registrar, despachos } = armar('DOMICILIO');
    await registrar();

    expect(despachos[0]).toMatchObject({
      tipoEnvio: 'DOMICILIO',
      tipoVentaReparto: 'CONTRAENTREGA',
      formaPagoCobro: 'EFECTIVO',
    });
    // Producto 31 + envío 15: es lo que el repartidor cobra en la puerta.
    expect(despachos[0].montoCOD).toBe(46);
  });

  it('en provincia el motorizado no entra: esas columnas no se inventan', async () => {
    // El envío por agencia usa otra plantilla; poner "CONTRAENTREGA" ahí
    // marcaría como incompleto lo que está completo.
    const { registrar, despachos } = armar('AGENCIA');
    await registrar();

    expect(despachos[0].tipoEnvio).toBe('AGENCIA');
    expect(despachos[0].tipoVentaReparto).toBeUndefined();
    expect(despachos[0].formaPagoCobro).toBeUndefined();
  });
});
