/**
 * Leer el comprobante de pago que manda el cliente.
 *
 * Hasta ahora la captura del Yape se bajaba y se archivaba CERRADA: el pedido
 * quedaba esperando a que una persona abriera la foto para ver de cuánto era.
 * Al cliente se le respondía "ya le avisé al asesor", que no confirma nada —y
 * el dueño de Hierba Sana lo reportó justamente así: la IA insiste con el
 * comprobante pero después no hace nada con él.
 *
 * Lo que se defiende acá:
 *   1. que lo leído llegue al modelo, para que se lo confirme al cliente;
 *   2. que una imagen que NO es un comprobante no invente un pago;
 *   3. que nada de esto pueda frenar una venta: si la IA falla, la foto
 *      borrosa o el banco es raro, el flujo sigue como antes.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsMessageProcessor } from './leads-message.processor';

const EMPRESA = 89;
const CONV = 212;
const MSG = 777;

const VOUCHER = {
  esComprobante: true,
  monto: 30,
  numeroOperacion: '12345678',
  fecha: '16 oct 2026',
  medio: 'Yape',
  pagador: 'Diego Ortega',
};

function armar(opts: { leido?: any; iaDisponible?: boolean; conBorrador?: boolean } = {}) {
  const registrados: any[] = [];
  const mensajes: any[] = [];

  const prisma: any = {
    leadPedidoBorrador: {
      findUnique: jest.fn().mockResolvedValue(
        opts.conBorrador === false ? null : { cotizacionId: 55, comprobanteId: null },
      ),
    },
    leadMensaje: {
      update: jest.fn((args: any) => {
        mensajes.push(args.data.contenido);
        return Promise.resolve({});
      }),
    },
  };
  const whatsapp: any = {
    descargarMedia: jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'image/jpeg' }),
  };
  const ia: any = {
    disponible: () => opts.iaDisponible ?? true,
    leerComprobantePago: jest.fn().mockResolvedValue(
      'leido' in opts ? opts.leido : VOUCHER,
    ),
  };
  const embudo: any = {
    registrarComprobantePago: jest.fn((_e: number, _c: number, datos: any) => {
      registrados.push(datos);
      return Promise.resolve({ registrado: true });
    }),
  };

  const processor = new LeadsMessageProcessor(
    prisma, ia, {} as never, whatsapp, {} as never, {} as never,
    {} as never, {} as never, embudo, {} as never, {} as never, {} as never,
  );
  const registrar = (texto?: string) =>
    (processor as any).registrarVoucherSiCorresponde(
      EMPRESA,
      CONV,
      { from: '51987654321', mediaId: 'media-1', esImagen: true, text: texto },
      MSG,
    );
  return { registrar, registrados, mensajes, ia, embudo, prisma };
}

describe('comprobante de pago leído', () => {
  it('guarda lo que leyó junto al comprobante', async () => {
    const { registrar, registrados } = armar();
    await registrar('[el cliente envió una imagen]');
    expect(registrados[0].leido).toMatchObject({
      monto: 30,
      numeroOperacion: '12345678',
      medio: 'Yape',
      pagador: 'Diego Ortega',
    });
  });

  it('se lo cuenta al modelo escribiéndolo en el mensaje del cliente', async () => {
    // Así el agente lo confirma con naturalidad y aplica las reglas de pago
    // que el negocio ya tiene en su contexto, sin herramientas nuevas.
    const { registrar, mensajes } = armar();
    await registrar('[el cliente envió una imagen]');
    expect(mensajes[0]).toMatch(/comprobante de pago/i);
    expect(mensajes[0]).toMatch(/Yape/);
    expect(mensajes[0]).toMatch(/S\/ 30\.00/);
    expect(mensajes[0]).toMatch(/operación 12345678/);
    expect(mensajes[0]).toMatch(/Diego Ortega/);
  });

  it('conserva lo que el cliente escribió junto a la foto', async () => {
    const { registrar, mensajes } = armar();
    await registrar('[el cliente envió una imagen] ya te pagué, verifica');
    expect(mensajes[0]).toMatch(/ya te pagué, verifica/);
  });

  describe('lo que NO debe pasar', () => {
    it('una foto que no es comprobante no inventa un pago', async () => {
      // Puede ser la foto de un frasco, una receta o una captura de chat.
      const { registrar, registrados, mensajes } = armar({
        leido: { esComprobante: false, monto: null, numeroOperacion: null, fecha: null, medio: null, pagador: null },
      });
      await registrar('[el cliente envió una imagen]');
      expect(registrados[0].leido).toBeNull();
      expect(mensajes).toHaveLength(0);
    });

    it('si la IA no está, el comprobante se archiva igual', async () => {
      const { registrar, registrados, ia } = armar({ iaDisponible: false });
      await registrar('[el cliente envió una imagen]');
      expect(ia.leerComprobantePago).not.toHaveBeenCalled();
      expect(registrados).toHaveLength(1);
      expect(registrados[0].leido).toBeNull();
    });

    it('si la lectura falla, el comprobante se archiva igual', async () => {
      const { registrar, registrados, mensajes } = armar({ leido: null });
      await registrar('[el cliente envió una imagen]');
      expect(registrados).toHaveLength(1);
      expect(registrados[0].leido).toBeNull();
      expect(mensajes).toHaveLength(0);
    });

    it('sin nada que pagar todavía, la imagen ni se toca', async () => {
      // Archivar la foto de alguien sin motivo es guardar sus datos por nada.
      const { registrar, registrados, ia } = armar({ conBorrador: false });
      await registrar('[el cliente envió una imagen]');
      expect(registrados).toHaveLength(0);
      expect(ia.leerComprobantePago).not.toHaveBeenCalled();
    });
  });

  it('un comprobante a medio leer igual sirve: se cuenta lo que se pudo', async () => {
    // Capturas recortadas o de bancos raros: si al menos se lee el monto, eso
    // ya le permite al agente confirmar algo concreto.
    const { registrar, mensajes } = armar({
      leido: { esComprobante: true, monto: 45.5, numeroOperacion: null, fecha: null, medio: null, pagador: null },
    });
    await registrar('[el cliente envió una imagen]');
    expect(mensajes[0]).toMatch(/S\/ 45\.50/);
    expect(mensajes[0]).not.toMatch(/operación/);
  });
});
