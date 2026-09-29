/**
 * Cuándo habla el bot de soporte y cuándo se calla.
 *
 * Las reglas de silencio importan más que las respuestas: un bot que se mete
 * encima de una persona, o que insiste después de que le pidieron un humano,
 * hace sentir al empresario que le pusieron una máquina para no atenderlo.
 */
import {
  MAX_RESPUESTAS_SEGUIDAS,
  MINUTOS_SILENCIO_TRAS_HUMANO,
  debeResponder,
  pideHumano,
} from './soporte-bot';
import { construirPromptSoporte, pidioEscalar } from './soporte-prompt';

describe('El bot se calla cuando corresponde', () => {
  it('contesta una consulta normal sin nadie más en la conversación', () => {
    expect(debeResponder('cómo emito una nota de crédito?', {}).responde).toBe(true);
  });

  it('se calla si le piden una persona', () => {
    for (const frase of [
      'quiero hablar con un humano',
      'pásame con una persona',
      'necesito un asesor',
      'no me estás entendiendo',
    ]) {
      const d = debeResponder(frase, {});
      expect(d.responde).toBe(false);
      expect(d.motivo).toBe('pidio-humano');
    }
  });

  it('reconoce el pedido aunque venga sin tildes o en mayúsculas', () => {
    expect(pideHumano('QUIERO UN HUMANO')).toBe(true);
    expect(pideHumano('pasame con una persona')).toBe(true);
  });

  it('se calla si alguien del equipo ya tomó la conversación', () => {
    const d = debeResponder('una consulta más', { asignadoAId: 7 });
    expect(d).toEqual({ responde: false, motivo: 'conversacion-tomada' });
  });

  it('se calla mientras una persona está respondiendo', () => {
    // Si alguien contestó hace 5 minutos, el empresario está hablando CON esa
    // persona: que el bot se meta arruina la conversación.
    const ahora = new Date('2026-09-28T15:00:00Z');
    const haceCinco = new Date('2026-09-28T14:55:00Z');
    const d = debeResponder('y otra cosa', { ultimoMensajeHumano: haceCinco }, ahora);
    expect(d).toEqual({ responde: false, motivo: 'humano-respondiendo' });
  });

  it('vuelve a contestar cuando pasó la ventana de silencio', () => {
    const ahora = new Date('2026-09-28T15:00:00Z');
    const viejo = new Date(ahora.getTime() - (MINUTOS_SILENCIO_TRAS_HUMANO + 1) * 60000);
    expect(debeResponder('hola', { ultimoMensajeHumano: viejo }, ahora).responde).toBe(true);
  });

  it('sigue contestando aunque ya haya respondido varias veces bien', () => {
    // Esto se rompió en la primera prueba real: el tope estaba en 3 y la
    // conversación moría en la cuarta pregunta, con el empresario hablándole
    // a la nada. Contestar muchas preguntas distintas es hacer el trabajo.
    for (const n of [1, 3, 5, 8]) {
      expect(
        debeResponder('otra consulta', { respuestasSeguidasDelBot: n }).responde,
      ).toBe(true);
    }
  });

  it('el tope solo corta un bucle largo, no una conversación normal', () => {
    // Queda como límite de gasto, no como medida de calidad.
    expect(MAX_RESPUESTAS_SEGUIDAS).toBeGreaterThanOrEqual(10);
    const d = debeResponder('y otra más', {
      respuestasSeguidasDelBot: MAX_RESPUESTAS_SEGUIDAS,
    });
    expect(d).toEqual({ responde: false, motivo: 'demasiadas-seguidas' });
  });

  it('se aparta si el empresario quedó esperando', () => {
    // "estás ahí?" significa que ya se rompió algo: otra respuesta automática
    // es lo último que necesita.
    for (const frase of ['estas ahi?', 'que paso?', 'hay alguien?', 'no me contestan']) {
      expect(debeResponder(frase, {}).motivo).toBe('pidio-humano');
    }
  });

  it('el pedido de humano gana sobre cualquier otra condición', () => {
    const d = debeResponder('quiero un humano', { respuestasSeguidasDelBot: 0 });
    expect(d.motivo).toBe('pidio-humano');
  });
});

describe('La señal de escalar', () => {
  it('reconoce la palabra sola, con adornos del modelo', () => {
    expect(pidioEscalar('ESCALAR')).toBe(true);
    expect(pidioEscalar('  ESCALAR  ')).toBe(true);
    expect(pidioEscalar('"ESCALAR"')).toBe(true);
    expect(pidioEscalar('**ESCALAR**')).toBe(true);
    expect(pidioEscalar('Escalar.')).toBe(true);
  });

  it('NO escala una respuesta buena que la mencione de pasada', () => {
    // Si no, una explicación válida se perdería y el empresario esperaría a
    // una persona por nada.
    expect(pidioEscalar('Si el problema sigue, se puede escalar al equipo.')).toBe(false);
    expect(pidioEscalar('Andá a Comprobantes → Crear comprobantes.')).toBe(false);
  });
});

describe('El prompt del asistente', () => {
  const prompt = construirPromptSoporte({
    marca: 'Krezka',
    horario: 'Lun a vie de 9:00 a 6:00 p.m.',
  });

  it('lleva la marca, el horario y el conocimiento, sin marcadores sueltos', () => {
    expect(prompt).toContain('Krezka');
    expect(prompt).toContain('Lun a vie de 9:00 a 6:00 p.m.');
    expect(prompt).toContain('Comprobantes → Crear comprobantes');
    expect(prompt).not.toMatch(/\{marca\}|\{horario\}|\{conocimiento\}/);
  });

  it('le prohíbe inventar pasos', () => {
    // Un bot de soporte que improvisa hace tocar donde no se debe en un
    // sistema de facturación.
    expect(prompt).toContain('No inventas pantallas');
  });

  it('le prohíbe pedir credenciales', () => {
    expect(prompt.toLowerCase()).toContain('no pides ni recibes contraseñas');
  });

  it('le prohíbe dar consejo tributario', () => {
    expect(prompt).toContain('No das consejo contable ni tributario');
  });

  it('dice que no es humano solo si se lo preguntan', () => {
    expect(prompt).toContain('SOLO lo aclaras si te preguntan');
  });

  it('le prohíbe abrir cada respuesta aclarando que es un bot', () => {
    // Lo hacía en casi todas: "No soy una persona, soy el asistente...".
    // Nadie se lo preguntó y quedaba raro en cada mensaje.
    expect(prompt).toContain('NUNCA empieces una respuesta aclarando que no eres humano');
  });

  it('le prohíbe mostrar URLs: el empresario navega con el menú', () => {
    expect(prompt).toContain('NUNCA escribes la URL');
    expect(prompt).toContain('CAMINO DEL MENÚ');
  });

  it('acepta reemplazar el conocimiento sin tocar el resto', () => {
    const otro = construirPromptSoporte({
      marca: 'Falconext', horario: 'x', conocimiento: 'SOLO ESTO',
    });
    expect(otro).toContain('SOLO ESTO');
    expect(otro).not.toContain('Comprobantes → Crear comprobantes');
  });
});
