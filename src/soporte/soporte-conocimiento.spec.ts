/**
 * Qué conocimiento se le manda al modelo en cada pregunta.
 *
 * El documento generado son ~29 KB. Mandarlo entero en cada mensaje es caro y
 * le diluye la atención al modelo entre cientos de líneas que no vienen al
 * caso; mandar de menos hace que escale consultas que podía responder.
 */
import { CONOCIMIENTO_GENERADO } from './conocimiento.generado';
import { CONOCIMIENTO_BASE } from './soporte-prompt';
import {
  MAX_AVISOS,
  conocimientoPara,
  palabrasClave,
  partirConocimiento,
} from './soporte-conocimiento';

const { fijo, avisos } = partirConocimiento(CONOCIMIENTO_GENERADO);

describe('El documento generado tiene lo que debe', () => {
  it('trae las pantallas del panel con su ruta', () => {
    expect(fijo).toContain('/administrador/facturacion/comprobantes');
    expect(fijo).toContain('/administrador/kardex/productos');
  });

  it('NO trae rutas del panel de resellers', () => {
    // Se colaban porque el árbol del reseller repite paths ("clientes") y el
    // bot terminaba nombrándole al empresario pantallas que no tiene.
    expect(CONOCIMIENTO_GENERADO).not.toContain('Reseller');
    expect(CONOCIMIENTO_GENERADO).not.toContain('/reseller/');
  });

  it('trae una cantidad de avisos que vale la pena', () => {
    expect(avisos.length).toBeGreaterThan(200);
  });

  it('no trae errores internos que el empresario no puede entender', () => {
    const texto = avisos.join('\n');
    expect(texto).not.toMatch(/no encontrad[oa]/i);
    expect(texto).not.toMatch(/\bId\b|payload|endpoint/);
  });
});

describe('Se elige solo lo que viene al caso', () => {
  const para = (p: string) => conocimientoPara(CONOCIMIENTO_GENERADO, p);

  it('las pantallas van siempre', () => {
    expect(para('cualquier cosa')).toContain('/administrador/facturacion/comprobantes');
  });

  it('una pregunta de comprobantes trae avisos de comprobantes', () => {
    const r = para('no me deja emitir una factura, que pasa?');
    expect(r).toMatch(/factura/i);
    expect(r.length).toBeLessThan(CONOCIMIENTO_GENERADO.length);
  });

  it('una pregunta de cotizaciones NO arrastra los avisos de facturación', () => {
    const r = para('por que no puedo eliminar una cotizacion?');
    expect(r).toMatch(/cotizaci/i);
  });

  it('manda muchísimo menos que el documento entero', () => {
    const r = para('no puedo emitir una boleta');
    // El punto del ejercicio: bajar de ~29 KB a algo que el modelo lea entero.
    expect(r.length).toBeLessThan(12000);
  });

  it('nunca manda más avisos que el tope', () => {
    // "producto" aparece en decenas: sin tope entrarían casi todos.
    const r = para('producto productos precio stock sede compra venta comprobante');
    const cuantos = r.split('\n').filter((l) => l.trim().startsWith('- "')).length;
    expect(cuantos).toBeLessThanOrEqual(MAX_AVISOS);
  });

  it('si nada coincide no inventa: manda solo las pantallas', () => {
    // Preferible que escale a que el modelo agarre un aviso al azar de 378 y
    // arme una respuesta sobre algo que no tiene que ver.
    const r = para('xyzzy qwerty zzzz');
    expect(r).toBe(fijo);
  });

  it('empareja singular con plural y familias de palabras', () => {
    expect(palabrasClave('comprobantes').map((p) => p.slice(0, 6)))
      .toEqual(palabrasClave('comprobante').map((p) => p.slice(0, 6)));
  });

  it('ignora tildes y mayúsculas, como escribe la gente', () => {
    const conTilde = para('no puedo emitir una factura electrónica');
    const sinTilde = para('no puedo emitir una factura electronica');
    expect(conTilde).toBe(sinTilde);
  });

  it('descarta las palabras que no distinguen nada', () => {
    // Sin esto, "como puedo hacer esto" traía avisos al azar.
    expect(palabrasClave('como puedo hacer esto para mi empresa')).toEqual([]);
  });
});

describe('Lo escrito a mano no se pierde al sumar lo generado', () => {
  // Pasó: reemplacé el conocimiento a mano por el del extractor y el bot dejó
  // de contestar cosas que ya sabía —"¿cómo importo productos desde Excel?"—
  // porque el código dice DÓNDE está cada pantalla, no CÓMO se usa.
  const conAmbos = (p: string) =>
    conocimientoPara(CONOCIMIENTO_GENERADO, p, undefined, CONOCIMIENTO_BASE);

  it('conserva el cómo, que el extractor no puede sacar del código', () => {
    const r = conAmbos('como importo productos desde excel?');
    expect(r).toContain('Herramientas');
  });

  it('conserva la ruta correcta de la rentabilidad', () => {
    // El extractor sabe que Análisis financiero existe; que ahí está la
    // rentabilidad por producto es conocimiento de negocio, escrito a mano.
    expect(conAmbos('donde veo la rentabilidad por producto?'))
      .toContain('Análisis financiero');
  });

  it('suma los avisos del extractor a lo escrito a mano', () => {
    const r = conAmbos('por que no me deja emitir factura si soy RUS?');
    expect(r).toMatch(/RUS/);
    expect(r).toContain('Comprobantes');
  });

  it('sin lo escrito a mano devuelve solo lo generado, como antes', () => {
    const solo = conocimientoPara(CONOCIMIENTO_GENERADO, 'comprobantes');
    expect(solo).not.toContain('Herramientas');
  });
});
