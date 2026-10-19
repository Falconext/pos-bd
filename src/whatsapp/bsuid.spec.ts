import { esBsuid } from './whatsapp.service';

describe('BSUID vs teléfono', () => {
  it('reconoce el id de usuario de WhatsApp', () => {
    expect(esBsuid('PE.13491208655302741918')).toBe(true);
    expect(esBsuid('US.ENT.11815799212886844830')).toBe(true);
  });
  it('un teléfono no es BSUID', () => {
    expect(esBsuid('51991065217')).toBe(false);
    expect(esBsuid('+51 991 065 217')).toBe(false);
    expect(esBsuid(null)).toBe(false);
  });
});

import axios from 'axios';
import { WhatsAppService } from './whatsapp.service';

describe('enviar a un usuario sin número', () => {
  it('usa `recipient` con el BSUID entero, y `to` con un teléfono', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: {} } as any);
    const config = { get: (k: string) => (k.includes('TOKEN') ? 't' : k.includes('PHONE') ? 'p' : undefined) };
    const s = new WhatsAppService({} as any, config as any);
    jest.spyOn(s as any, 'getCredentials').mockReturnValue({ token: 't', phoneId: 'p' });

    await s.enviarTexto('PE.13491208655302741918', 'hola');
    await s.enviarTexto('991065217', 'hola');

    const [a, b] = post.mock.calls.map((c) => c[1] as any);
    expect(a.recipient).toBe('PE.13491208655302741918');
    expect(a.to).toBeUndefined();
    expect(b.to).toBe('51991065217');
    expect(b.recipient).toBeUndefined();
    post.mockRestore();
  });
});
