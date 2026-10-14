/**
 * Convertir una Orden de Trabajo en Nota de venta.
 *
 * Lo pidió un taller: levantan la OT cuando entra el trabajo y recién cuando
 * sale quieren la nota, para programar la entrega. Hasta ahora había que
 * tipear la venta de nuevo.
 *
 * Lo que de verdad hay que proteger son tres cuentas que, si se equivocan,
 * dejan plata o inventario mal:
 *
 *  1. Lo que la OT ya cobró entró a caja cuando se cobró. Volver a registrarlo
 *     lo cuenta dos veces en el cierre de turno y en el flujo de caja. Y como
 *     solo se convierte una orden ya saldada, el saldo se cobra ANTES, desde
 *     Gestión de Pagos: así el ingreso queda a la hora y por el monto reales.
 *  2. Una OT emitida desde el POS YA descontó stock. Descontar otra vez al
 *     convertir deja el inventario corto. Por eso el descuento del origen se
 *     MIDE contra el kardex y no se deduce del tipo de documento.
 *  3. Una OT no se puede convertir dos veces: serían dos ventas por un solo
 *     trabajo, en los reportes, en el stock y en las comisiones.
 */
import { BadRequestException } from '@nestjs/common';
import { ComprobanteService } from './comprobante.service';

type Origen = {
  id: number;
  tipoDoc: string;
  serie: string;
  correlativo: number;
  estadoPago: string;
  estadoEnvioSunat: string;
  mtoImpVenta: number;
  saldo: number;
};

const OT: Origen = {
  id: 19466,
  tipoDoc: 'OT',
  serie: 'OT01',
  correlativo: 1,
  estadoPago: 'COMPLETADO',
  estadoEnvioSunat: 'NO_APLICA',
  mtoImpVenta: 24,
  saldo: 0,
};

/**
 * Ejecuta solo el bloque de validación/medición del origen, que es donde vive
 * la regla. El resto de `crearInformal` necesita media base de datos; lo que
 * acá importa es qué se acepta y qué números salen de la OT.
 */
const validarOrigen = async (opts: {
  origen?: Origen | null;
  tipoDocDestino?: string;
  salidasKardex?: number;
  sumaPagos?: number;
  comisiones?: number;
}) => {
  const {
    origen = OT,
    tipoDocDestino = 'NV',
    salidasKardex = 0,
    sumaPagos = 0,
    comisiones = 0,
  } = opts;

  const prisma = {
    comprobante: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          where?.comprobanteOrigenId !== undefined
            ? (opts as any).yaConvertido ?? null
            : origen,
        ),
      ),
    },
    movimientoKardex: { count: jest.fn(() => Promise.resolve(salidasKardex)) },
    pago: {
      aggregate: jest.fn(() => Promise.resolve({ _sum: { monto: sumaPagos } })),
    },
    comisionVendedor: { count: jest.fn(() => Promise.resolve(comisiones)) },
  };
  const service = new ComprobanteService(prisma as any);
  return (service as any).validarOrigenDeConversion(
    origen?.id ?? 1,
    70,
    tipoDocDestino,
  );
};

describe('qué origen se acepta', () => {
  it('una Orden de Trabajo vigente', async () => {
    await expect(validarOrigen({})).resolves.toMatchObject({ ok: true });
  });

  it('no un documento de otra empresa (no se encuentra)', async () => {
    await expect(validarOrigen({ origen: null })).rejects.toThrow(
      /no existe o no pertenece/i,
    );
  });

  it('no una Nota de Venta: solo la OT se convierte así', async () => {
    await expect(
      validarOrigen({ origen: { ...OT, tipoDoc: 'NV' } }),
    ).rejects.toThrow(/Orden de Trabajo/i);
  });

  it('no hacia una Factura: para eso está la conversión a formal', async () => {
    await expect(validarOrigen({ tipoDocDestino: '01' })).rejects.toThrow(
      /Nota de venta/i,
    );
  });

  it('no una OT anulada: sería una venta por un trabajo dado de baja', async () => {
    await expect(
      validarOrigen({ origen: { ...OT, estadoEnvioSunat: 'ANULADO' } }),
    ).rejects.toThrow(/anulada/i);
  });

  it('no una OT con saldo: primero se cobra, después se convierte', async () => {
    // El taller cobra al entregar, que es cuando pide la nota. Cobrar dentro
    // de la emisión obligaba al modal a mostrar el total como "recibido"
    // cuando en la mano entraba solo el saldo.
    await expect(
      validarOrigen({
        origen: { ...OT, estadoPago: 'PAGO_PARCIAL', saldo: 14.01 },
      }),
    ).rejects.toThrow(/saldo pendiente de S\/ 14\.01/i);
  });

  it('el mensaje dice dónde cobrarlo, no solo que no se puede', async () => {
    await expect(
      validarOrigen({
        origen: { ...OT, estadoPago: 'PAGO_PARCIAL', saldo: 14.01 },
      }),
    ).rejects.toThrow(/Gestión de Pagos/i);
  });

  it('no una OT ya convertida: duplicaría la venta', async () => {
    await expect(
      validarOrigen({
        yaConvertido: { serie: 'NV01', correlativo: 10 },
      } as any),
    ).rejects.toThrow(/ya fue convertida/i);
  });
});

describe('qué se arrastra de la OT', () => {
  it('mide el stock contra el kardex, no contra el tipo de documento', async () => {
    // Caso real: la OT emitida desde el POS descuenta stock. Si esto diera
    // false, la nota volvería a descontar y el inventario quedaría corto.
    const conSalidas = await validarOrigen({ salidasKardex: 2 });
    expect(conSalidas.origenYaDescontoStock).toBe(true);

    const sinSalidas = await validarOrigen({ salidasKardex: 0 });
    expect(sinSalidas.origenYaDescontoStock).toBe(false);
  });

  it('lo cobrado sale de los pagos de la OT', async () => {
    // Una OT se convierte ya saldada, pero el monto no se asume igual al total:
    // puede haberse cobrado en varias veces y lo que vale es lo registrado.
    const r = await validarOrigen({
      origen: { ...OT, estadoPago: 'PAGO_PARCIAL', saldo: 0 },
      sumaPagos: 24,
    });
    expect(r.montoYaCobradoEnOrigen).toBeCloseTo(24, 2);
  });

  it('una OT marcada COMPLETADO sin filas de Pago igual cuenta como cobrada', async () => {
    // Órdenes viejas quedaron así; su cobro figura en caja por mtoImpVenta.
    const r = await validarOrigen({ sumaPagos: 0 });
    expect(r.montoYaCobradoEnOrigen).toBeCloseTo(24, 2);
  });

  it('entre pagos y total cobrado manda el mayor, no la suma', async () => {
    const r = await validarOrigen({ sumaPagos: 24 });
    expect(r.montoYaCobradoEnOrigen).toBeCloseTo(24, 2);
  });

  it('avisa si la OT ya generó comisión, para no pagarla dos veces', async () => {
    expect((await validarOrigen({ comisiones: 1 })).origenYaGeneroComision).toBe(
      true,
    );
    expect((await validarOrigen({ comisiones: 0 })).origenYaGeneroComision).toBe(
      false,
    );
  });
});

describe('BadRequest y no otro error', () => {
  it('los rechazos son 400, no 500', async () => {
    await expect(validarOrigen({ origen: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
