/**
 * Lo que el primer cliente en producción echó en falta, en dos frases:
 * "No deriva a ofrecer más productos" y "sobre el registro sanitario aún no
 * se defiende para continuar el chat, lo derivó en una al supervisor".
 *
 * Los dos son el mismo tipo de error: la plantilla decía cuándo NO hacer algo
 * y nunca cuándo sí. "No insistas con complementos" sin un "ofrece una vez"
 * el modelo lo lee como "no ofrezcas"; y una lista de motivos de derivación
 * abierta ("úsala cuando…") la lee como ejemplos, así que ante una pregunta
 * que no sabe contestar pasa la conversación a una persona.
 *
 * Esto último es caro de verdad: derivar apaga el bot SIN vencimiento, así
 * que una pregunta por el registro sanitario dejaba al cliente esperando a
 * alguien que no sabía que lo esperaba — con la respuesta oficial ya cargada
 * en el contexto del negocio.
 */
import { promptDelAsesor } from './prompt-asesor';
import { HERRAMIENTAS_VENTA, HERRAMIENTA_DERIVAR } from './leads-herramientas';
import { MOTIVOS_DERIVACION, motivoDerivacionValido } from './pausa-bot';

const p = promptDelAsesor({
  nombre: 'Hierba Sana',
  rubro: 'productos naturales',
  asesor: 'Claudio',
  contexto: 'Tienda en el Mercado La Merced. Delivery en Lima S/ 15.',
});

describe('el asesor ofrece algo más, una vez', () => {
  it('tiene una regla que le dice CUÁNDO ofrecer, no solo cuándo callarse', () => {
    expect(p).toMatch(/ofrécele UNA vez algo que lo acompañe/i);
    // El momento importa: después del total el modelo ya cerró y no ofrece
    // nada. En el QA en vivo, sin esta línea, cotizaba de frente.
    expect(p).toMatch(/ANTES de pasarle el total/);
  });

  it('el complemento sale del catálogo y se justifica', () => {
    // Sin esto el modelo inventa el complemento o lo suelta sin razón, que es
    // justo lo que hace que el cliente lo sienta como relleno. Pasó en el QA
    // en vivo: se inventó un "Ajo Sacha" que no estaba en el catálogo.
    expect(p).toMatch(/otro producto del catálogo/i);
    expect(p).toMatch(/por qué va bien con lo que lleva/i);
    expect(p).toMatch(/inventarlo es peor que no ofrecerlo/i);
  });

  it('sigue prohibido insistir después de un no', () => {
    // La corrección no puede convertirlo en un bot pesado: el error más caro
    // de un bot de ventas no es vender de menos.
    expect(p).toMatch(/UNA sola vez/);
    expect(p).toMatch(/Si dice que no.*no vuelvas a ofrecer nada/s);
  });
});

describe('el asesor se defiende antes de pasar el problema', () => {
  it('las preguntas por permisos y certificaciones se responden', () => {
    expect(p).toMatch(/permisos, certificaciones, registros/i);
    expect(p).toMatch(/SE RESPONDEN con el contexto/);
  });

  it('si el contexto trae la respuesta oficial, esa es la respuesta', () => {
    // Hierba Sana ya tenía escrita la del registro sanitario; el modelo
    // derivaba igual.
    expect(p).toMatch(/respuesta oficial/i);
  });

  it('no tener el dato exacto no es motivo para derivar', () => {
    expect(p).toMatch(/no es motivo para pasar la conversación a otra persona/i);
  });

  it('la plantilla sigue sin mencionar a ningún cliente concreto', () => {
    // La regla de oro del módulo: si el prompt base nombra a Hierba Sana, el
    // siguiente cliente deja de ser onboarding y pasa a ser desarrollo.
    const generico = promptDelAsesor({ nombre: 'X', contexto: '' });
    for (const rastro of ['Hierba Sana', 'registro sanitario', 'naturista']) {
      expect(generico).not.toContain(rastro);
    }
  });
});

describe('la herramienta de derivar dice que su lista es cerrada', () => {
  const derivar = HERRAMIENTAS_VENTA.find(
    (h) => h.name === HERRAMIENTA_DERIVAR,
  )!;

  it('ya no es "úsala cuando" a secas', () => {
    expect(derivar.description).toContain('Úsala SOLO cuando');
    expect(derivar.description).toMatch(/lista es CERRADA/i);
  });

  it('nombra las preguntas que antes se derivaban y ahora se contestan', () => {
    expect(derivar.description).toMatch(
      /certificaciones, registros, permisos, composición, garantía/i,
    );
  });

  it('faltar el dato exacto tampoco alcanza', () => {
    expect(derivar.description).toMatch(/tampoco es motivo/i);
  });
});

describe('motivoDerivacionValido', () => {
  it('acepta los siete motivos reales', () => {
    for (const m of MOTIVOS_DERIVACION) {
      expect(motivoDerivacionValido(m)).toBe(m);
    }
  });

  it('acepta cómo los escribe el modelo de verdad', () => {
    // No vale rechazar una derivación buena por una tilde o un espacio.
    expect(motivoDerivacionValido('Reclamo')).toBe('reclamo');
    expect(motivoDerivacionValido('comprobante de pago')).toBe(
      'comprobante_de_pago',
    );
    expect(motivoDerivacionValido('seguimiento-de-pedido')).toBe(
      'seguimiento_de_pedido',
    );
    expect(motivoDerivacionValido('pide hablar con una persona')).toBe(
      'pide_hablar_con_persona',
    );
    expect(motivoDerivacionValido('quiere hablar con un asesor')).toBe(
      'pide_hablar_con_persona',
    );
  });

  it('rechaza los motivos que el modelo se inventa', () => {
    // Estos son los que apagaban el bot para siempre por una pregunta.
    for (const inventado of [
      'registro_sanitario',
      'consulta tecnica',
      'informacion_sanitaria',
      'duda del cliente',
      'sin motivo',
      '',
      null,
      undefined,
    ]) {
      expect(motivoDerivacionValido(inventado)).toBeNull();
    }
  });
});
