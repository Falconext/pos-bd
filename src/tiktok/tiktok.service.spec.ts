import { TiktokApiError, TiktokService } from './tiktok.service';

/**
 * El flujo de comentarios contra una API de TikTok simulada y una base en
 * memoria: qué se responde, qué no, y que dos procesos no respondan dos veces.
 */
describe('TiktokService · comentarios', () => {
  const AHORA = Math.floor(new Date('2026-11-01T15:00:00Z').getTime() / 1000);

  function armar(comentarios: any[], opts: { clave?: string | null; errorEnLista?: TiktokApiError } = {}) {
    const filas: any[] = [];
    const empresa: any = {
      tiktokOpenId: 'biz-1',
      tiktokToken: 'tok',
      tiktokComentariosClave: opts.clave ?? null,
      tiktokComentariosDesde: new Date((AHORA - 600) * 1000),
      razonSocial: 'TIENDA SAC',
      nombreComercial: 'Tienda',
      iaVentasContexto: 'Vendemos zapatillas.',
      iaVentasConfigJson: {},
      whatsappTienda: '987 654 321',
      rubro: { nombre: 'Calzado' },
    };
    const prisma: any = {
      empresa: {
        findUnique: jest.fn(async () => empresa),
        findMany: jest.fn(async () => [{ id: 5 }]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      tiktokComentario: {
        create: jest.fn(async ({ data }: any) => {
          if (filas.some((f) => f.empresaId === data.empresaId && f.comentarioId === data.comentarioId)) {
            throw Object.assign(new Error('unique'), { code: 'P2002' });
          }
          const fila = { id: filas.length + 1, ...data, estado: 'PENDIENTE' };
          filas.push(fila);
          return { id: fila.id };
        }),
        update: jest.fn(async ({ where, data }: any) => Object.assign(filas.find((f) => f.id === where.id), data)),
      },
    };
    const gemini: any = {
      isEnabled: () => true,
      chatConHistorial: jest.fn(async () => '"¡Hola! Sí tenemos tallas, escríbenos al WhatsApp 987654321 😊"'),
    };
    const servicio = new TiktokService(prisma, gemini);
    const publicadas: any[] = [];
    jest.spyOn(servicio as any, 'llamar').mockImplementation(async (_m: any, ruta: any, o: any) => {
      if (ruta === 'business/video/list/') return { videos: [{ item_id: 'v1', comments: comentarios.length }] };
      if (ruta === 'business/comment/list/') {
        if (opts.errorEnLista) throw opts.errorEnLista;
        return { comments: comentarios };
      }
      if (ruta === 'business/comment/reply/create/') {
        publicadas.push(o.body);
        return { comment_id: 'r' + publicadas.length };
      }
      throw new Error('ruta inesperada ' + ruta);
    });
    return { servicio, prisma, gemini, filas, publicadas };
  }

  const c = (id: string, text: string, extra: any = {}) => ({ comment_id: id, text, create_time: AHORA - 60, username: 'ana', ...extra });

  beforeAll(() => {
    process.env.TIKTOK_APP_ID = 'app';
    process.env.TIKTOK_APP_SECRET = 'secret';
  });

  it('responde los nuevos y deja registro', async () => {
    const { servicio, publicadas, filas } = armar([c('c1', '¿precio?')]);
    expect(await servicio.revisarEmpresa(5)).toBe(1);
    expect(publicadas).toEqual([
      { business_id: 'biz-1', video_id: 'v1', comment_id: 'c1', text: '¡Hola! Sí tenemos tallas, escríbenos al WhatsApp 987654321 😊' },
    ]);
    expect(filas[0]).toMatchObject({ estado: 'RESPONDIDO', autor: '@ana' });
  });

  it('no responde lo viejo, lo propio, las respuestas ni lo que no calza con la clave', async () => {
    const { servicio, publicadas } = armar(
      [
        c('viejo', 'precio', { create_time: AHORA - 3600 }),
        c('mio', 'precio', { owner: true }),
        c('resp', 'precio', { parent_comment_id: 'c0' }),
        c('nada', 'qué bonito'),
        c('si', 'PRECIO?'),
      ],
      { clave: 'precio' },
    );
    expect(await servicio.revisarEmpresa(5)).toBe(1);
    expect(publicadas.map((p) => p.comment_id)).toEqual(['si']);
  });

  it('dos procesos a la vez responden una sola vez', async () => {
    const { servicio, prisma, gemini, publicadas } = armar([c('c1', 'info')]);
    const otro = new TiktokService(prisma, gemini);
    jest.spyOn(otro as any, 'llamar').mockImplementation((servicio as any).llamar);
    await Promise.all([servicio.revisarEmpresa(5), otro.revisarEmpresa(5)]);
    expect(publicadas).toHaveLength(1);
  });

  it('una segunda vuelta no repite', async () => {
    const { servicio, publicadas } = armar([c('c1', 'info')]);
    await servicio.revisarEmpresa(5);
    await servicio.revisarEmpresa(5);
    expect(publicadas).toHaveLength(1);
  });

  it('token anulado: marca la cuenta para reconectar', async () => {
    const { servicio, prisma } = armar([], { errorEnLista: undefined });
    (servicio as any).llamar.mockImplementation(async () => {
      throw new TiktokApiError('Access token is invalid', 40105);
    });
    await expect(servicio.revisarEmpresa(5)).rejects.toThrow('invalid');
    expect(prisma.empresa.updateMany).toHaveBeenCalledWith({
      where: { id: 5, tiktokErrorToken: null },
      data: { tiktokErrorToken: 'Access token is invalid' },
    });
  });

  it('si TikTok rechaza la respuesta queda como ERROR y no se reintenta', async () => {
    const { servicio, filas } = armar([c('c1', 'info')]);
    (servicio as any).llamar.mockImplementation(async (_m: any, ruta: string) => {
      if (ruta === 'business/video/list/') return { videos: [{ item_id: 'v1', comments: 1 }] };
      if (ruta === 'business/comment/list/') return { comments: [c('c1', 'info')] };
      throw new TiktokApiError('comment closed', 40002);
    });
    expect(await servicio.revisarEmpresa(5)).toBe(0);
    expect(filas[0]).toMatchObject({ estado: 'ERROR', error: 'comment closed' });
  });

  describe('el WhatsApp que da la IA', () => {
    const conEmpresa = (e: any) => {
      const prisma: any = { empresa: { findUnique: jest.fn(async () => e) } };
      return new TiktokService(prisma, { isEnabled: () => true, chatConHistorial: jest.fn(async () => 'ok') } as any);
    };

    it('primero el de la tarjeta de TikTok, después el de la tienda, después el conectado', async () => {
      expect(await conEmpresa({ tiktokWhatsapp: '999 111 222', whatsappTienda: '988', numerosWhatsapp: [] }).whatsappParaInvitar(1)).toBe('999111222');
      expect(await conEmpresa({ tiktokWhatsapp: null, whatsappTienda: '988 777 666', numerosWhatsapp: [] }).whatsappParaInvitar(1)).toBe('988777666');
      expect(await conEmpresa({ tiktokWhatsapp: null, whatsappTienda: null, numerosWhatsapp: [{ numeroVisible: '+51 991 065 217' }] }).whatsappParaInvitar(1)).toBe('51991065217');
      expect(await conEmpresa({ tiktokWhatsapp: null, whatsappTienda: null, numerosWhatsapp: [] }).whatsappParaInvitar(1)).toBeNull();
    });

    it('sin número no invita a mensaje directo: manda al enlace del perfil', async () => {
      const s = conEmpresa({ razonSocial: 'K', iaVentasConfigJson: {}, tiktokWhatsapp: null, whatsappTienda: null, numerosWhatsapp: [] });
      await s.generarRespuesta(1, 'precio?');
      const prompt = ((s as any).gemini.chatConHistorial as jest.Mock).mock.calls[0][0];
      expect(prompt).toContain('enlace del perfil');
      expect(prompt).toContain('No invites a escribir por mensaje directo');
    });

    it('con número, lo da como se lee en Perú', async () => {
      const s = conEmpresa({ razonSocial: 'K', iaVentasConfigJson: {}, tiktokWhatsapp: '51991065217', numerosWhatsapp: [] });
      await s.generarRespuesta(1, 'precio?');
      expect(((s as any).gemini.chatConHistorial as jest.Mock).mock.calls[0][0]).toContain('WhatsApp 991 065 217');
    });
  });
});
