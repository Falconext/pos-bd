import axios from 'axios';
import { InstagramService } from './instagram.service';
import { redirectPermitido } from './instagram.controller';

jest.mock('axios');
const ax = axios as jest.Mocked<typeof axios>;

describe('InstagramService', () => {
  let prisma: any;
  let svc: InstagramService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.INSTAGRAM_APP_ID = 'app';
    process.env.INSTAGRAM_APP_SECRET = 'secreto';
    delete process.env.INSTAGRAM_GRAPH_URL;
    delete process.env.INSTAGRAM_REDIRECT_URIS;
    prisma = {
      empresa: {
        findUnique: jest.fn(async () => ({ instagramAccountId: '178', instagramToken: 'tok', instagramActivo: true })),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
      },
    };
    svc = new InstagramService(prisma);
  });

  it('conecta: token largo, cuenta profesional (user_id), suscripción y guardado', async () => {
    ax.post.mockResolvedValueOnce({ data: { access_token: 'corto', user_id: 'app-scoped' } }); // oauth
    ax.get
      .mockResolvedValueOnce({ data: { access_token: 'largo', expires_in: 5184000 } }) // exchange
      .mockResolvedValueOnce({ data: { user_id: '17841400', username: 'tienda.demo', id: 'otro' } }); // /me
    ax.post.mockResolvedValueOnce({ data: { success: true } }); // subscribed_apps

    const r = await svc.conectar(7, 'CODE#_', 'https://app.krezka.com/administrador/instagram/callback');
    expect(r).toEqual({ conectado: true, usuario: 'tienda.demo' });
    expect(ax.post.mock.calls[0][1]).toMatch(/code=CODE$/); // sin el "#_" que agrega Instagram
    expect(ax.post.mock.calls[1][0]).toMatch(/\/me\/subscribed_apps$/);
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ instagramAccountId: '17841400', instagramToken: 'largo', instagramActivo: true, instagramUsername: 'tienda.demo' }),
    });
  });

  it('una cuenta ya conectada a otra empresa no se puede robar', async () => {
    ax.post.mockResolvedValueOnce({ data: { access_token: 'corto' } });
    ax.get
      .mockResolvedValueOnce({ data: { access_token: 'largo', expires_in: 100 } })
      .mockResolvedValueOnce({ data: { user_id: '17841400', username: 'x' } });
    prisma.empresa.findFirst.mockResolvedValueOnce({ id: 99 });
    await expect(svc.conectar(7, 'c', 'https://app.krezka.com/administrador/instagram/callback')).rejects.toMatchObject({ status: 409 });
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('si Instagram rechaza el código, explica por qué', async () => {
    ax.post.mockRejectedValueOnce({ response: { data: { error: { message: 'Invalid code' } } } });
    await expect(svc.conectar(7, 'c', 'https://a/administrador/instagram/callback')).rejects.toThrow(/Invalid code/);
  });

  it('un texto largo sale en varios mensajes y sin asteriscos', async () => {
    ax.post.mockResolvedValue({ data: {} });
    const largo = ['*Hola*', 'x'.repeat(900), 'y'.repeat(900)].join('\n\n');
    const r = await svc.enviarTexto('ig:555', largo, 7);
    expect(r.success).toBe(true);
    expect(ax.post).toHaveBeenCalledTimes(2);
    const primero = (ax.post.mock.calls[0][1] as any).message.text as string;
    expect(primero.startsWith('Hola')).toBe(true);
    expect((ax.post.mock.calls[0][1] as any).recipient).toEqual({ id: '555' });
  });

  it('sin Instagram conectado no intenta enviar y lo reporta', async () => {
    prisma.empresa.findUnique.mockResolvedValueOnce({ instagramActivo: false });
    const r = await svc.enviarTexto('ig:555', 'hola', 7);
    expect(r.success).toBe(false);
    expect(ax.post).not.toHaveBeenCalled();
  });

  it('renueva los tokens que vencen en menos de 15 días', async () => {
    prisma.empresa.findMany.mockResolvedValueOnce([{ id: 7, instagramToken: 'viejo' }]);
    ax.get.mockResolvedValueOnce({ data: { access_token: 'nuevo', expires_in: 5184000 } });
    const r = await svc.renovarTokens(new Date('2026-10-25T09:30:00Z'));
    expect(r.renovados).toBe(1);
    expect(ax.get.mock.calls[0][0]).toMatch(/refresh_access_token$/);
    expect(prisma.empresa.update).toHaveBeenCalledWith({ where: { id: 7 }, data: expect.objectContaining({ instagramToken: 'nuevo' }) });
  });

  it('solo vuelve a direcciones del panel (o a las configuradas)', () => {
    expect(redirectPermitido('https://app.krezka.com/administrador/instagram/callback')).toBe(true);
    expect(redirectPermitido('https://malo.com/robar')).toBe(false);
    process.env.INSTAGRAM_REDIRECT_URIS = 'https://app.krezka.com/administrador/instagram/callback';
    expect(redirectPermitido('https://otro.com/administrador/instagram/callback')).toBe(false);
  });
});
