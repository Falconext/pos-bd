import { FunctionDeclaration, SchemaType } from '@google/generative-ai';

/**
 * Herramientas que la IA de Ventas puede pedir durante una conversación.
 *
 * El valor de que sean herramientas y no contexto precalculado: el modelo
 * decide cuándo buscar y puede volver a buscar con otro enfoque si lo primero
 * no sirvió. Antes se adivinaba una sola búsqueda antes de llamarlo.
 *
 * Las descripciones son parte del contrato con el modelo: dicen cuándo usar
 * cada una. Están redactadas con las reglas del negocio (ver AGENTE_01.txt),
 * no inventadas aquí.
 */

export const HERRAMIENTA_BUSCAR_PRODUCTOS = 'buscar_productos';
export const HERRAMIENTA_ENVIAR_FOTO = 'enviar_foto';

const buscarProductos: FunctionDeclaration = {
  name: HERRAMIENTA_BUSCAR_PRODUCTOS,
  description:
    'Busca productos en el catálogo real del negocio y devuelve su nombre, precio y disponibilidad exactos. ' +
    'Úsala SIEMPRE antes de nombrar, recomendar, cotizar o afirmar que existe o no existe un producto: nunca respondas de memoria ni inventes precios. ' +
    'Busca con términos cortos: el nombre o el ingrediente ("psyllium", "uña de gato"), el órgano o sistema ("riñón", "próstata", "hígado") o la acción ("diurético", "desinflamante"). ' +
    'Si no encuentras nada útil, vuelve a llamarla con otro enfoque (sinónimo, ingrediente, órgano) antes de decirle al cliente que no lo tenemos. ' +
    'Que un producto aparezca no significa que sirva: revisa para qué es antes de ofrecerlo.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      consulta: {
        type: SchemaType.STRING,
        description:
          'Términos de búsqueda cortos: nombre, ingrediente, órgano, sistema o acción. Sin frases completas.',
      },
      categoria: {
        type: SchemaType.STRING,
        description:
          'Opcional. Filtra por categoría o subcategoría del catálogo (por ejemplo SALUD, NUTRICION, BELLEZA, CAPSULA, JARABES, FILTRANTES, HIERBAS SECAS, ACEITES ESENCIALES, GOTERO, MIEL, HARINA). Omítela si no estás seguro.',
      },
    },
    required: ['consulta'],
  },
};

const enviarFoto: FunctionDeclaration = {
  name: HERRAMIENTA_ENVIAR_FOTO,
  description:
    'Envía al cliente la foto de un producto del catálogo. Úsala cuando pida ver el producto, una foto, o diga que quiere asegurarse de no equivocarse. ' +
    'El productoId sale de buscar_productos. Si el producto no tiene foto te lo dirá: en ese caso no la prometas.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      productoId: {
        type: SchemaType.INTEGER,
        description: 'Id del producto, tal como lo devolvió buscar_productos.',
      },
    },
    required: ['productoId'],
  },
};

/** Las herramientas disponibles hoy. Los bloques C y F añaden las suyas aquí. */
export const HERRAMIENTAS_VENTA: FunctionDeclaration[] = [
  buscarProductos,
  enviarFoto,
];

/**
 * Instrucción que acompaña a las herramientas en el prompt. El prompt completo
 * del asesor se reescribe en C5; esto es lo mínimo para que el modelo sepa que
 * tiene catálogo real a mano y no deba fiarse de su memoria.
 */
export const INSTRUCCION_HERRAMIENTAS = `
USO DE HERRAMIENTAS (obligatorio)
- Antes de nombrar, recomendar, cotizar o decir que tienes o no tienes un producto, búscalo con ${HERRAMIENTA_BUSCAR_PRODUCTOS}. Copia exactamente el nombre, el precio y la disponibilidad que devuelve.
- Nunca inventes productos, marcas, presentaciones ni precios, y nunca los tomes de tu memoria.
- Si el cliente escribe mal un nombre, confirma la coincidencia ("¿Te refieres a Fenogreco?") en vez de decir que no existe.
- Si el cliente pide ver un producto o una foto, usa ${HERRAMIENTA_ENVIAR_FOTO} con el id que te dio la búsqueda. No escribas en tu respuesta el nombre de una herramienta, sus parámetros ni sus resultados en crudo.
- Las preguntas sobre el negocio (dirección, horarios, pagos, envíos, políticas) se responden con el contexto que ya tienes, sin llamar a ninguna herramienta.
`.trim();
