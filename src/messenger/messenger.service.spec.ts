import axios from 'axios';
import { MessengerService } from './messenger.service';
import { redirectPermitidoMessenger } from './messenger.controller';

jest.mock('axios');
const ax = axios as jest.Mocked<typeof axios>;

describe('MessengerService', () => {
  let prisma: any;
  let notificaciones: any;
  let svc: MessengerService;
  const redirect = 'https://app.krezka.com/administrador/messenger/callback';

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.FB_APP_ID = 'app';
    process.env.META_APP_SECRET = 'secreto';
    delete process.env.MESSENGER_GRAPH_URL;
    delete process.env.MESSENGER_REDIRECT_URIS;
    prisma = {
      empresa: {
        findUnique: jest.fn(async () => ({ facebookPageId: '1020', facebookPageToken: 'tok', facebookActivo: true, facebookErrorToken: null })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    notificaciones = { notificarAdminsEmpresa: jest.fn(async () => undefined) };
    svc = new MessengerService(prisma, notificaciones);
  });

  const tokens = () =>
    ax.get
      .mockResolvedValueOnce({ data: { access_token: 'corto' } })
      .mockResolvedValueOnce({ data: { access_token: 'largo' } });

  it('con una sola página la conecta de una vez y la suscribe a los mensajes', async () => {
    tokens().mockResolvedValueOnce({ data: { data: [{ id: '1020', name: 'Tienda Demo', access_token: 'pag' }] } });
    ax.post.mockResolvedValueOnce({ data: { success: true } });
    const r = await svc.conectar(7, 'CODE', redirect);
    expect(r).toEqual({ conectado: true, pagina: 'Tienda Demo' });
    expect(ax.post.mock.calls[0][0]).toMatch(/\/1020\/subscribed_apps$/);
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ facebookPageId: '1020', facebookPageToken: 'pag', facebookActivo: true, facebookErrorToken: null }),
    });
  });

  it('con varias páginas devuelve la lista (sin tokens) y conecta la elegida', async () => {
    tokens().mockResolvedValueOnce({
      data: { data: [{ id: '1', name: 'A', access_token: 'ta' }, { id: '2', name: 'B', access_token: 'tb' }] },
    });
    const r: any = await svc.conectar(7, 'CODE', redirect);
    expect(r.conectado).toBe(false);
    expect(r.paginas).toEqual([{ id: '1', nombre: 'A' }, { id: '2', nombre: 'B' }]);
    expect(JSON.stringify(r)).not.toMatch(/"ta"|"tb"/);

    // Otra empresa no puede usar la selección ajena.
    await expect(svc.elegirPagina(8, r.seleccion, '2')).rejects.toThrow(/venció/);
    ax.post.mockResolvedValueOnce({ data: { success: true } });
    expect(await svc.elegirPagina(7, r.seleccion, '2')).toEqual({ conectado: true, pagina: 'B' });
    expect(prisma.empresa.update.mock.calls[0][0].data).toMatchObject({ facebookPageId: '2', facebookPageToken: 'tb' });
    // Se usa una sola vez.
    await expect(svc.elegirPagina(7, r.seleccion, '2')).rejects.toThrow(/venció/);
  });

  it('una página de otra empresa no se puede robar', async () => {
    tokens().mockResolvedValueOnce({ data: { data: [{ id: '1020', name: 'X', access_token: 'pag' }] } });
    prisma.empresa.findFirst.mockResolvedValueOnce({ id: 99 });
    await expect(svc.conectar(7, 'CODE', redirect)).rejects.toMatchObject({ status: 409 });
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('envía texto con el token de la página y sin formato de WhatsApp', async () => {
    ax.post.mockResolvedValue({ data: {} });
    const r = await svc.enviarTexto('fb:888', '*Hola*', 7);
    expect(r.success).toBe(true);
    expect(ax.post.mock.calls[0][0]).toMatch(/\/1020\/messages$/);
    expect(ax.post.mock.calls[0][1]).toMatchObject({ recipient: { id: '888' }, message: { text: 'Hola' } });
    expect(ax.post.mock.calls[0][2]).toMatchObject({ params: { access_token: 'tok' } });
  });

  it('token anulado (190): marca la página y avisa', async () => {
    ax.post.mockRejectedValueOnce({ response: { data: { error: { code: 190, message: 'Session invalidated' } } } });
    const r = await svc.enviarTexto('fb:888', 'hola', 7);
    expect(r.success).toBe(false);
    expect(prisma.empresa.updateMany).toHaveBeenCalledWith({
      where: { id: 7, facebookErrorToken: null },
      data: { facebookErrorToken: 'Session invalidated' },
    });
    expect(notificaciones.notificarAdminsEmpresa).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Messenger se desconectó' }));
  });

  it('con MESSENGER_CONFIG_ID usa la configuración del login para empresas en vez de scope', () => {
    expect(svc.urlDeAutorizacion('https://x/administrador/messenger/callback', 's')).toMatch(/scope=pages_show_list/);
    process.env.MESSENGER_CONFIG_ID = 'cfg123';
    const url = svc.urlDeAutorizacion('https://x/administrador/messenger/callback', 's');
    delete process.env.MESSENGER_CONFIG_ID;
    expect(url).toMatch(/config_id=cfg123/);
    expect(url).not.toMatch(/scope=/);
  });

  it('solo vuelve a direcciones del panel (o a las configuradas)', () => {
    expect(redirectPermitidoMessenger(redirect)).toBe(true);
    expect(redirectPermitidoMessenger('https://malo.com/robar')).toBe(false);
  });
});
