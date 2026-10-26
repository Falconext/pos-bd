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

describe('Instagram: comentarios y Messenger', () => {
  const { comentariosDeInstagram, mensajesDeMessenger, comentarioCalza } = jest.requireActual('./instagram-webhook');

  const comentario = (value: any, cuenta = '178414') => ({
    object: 'instagram',
    entry: [{ id: cuenta, time: 1730000000, changes: [{ field: 'comments', value }] }],
  });

  it('un comentario entra a la cola con el autor como ig:<id> y la indicación para la IA', () => {
    const [m] = comentariosDeInstagram(
      comentario({ id: 'c1', text: 'precio?', from: { id: '555', username: 'ana' }, media: { id: 'p1' } }),
    );
    expect(m).toMatchObject({
      canal: 'INSTAGRAM',
      from: 'ig:555',
      messageId: 'igc:c1',
      comentarioId: 'c1',
      comentarioTexto: 'precio?',
      nombre: '@ana',
    });
    expect(m.text).toMatch(/UN solo mensaje privado/);
    // También sale por la función general del webhook.
    expect(mensajesDeInstagram(comentario({ id: 'c1', text: 'precio?', from: { id: '555' } }))).toHaveLength(1);
  });

  it('los comentarios de la propia cuenta (sus respuestas) no entran', () => {
    expect(comentariosDeInstagram(comentario({ id: 'c2', text: 'gracias!', from: { id: '178414' } }))).toEqual([]);
  });

  it('palabras clave: sin palabras valen todos; con palabras, sin importar tildes ni mayúsculas', () => {
    expect(comentarioCalza('lindo', null)).toBe(true);
    expect(comentarioCalza('¿Cuánto PRECIO tiene?', 'precio, info')).toBe(true);
    expect(comentarioCalza('Info por favor', 'informacion, INFO')).toBe(true);
    expect(comentarioCalza('😍😍', 'precio, info')).toBe(false);
  });

  it('Messenger: el cliente queda como fb:<id> y la empresa se ubica por la página', () => {
    const [m] = mensajesDeMessenger({
      object: 'page',
      entry: [{ id: '1020', messaging: [{ sender: { id: '888' }, recipient: { id: '1020' }, timestamp: 1730000000000, message: { mid: 'mm1', text: 'hola' } }] }],
    });
    expect(m).toMatchObject({ canal: 'MESSENGER', facebookPageId: '1020', from: 'fb:888', messageId: 'fb:mm1', text: 'hola' });
    expect(m.instagramAccountId).toBeUndefined();
    // Un webhook de página no se lee como Instagram ni al revés.
    expect(mensajesDeInstagram({ object: 'page', entry: [] })).toEqual([]);
    expect(mensajesDeMessenger({ object: 'instagram', entry: [] })).toEqual([]);
  });
});
