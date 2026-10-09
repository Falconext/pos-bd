/**
 * B4 — de una ficha del RAG al producto real.
 *
 * De la ficha solo interesa el código: su precio queda viejo en cuanto cambia
 * el catálogo, así que la ficha sirve para ENCONTRAR el producto, no para
 * cotizarlo. Si la extracción falla, la IA se queda sin responder dolencias.
 */
import { codigosDeFichas } from './leads-rag.service';

const FICHA = `100 PLANTAS - NATURAL MEDIX ( 100 CAPSULAS ) — S/ 30 (cód. PROD-0428)
Para qué sirve: Estimula la depuración linfática y hepática.
Actúa sobre: Colon, Páncreas | Sistema Inmune, Sistema Digestivo

36 PLANTAS - OASIS ( 100 CAPSULAS ) — S/ 30 (cód. PROD-0431)
Para qué sirve: Acelera la cicatrización interna de mucosas.
Actúa sobre: Hígado, Riñón | Sistema Urinario`;

describe('codigosDeFichas', () => {
  it('saca los códigos de una ficha real, en orden', () => {
    expect(codigosDeFichas([FICHA])).toEqual(['PROD-0428', 'PROD-0431']);
  });

  it('no repite un código que aparece en dos fragmentos', () => {
    expect(codigosDeFichas([FICHA, FICHA])).toEqual(['PROD-0428', 'PROD-0431']);
  });

  it('entiende "cod." sin tilde', () => {
    expect(codigosDeFichas(['Algo — S/ 10 (cod. PR001)'])).toEqual(['PR001']);
  });

  it('devuelve vacío si los fragmentos no traen códigos', () => {
    // Pasa con las fichas comerciales (horarios, pagos), que no son de producto.
    expect(codigosDeFichas(['Atendemos de 8am a 7pm.'])).toEqual([]);
    expect(codigosDeFichas([])).toEqual([]);
  });
});
