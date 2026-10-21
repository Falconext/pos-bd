/**
 * La foto o el PDF que manda el cliente, contado en palabras al modelo.
 *
 * El agente de ventas solo lee texto. Cuando el cliente mandaba la captura de
 * una publicación ("¿precio?") o la foto de un frasco, el modelo veía
 * "[el cliente envió una imagen]" y le pedía que escribiera el nombre: justo
 * lo que el cliente quería evitar. Lo mismo con un PDF de receta o de lista.
 *
 * Se lee una vez, al llegar, y lo leído se escribe en el propio mensaje —como
 * ya se hace con el voucher—, así el modelo busca el producto con
 * buscar_productos y responde con el precio real del catálogo.
 */

export interface ArchivoDelCliente {
  buffer: Buffer;
  mimeType: string;
}

export interface LecturaDeArchivo {
  /** producto: foto o captura de uno o más productos. */
  tipo: 'producto' | 'receta' | 'documento' | 'otro';
  /** Nombre como se lee (con marca y presentación si aparecen). */
  productos: string[];
  /** Una o dos frases de lo que hay; en un PDF, lo que pide o dice. */
  resumen: string;
}

/** Más grande que esto no se le manda a la IA (el límite en línea es 20 MB). */
export const MAX_ARCHIVO_IA_BYTES = 15 * 1024 * 1024;

/** Lo que Gemini sabe leer: fotos y PDF. Un .docx o un .xlsx no. */
export function esArchivoLegible(mimeType: string | null | undefined): boolean {
  const m = (mimeType ?? '').toLowerCase();
  return m.startsWith('image/') || m === 'application/pdf';
}

/** Lo que escribió el cliente junto al archivo, sin la marca del sistema. */
export function textoDelCliente(texto: string | null | undefined): string {
  return (texto ?? '').replace(/^\[el cliente envió [^\]]*\]/, '').trim();
}

/**
 * El mensaje del cliente con lo que se leyó, o null si no hay nada que
 * agregar (lectura fallida o vacía): el mensaje se deja como estaba.
 */
export function contenidoConLectura(
  textoOriginal: string | null | undefined,
  lectura: LecturaDeArchivo | null,
): string | null {
  if (!lectura) return null;
  const productos = lectura.productos.map((p) => p.trim()).filter(Boolean);
  const resumen = lectura.resumen.trim();
  if (!productos.length && !resumen) return null;

  const marca = /^\[el cliente envió ([^\]]*)\]/.exec(textoOriginal ?? '')?.[1];
  const queEs = marca?.startsWith('un documento') ? marca : 'una imagen';
  let lectura_ = '';
  if (lectura.tipo === 'producto' && productos.length) {
    lectura_ =
      `[el cliente envió ${queEs} con ${productos.length > 1 ? 'estos productos' : 'este producto'}: ${productos.join('; ')}` +
      `${resumen ? ` (${resumen})` : ''}. ` +
      'Búscalo en el catálogo con buscar_productos y respóndele con el precio y la disponibilidad del catálogo, no con lo que diga la imagen. ' +
      'Si no está, díselo y ofrécele lo más parecido.]';
  } else if (lectura.tipo === 'receta') {
    lectura_ =
      `[el cliente envió ${queEs} con una receta o indicación: ${resumen}` +
      `${productos.length ? `. Productos que menciona: ${productos.join('; ')}` : ''}. ` +
      'Busca en el catálogo lo que pide; no des indicaciones médicas.]';
  } else {
    lectura_ =
      `[el cliente envió ${queEs}: ${resumen}` +
      `${productos.length ? `. Menciona: ${productos.join('; ')}` : ''}]`;
  }
  const escrito = textoDelCliente(textoOriginal);
  return escrito ? `${lectura_} ${escrito}` : lectura_;
}

/** Normaliza el JSON que devuelve la IA; null si no sirve. */
export function parsearLectura(crudo: string): LecturaDeArchivo | null {
  try {
    const d = JSON.parse(
      crudo.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim(),
    );
    const tipos = ['producto', 'receta', 'documento', 'otro'];
    const productos = Array.isArray(d?.productos)
      ? d.productos.map((p: unknown) => String(p ?? '').trim()).filter(Boolean).slice(0, 10)
      : [];
    return {
      tipo: tipos.includes(d?.tipo) ? d.tipo : 'otro',
      productos,
      resumen: String(d?.resumen ?? '').trim().slice(0, 400),
    };
  } catch {
    return null;
  }
}
