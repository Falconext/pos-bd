/**
 * Nota de voz del panel: se sube a la Media API y se manda por id con
 * `voice: true`; sin eso WhatsApp la muestra como un archivo de audio.
 */
import axios from 'axios';
import { WhatsAppService } from './whatsapp.service';

jest.mock('axios');
const post = axios.post as jest.Mock;

function servicio(): WhatsAppService {
  const s = new WhatsAppService({} as never, { get: () => undefined } as never);
  (s as any).getCredentialsForEmpresa = jest.fn().mockResolvedValue({ token: 'T', phoneId: 'P1' });
  return s;
}

describe('enviarAudio', () => {
  beforeEach(() => post.mockReset());

  it('sube el OGG y lo manda como nota de voz', async () => {
    post.mockResolvedValueOnce({ data: { id: 'MEDIA-9' } }).mockResolvedValueOnce({ data: {} });
    const r = await servicio().enviarAudio('51991065217', Buffer.from('OggS'), 89);

    expect(r).toEqual({ success: true });
    expect(post.mock.calls[0][0]).toMatch(/\/P1\/media$/);
    const [url, cuerpo] = post.mock.calls[1];
    expect(url).toMatch(/\/P1\/messages$/);
    expect(cuerpo).toMatchObject({ type: 'audio', audio: { id: 'MEDIA-9', voice: true } });
  });

  it('si Meta rechaza, lo dice y no lanza', async () => {
    post.mockRejectedValueOnce({ response: { data: { error: { message: 'Re-engagement message' } } } });
    const r = await servicio().enviarAudio('51991065217', Buffer.from('OggS'), 89);
    expect(r).toEqual({ success: false, error: 'Re-engagement message' });
  });

  it('sin id de la subida no manda nada', async () => {
    post.mockResolvedValueOnce({ data: {} });
    const r = await servicio().enviarAudio('51991065217', Buffer.from('OggS'), 89);
    expect(r.success).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
