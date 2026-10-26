import { MensajeriaService } from './mensajeria.service';

describe('MensajeriaService: por dónde sale cada mensaje', () => {
  const wa = {
    enviarTexto: jest.fn(async () => ({ success: true })),
    enviarImagenUrl: jest.fn(async () => ({ success: true })),
    enviarPlantilla: jest.fn(async () => ({ success: true })),
    enviarAudio: jest.fn(async () => ({ success: true })),
    enviarDocumentoUrl: jest.fn(async () => ({ success: true })),
    descargarMedia: jest.fn(async () => ({ buffer: Buffer.from(''), mimeType: 'x' })),
  };
  const ig = {
    enviarTexto: jest.fn(async () => ({ success: true })),
    enviarAdjunto: jest.fn(async () => ({ success: true })),
    descargarAdjunto: jest.fn(async () => ({ buffer: Buffer.from(''), mimeType: 'image/jpeg' })),
    perfil: jest.fn(async () => ({ usuario: 'cliente' })),
  };
  const m = new MensajeriaService(wa as any, ig as any);
  beforeEach(() => jest.clearAllMocks());

  it('un teléfono sigue por WhatsApp, igual que antes', async () => {
    await m.enviarTexto('51987654321', 'hola', 7);
    expect(wa.enviarTexto).toHaveBeenCalledWith('51987654321', 'hola', 7);
    expect(ig.enviarTexto).not.toHaveBeenCalled();
  });

  it('un @nick de WhatsApp (BSUID) también sigue por WhatsApp', async () => {
    await m.enviarTexto('PE.abc123', 'hola', 7);
    expect(wa.enviarTexto).toHaveBeenCalled();
  });

  it('ig:<id> sale por Instagram', async () => {
    await m.enviarTexto('ig:555', 'hola', 7);
    await m.enviarImagenUrl('ig:555', 'https://s3/foto.jpg', 'Así es', 7);
    expect(ig.enviarTexto).toHaveBeenCalledWith('ig:555', 'hola', 7);
    expect(ig.enviarAdjunto).toHaveBeenCalledWith('ig:555', 'image', 'https://s3/foto.jpg', 'Así es', 7);
    expect(wa.enviarTexto).not.toHaveBeenCalled();
  });

  it('en Instagram no hay plantillas: no sale y lo dice', async () => {
    const r = await m.enviarPlantilla('ig:555', 'recompra_25', 'es', [], 7);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Instagram no tiene plantillas/);
    expect(wa.enviarPlantilla).not.toHaveBeenCalled();
  });

  it('un documento por Instagram va como enlace', async () => {
    await m.enviarDocumentoUrl('ig:555', 'https://s3/brochure.pdf', 'Catálogo.pdf', 'Te paso el catálogo', 7);
    expect(ig.enviarTexto).toHaveBeenCalledWith('ig:555', 'Te paso el catálogo\n\nCatálogo.pdf: https://s3/brochure.pdf', 7);
  });

  it('una nota de voz desde el panel por Instagram avisa en vez de fallar mudo', async () => {
    const r = await m.enviarAudio('ig:555', Buffer.from('x'), 7);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/notas de voz/);
  });

  it('el adjunto de Instagram (URL) se baja directo; el de WhatsApp (id) por WhatsApp', async () => {
    await m.descargarMedia('https://lookaside.fbsbx.com/x', 7);
    await m.descargarMedia('1234567890', 7);
    expect(ig.descargarAdjunto).toHaveBeenCalledWith('https://lookaside.fbsbx.com/x');
    expect(wa.descargarMedia).toHaveBeenCalledWith('1234567890', 7);
  });
});
