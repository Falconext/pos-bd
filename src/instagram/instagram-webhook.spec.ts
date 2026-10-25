import { mensajesDeInstagram } from './instagram-webhook';

const evento = (message: any, sender = '555', cuenta = '178414') => ({
  object: 'instagram',
  entry: [{ id: cuenta, time: 1, messaging: [{ sender: { id: sender }, recipient: { id: cuenta }, timestamp: 1730000000000, message }] }],
});

describe('Instagram: webhook', () => {
  it('un texto queda listo para la cola, con el cliente como ig:<id>', () => {
    const [m] = mensajesDeInstagram(evento({ mid: 'm1', text: 'Hola, precio?' }));
    expect(m).toMatchObject({
      canal: 'INSTAGRAM',
      instagramAccountId: '178414',
      from: 'ig:555',
      messageId: 'ig:m1',
      text: 'Hola, precio?',
      esAudio: false,
      timestamp: '1730000000',
    });
  });

  it('los ecos (lo que manda la propia cuenta) se descartan: si no, el bot se contesta solo', () => {
    expect(mensajesDeInstagram(evento({ mid: 'm2', text: 'hola', is_echo: true }))).toEqual([]);
    expect(mensajesDeInstagram(evento({ mid: 'm3', text: 'hola' }, '178414'))).toEqual([]);
  });

  it('foto, audio y archivo traen la URL para bajarlos', () => {
    const foto = mensajesDeInstagram(evento({ mid: 'f', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] }))[0];
    expect(foto).toMatchObject({ esImagen: true, mediaId: 'https://cdn/x.jpg', text: '[el cliente envió una imagen]' });
    const audio = mensajesDeInstagram(evento({ mid: 'a', attachments: [{ type: 'audio', payload: { url: 'https://cdn/a.mp4' } }] }))[0];
    expect(audio).toMatchObject({ esAudio: true, text: '', mediaId: 'https://cdn/a.mp4' });
    const doc = mensajesDeInstagram(evento({ mid: 'd', attachments: [{ type: 'file', payload: { url: 'https://cdn/v.pdf' } }] }))[0];
    expect(doc).toMatchObject({ esDocumento: true, mediaId: 'https://cdn/v.pdf' });
  });

  it('lo que no es un mensaje no entra: leídos, borrados, stickers sin texto', () => {
    expect(mensajesDeInstagram({ object: 'instagram', entry: [{ id: '1', messaging: [{ sender: { id: '2' }, read: { mid: 'x' } }] }] })).toEqual([]);
    expect(mensajesDeInstagram(evento({ mid: 'b', is_deleted: true }))).toEqual([]);
    expect(mensajesDeInstagram(evento({ mid: 's', attachments: [{ type: 'like_heart' }] }))).toEqual([]);
  });

  it('un webhook de WhatsApp no se confunde con uno de Instagram', () => {
    expect(mensajesDeInstagram({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
  });
});
