import { comentarioTiktokCalza, limpiarClaves, MAX_RESPUESTA_TIKTOK, numeroParaMostrar, respuestaParaTiktok, soloDigitos } from './tiktok-texto';

describe('respuestaParaTiktok', () => {
  it('deja una sola línea sin formato de WhatsApp ni comillas', () => {
    expect(respuestaParaTiktok('"¡Hola! *Sí* tenemos\n\nescríbenos 😊"')).toBe('¡Hola! Sí tenemos escríbenos 😊');
  });

  it('corta en una palabra y nunca pasa de 150', () => {
    const largo = 'Hola, sí tenemos ese modelo disponible en varias tallas y colores, '.repeat(5);
    const r = respuestaParaTiktok(largo);
    expect(Array.from(r).length).toBeLessThanOrEqual(MAX_RESPUESTA_TIKTOK);
    expect(r.endsWith('…')).toBe(true);
    expect(r).not.toMatch(/\s…$/);
  });

  it('lo corto queda igual', () => {
    expect(respuestaParaTiktok('Sí, escríbenos al WhatsApp 987654321 😊')).toBe('Sí, escríbenos al WhatsApp 987654321 😊');
  });
});

describe('comentarioTiktokCalza', () => {
  it('sin palabras clave responde todo lo que tenga texto', () => {
    expect(comentarioTiktokCalza('lindo!', null)).toBe(true);
    expect(comentarioTiktokCalza('   ', null)).toBe(false);
  });

  it('con palabras clave, sin importar mayúsculas ni tildes', () => {
    expect(comentarioTiktokCalza('¿PRECIO por favor?', 'precio, info')).toBe(true);
    expect(comentarioTiktokCalza('más información', 'informacion')).toBe(true);
    expect(comentarioTiktokCalza('qué bonito', 'precio, info')).toBe(false);
  });

  it('limpia las palabras para guardar', () => {
    expect(limpiarClaves(' precio,, info ,')).toBe('precio, info');
    expect(limpiarClaves('  ')).toBeNull();
  });
});

describe('número de WhatsApp', () => {
  it('se guarda en dígitos y se muestra como en Perú', () => {
    expect(soloDigitos('+51 991 065 217')).toBe('51991065217');
    expect(soloDigitos('  ')).toBeNull();
    expect(numeroParaMostrar('51991065217')).toBe('991 065 217');
    expect(numeroParaMostrar('991065217')).toBe('991 065 217');
  });
});
