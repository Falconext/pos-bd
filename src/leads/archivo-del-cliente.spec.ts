/**
 * La foto o el PDF del cliente, leído y contado al modelo (21-10).
 *
 * Lo que se defiende:
 *   1. que la captura de una publicación llegue al modelo como el nombre del
 *      producto, con la orden de buscarlo en el catálogo (precio real, no el
 *      de la imagen);
 *   2. que un PDF se lea igual que una foto, y un .docx no se intente;
 *   3. que el voucher siga yendo por su camino y no se lea dos veces;
 *   4. que si la lectura falla, el mensaje quede como estaba.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsMessageProcessor } from './leads-message.processor';
import {
  MAX_ARCHIVO_IA_BYTES,
  contenidoConLectura,
  esArchivoLegible,
  parsearLectura,
  textoDelCliente,
} from './archivo-del-cliente';

describe('contenidoConLectura', () => {
  it('la captura de una publicación llega como el producto, con la orden de buscarlo', () => {
    const c = contenidoConLectura('[el cliente envió una imagen] precio?', {
      tipo: 'producto',
      productos: ['Moringa 500 mg Aurelys, 100 cápsulas'],
      resumen: 'publicación de Facebook',
    })!;
    expect(c).toMatch(/^\[el cliente envió una imagen con este producto: Moringa 500 mg Aurelys/);
    expect(c).toMatch(/buscar_productos/);
    expect(c).toMatch(/precio y la disponibilidad del catálogo, no con lo que diga la imagen/);
    expect(c).toMatch(/precio\?$/);
  });

  it('varios productos van todos', () => {
    const c = contenidoConLectura('[el cliente envió una imagen]', {
      tipo: 'producto',
      productos: ['Moringa', 'Uña de gato'],
      resumen: '',
    })!;
    expect(c).toMatch(/estos productos: Moringa; Uña de gato\./);
  });

  it('un PDF dice que es un documento, con su nombre', () => {
    const c = contenidoConLectura('[el cliente envió un documento: receta.pdf]', {
      tipo: 'receta',
      productos: ['Omega 3'],
      resumen: 'receta del Dr. X: omega 3 cada 12 horas',
    })!;
    expect(c).toMatch(/^\[el cliente envió un documento: receta\.pdf con una receta/);
    expect(c).toMatch(/Omega 3/);
    expect(c).toMatch(/no des indicaciones médicas/);
  });

  it('una foto cualquiera solo se describe', () => {
    const c = contenidoConLectura('[el cliente envió una imagen]', {
      tipo: 'otro',
      productos: [],
      resumen: 'un sticker de un perro',
    });
    expect(c).toBe('[el cliente envió una imagen: un sticker de un perro]');
  });

  it('sin lectura, o lectura vacía, no se toca el mensaje', () => {
    expect(contenidoConLectura('[el cliente envió una imagen]', null)).toBeNull();
    expect(
      contenidoConLectura('[el cliente envió una imagen]', { tipo: 'otro', productos: [], resumen: '  ' }),
    ).toBeNull();
  });
});

describe('utilidades', () => {
  it('se leen fotos y PDF, no Word ni Excel', () => {
    expect(esArchivoLegible('image/jpeg')).toBe(true);
    expect(esArchivoLegible('application/pdf')).toBe(true);
    expect(esArchivoLegible('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
    expect(esArchivoLegible(undefined)).toBe(false);
  });

  it('textoDelCliente quita la marca del sistema, sea imagen o documento', () => {
    expect(textoDelCliente('[el cliente envió una imagen] ya pagué')).toBe('ya pagué');
    expect(textoDelCliente('[el cliente envió un documento: a.pdf]')).toBe('');
    expect(textoDelCliente(undefined)).toBe('');
  });

  it('parsearLectura tolera markdown y descarta tipos inventados', () => {
    expect(parsearLectura('```json\n{"tipo":"producto","productos":["A",""],"resumen":"x"}\n```')).toEqual({
      tipo: 'producto',
      productos: ['A'],
      resumen: 'x',
    });
    expect(parsearLectura('{"tipo":"meme","productos":"no","resumen":1}')).toEqual({
      tipo: 'otro',
      productos: [],
      resumen: '1',
    });
    expect(parsearLectura('no es json')).toBeNull();
  });
});

describe('el procesador', () => {
  function armar(opts: { lectura?: any; mimeType?: string; size?: number; descarga?: 'falla' } = {}) {
    const mensajes: string[] = [];
    const prisma: any = {
      leadMensaje: {
        update: jest.fn((a: any) => {
          mensajes.push(a.data.contenido);
          return Promise.resolve({});
        }),
      },
      leadPedidoBorrador: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const whatsapp: any = {
      descargarMedia:
        opts.descarga === 'falla'
          ? jest.fn().mockRejectedValue(new Error('404'))
          : jest.fn().mockResolvedValue({
              buffer: Buffer.alloc(opts.size ?? 10),
              mimeType: opts.mimeType ?? 'image/jpeg',
            }),
    };
    const ia: any = {
      disponible: () => true,
      leerComprobantePago: jest.fn(),
      leerArchivoDelCliente: jest.fn().mockResolvedValue(
        'lectura' in opts ? opts.lectura : { tipo: 'producto', productos: ['Moringa Aurelys'], resumen: '' },
      ),
    };
    const p = new LeadsMessageProcessor(
      prisma, ia, {} as never, whatsapp, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    ) as any;
    const d = { from: '51987654321', mediaId: 'm1', esImagen: true, text: '[el cliente envió una imagen]' };
    const leer = async () => p.leerArchivoDelCliente(d, 9, await p.bajarArchivo(89, d));
    return { p, d, leer, mensajes, ia, whatsapp };
  }

  it('reescribe el mensaje con el producto leído', async () => {
    const { leer, mensajes } = armar();
    await leer();
    expect(mensajes[0]).toMatch(/este producto: Moringa Aurelys/);
  });

  it('un PDF también se lee', async () => {
    const { leer, ia } = armar({ mimeType: 'application/pdf' });
    await leer();
    expect(ia.leerArchivoDelCliente).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf');
  });

  it('un Word no se manda a la IA', async () => {
    const { leer, ia, mensajes } = armar({ mimeType: 'application/msword' });
    await leer();
    expect(ia.leerArchivoDelCliente).not.toHaveBeenCalled();
    expect(mensajes).toHaveLength(0);
  });

  it('un archivo demasiado grande no se manda', async () => {
    const { leer, ia } = armar({ size: MAX_ARCHIVO_IA_BYTES + 1 });
    await leer();
    expect(ia.leerArchivoDelCliente).not.toHaveBeenCalled();
  });

  it('si no se pudo bajar o leer, el mensaje queda como estaba', async () => {
    const a = armar({ descarga: 'falla' });
    await a.leer();
    expect(a.mensajes).toHaveLength(0);
    const b = armar({ lectura: null });
    await b.leer();
    expect(b.mensajes).toHaveLength(0);
  });

  it('el voucher usa el archivo ya bajado: no se descarga dos veces', async () => {
    const { p, d, whatsapp } = armar();
    const archivo = await p.bajarArchivo(89, d);
    p.prisma.leadPedidoBorrador.findUnique.mockResolvedValue({ cotizacionId: 5, comprobanteId: null });
    p.ia.leerComprobantePago.mockResolvedValue({ esComprobante: false });
    p.embudo = { registrarComprobantePago: jest.fn().mockResolvedValue({}) };
    const esVoucher = await p.registrarVoucherSiCorresponde(89, 1, d, 9, archivo);
    expect(esVoucher).toBe(false);
    expect(whatsapp.descargarMedia).toHaveBeenCalledTimes(1);
  });

  it('si era el voucher, lo dice para no leerlo otra vez como producto', async () => {
    const { p, d } = armar();
    const archivo = await p.bajarArchivo(89, d);
    p.prisma.leadPedidoBorrador.findUnique.mockResolvedValue({ cotizacionId: 5, comprobanteId: null });
    p.ia.leerComprobantePago.mockResolvedValue({ esComprobante: true, monto: 30, medio: 'Yape' });
    p.embudo = { registrarComprobantePago: jest.fn().mockResolvedValue({}) };
    p.pedido = { configDe: jest.fn().mockResolvedValue({}) };
    p.prisma.empresa = { findUnique: jest.fn().mockResolvedValue({ iaVentasContexto: '' }) };
    expect(await p.registrarVoucherSiCorresponde(89, 1, d, 9, archivo)).toBe(true);
  });
});
