import {
  Limitador,
  armarHistorial,
  contextoDeProducto,
  esDestinoWeb,
  estaEscribiendo,
  sesionValida,
  sinContexto,
  textoValido,
} from './chat-web';
import { MensajeriaService } from './mensajeria.service';
import { decidirDestinatario } from './envios-masivos';

describe('chat de la tienda: reglas', () => {
  it('reconoce el destino web', () => {
    expect(esDestinoWeb('web:abc')).toBe(true);
    expect(esDestinoWeb('51987654321')).toBe(false);
    expect(esDestinoWeb('ig:1')).toBe(false);
  });

  it('acepta solo sesiones con forma de UUID', () => {
    expect(sesionValida('3F2A9C1E-1B2C-4D5E-8F90-1234567890AB')).toBe('3f2a9c1e-1b2c-4d5e-8f90-1234567890ab');
    expect(sesionValida('corta')).toBeNull();
    expect(sesionValida('a b c d e f g h i j k l m n o p')).toBeNull();
    expect(sesionValida("x'; drop table--aaaaaaaaaaaa")).toBeNull();
  });

  it('limpia y corta el texto', () => {
    expect(textoValido('  hola\u0007 ')).toBe('hola');
    expect(textoValido('   ')).toBeNull();
    expect(textoValido('a'.repeat(5000))!.length).toBe(1000);
    expect(textoValido('línea 1\nlínea 2')).toBe('línea 1\nlínea 2');
  });

  it('el contexto del producto se pega y se quita igual', () => {
    const ctx = contextoDeProducto({ descripcion: 'Polo negro', precioUnitario: 39.9, moneda: 'PEN' });
    expect(ctx).toBe('Está viendo en la tienda: Polo negro — S/39.90');
    expect(sinContexto(`¿tienen en M?\n\n[${ctx}]`)).toBe('¿tienen en M?');
  });

  it('historial ordenado, sin el contexto y con el id del navegador', () => {
    const t = (s: number) => new Date(1_000_000 + s * 1000);
    const h = armarHistorial(
      [{ id: 1, contenido: 'hola\n\n[Está viendo en la tienda: X — S/1.00]', whatsappMsgId: 'web:ses:abc-123', creadoEn: t(1) }],
      [
        { id: 9, tipo: 'TEXTO', texto: '¡Hola!', url: null, productoId: null, opcionesJson: null, creadoEn: t(2) },
        { id: 10, tipo: 'MENU', texto: '¿Qué buscas?', url: null, productoId: null, opcionesJson: [{ id: 'a', titulo: 'Polos' }], creadoEn: t(3) },
      ],
    );
    expect(h.map((x) => x.id)).toEqual(['u1', 's9', 's10']);
    expect(h[0]).toMatchObject({ de: 'cliente', texto: 'hola', clienteId: 'abc-123' });
    expect(h[2].opciones).toEqual([{ id: 'a', titulo: 'Polos' }]);
  });

  it('"escribiendo" mientras la IA no guardó su respuesta (aunque ya llegó una foto)', () => {
    const ahora = Date.now();
    const cliente = new Date(ahora - 5000);
    expect(estaEscribiendo(cliente, null, true, ahora)).toBe(true);
    expect(estaEscribiendo(cliente, new Date(ahora - 60_000), true, ahora)).toBe(true);
    expect(estaEscribiendo(cliente, new Date(ahora - 1000), true, ahora)).toBe(false);
    expect(estaEscribiendo(cliente, null, false, ahora)).toBe(false);
    expect(estaEscribiendo(new Date(ahora - 200_000), null, true, ahora)).toBe(false);
    expect(estaEscribiendo(null, null, true, ahora)).toBe(false);
  });

  it('limitador: corta pasado el tope y se recupera al pasar la ventana', () => {
    const l = new Limitador();
    for (let i = 0; i < 3; i++) expect(l.permitir('k', 3, 60_000, 1000 + i)).toBe(true);
    expect(l.permitir('k', 3, 60_000, 1010)).toBe(false);
    expect(l.permitir('k', 3, 60_000, 70_000)).toBe(true);
  });
});

describe('chat de la tienda: mensajería', () => {
  const wa = { enviarTexto: jest.fn(), enviarInteractivo: jest.fn() };
  const web = { registrar: jest.fn().mockResolvedValue({ success: true }) };
  const m = new MensajeriaService(wa as any, {} as any, {} as any, web as any);
  beforeEach(() => jest.clearAllMocks());

  it('lo enviado a web: queda guardado y no sale por WhatsApp', async () => {
    await m.enviarTexto('web:s1', 'hola', 7);
    expect(web.registrar).toHaveBeenCalledWith('web:s1', 7, { tipo: 'TEXTO', texto: 'hola' });
    expect(wa.enviarTexto).not.toHaveBeenCalled();
  });

  it('la foto de un producto lleva su id (botón de carrito)', async () => {
    await m.enviarImagenUrl('web:s1', 'https://x/p.webp', 'Polo — S/39.90', 7, { productoId: 55 });
    expect(web.registrar).toHaveBeenCalledWith('web:s1', 7, {
      tipo: 'IMAGEN',
      url: 'https://x/p.webp',
      texto: 'Polo — S/39.90',
      productoId: 55,
    });
  });

  it('el menú va con sus botones', async () => {
    await m.enviarMenu('web:s1', { cuerpo: '¿Qué buscas?', tipo: 'botones', boton: 'Ver', opciones: [{ id: 'a', titulo: 'Polos' }] }, 7);
    expect(web.registrar).toHaveBeenCalledWith('web:s1', 7, { tipo: 'MENU', texto: '¿Qué buscas?', opciones: [{ id: 'a', titulo: 'Polos' }] });
    expect(wa.enviarInteractivo).not.toHaveBeenCalled();
  });

  it('plantillas y notas de voz no van al chat de la tienda', async () => {
    expect((await m.enviarPlantilla('web:s1', 'x', 'es', [], 7)).success).toBe(false);
    expect((await m.enviarAudio('web:s1', Buffer.from(''), 7)).success).toBe(false);
  });

  it('envíos masivos no le escriben al chat de la tienda', () => {
    const d = decidirDestinatario({
      canal: 'WEB', interno: false, deBaja: false, marketingRecientes: 0, tope: 3,
      botPausado: false, ultimoMensajeDelCliente: new Date(), ahora: new Date(),
    });
    expect(d.enviar).toBe(false);
  });

  it('WhatsApp sigue igual', async () => {
    wa.enviarTexto.mockResolvedValue({ success: true });
    await m.enviarTexto('51987654321', 'hola', 7);
    expect(wa.enviarTexto).toHaveBeenCalledWith('51987654321', 'hola', 7);
    expect(web.registrar).not.toHaveBeenCalled();
  });
});
