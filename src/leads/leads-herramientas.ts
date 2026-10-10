import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { MOTIVOS_DERIVACION } from './pausa-bot';

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
export const HERRAMIENTA_GUARDAR_DATOS = 'guardar_datos_envio';
export const HERRAMIENTA_COTIZAR = 'cotizar';
export const HERRAMIENTA_REGISTRAR_PEDIDO = 'registrar_pedido';
export const HERRAMIENTA_DERIVAR = 'derivar_a_asesor';

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

const guardarDatosEnvio: FunctionDeclaration = {
  name: HERRAMIENTA_GUARDAR_DATOS,
  description:
    'Guarda los datos del pedido según el cliente los va diciendo, y te devuelve QUÉ FALTA todavía. ' +
    'Llámala en cuanto el cliente mencione cualquiera de estos datos, aunque sea de pasada y aunque falten otros: no esperes a tenerlos todos. ' +
    'Si te dice el distrito o la ciudad, mándalo en `destino` y te devuelve la zona, el costo de envío y la forma de pago que corresponde. ' +
    'Nunca vuelvas a pedirle un dato que esta herramienta ya tiene guardado. ' +
    'El nombre se le pregunta: no uses el de su perfil de WhatsApp.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      destino: {
        type: SchemaType.STRING,
        description:
          'Distrito o ciudad de entrega, tal como lo escribió el cliente. También "recojo en tienda".',
      },
      nombre: {
        type: SchemaType.STRING,
        description: 'Nombre completo de quien recibe.',
      },
      dni: { type: SchemaType.STRING, description: 'DNI, 8 dígitos.' },
      celular: {
        type: SchemaType.STRING,
        description: 'Celular de contacto, 9 dígitos.',
      },
      direccion: {
        type: SchemaType.STRING,
        description:
          'Dirección con calle y número. Solo para entrega a domicilio.',
      },
      referencia: {
        type: SchemaType.STRING,
        description: 'Referencia para ubicar la dirección.',
      },
      horario: {
        type: SchemaType.STRING,
        description:
          'Franja de entrega acordada, en palabras ("mañana de 3 a 4 de la tarde").',
      },
      agenciaSede: {
        type: SchemaType.STRING,
        description:
          'Sede de la agencia donde recogerá. Solo para envíos por agencia.',
      },
      recibeNombre: {
        type: SchemaType.STRING,
        description:
          'Nombre de un tercero que recibirá, si no es el comprador.',
      },
      sexo: {
        type: SchemaType.STRING,
        description:
          'Sexo del cliente ("M" o "F"). NUNCA lo preguntes: anótalo solo si el cliente lo dice o queda claro de lo que cuenta.',
      },
      edad: {
        type: SchemaType.INTEGER,
        description:
          'Edad del cliente en años. NUNCA la preguntes para llenar este campo: anótala solo si la menciona (suele salir cuando pregunta por la dosis).',
      },
    },
  },
};

const cotizar: FunctionDeclaration = {
  name: HERRAMIENTA_COTIZAR,
  description:
    'Arma la cotización con los productos que el cliente confirmó. Calcula el envío y el descuento por pack en código, no los calcules tú: nunca sumes ni apliques descuentos a mano. ' +
    'Te devuelve el texto de la cotización ya escrito; cópialo tal cual en tu respuesta. ' +
    'Necesita saber el destino: si todavía no lo sabes, te lo dirá y tendrás que preguntárselo al cliente antes. ' +
    'Vuelve a llamarla si el cliente agrega o quita productos.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      items: {
        type: SchemaType.ARRAY,
        description: 'Los productos confirmados, con la cantidad que pidió.',
        items: {
          type: SchemaType.OBJECT,
          properties: {
            productoId: {
              type: SchemaType.INTEGER,
              description: 'Id del producto.',
            },
            cantidad: {
              type: SchemaType.INTEGER,
              description: 'Cuántas unidades.',
            },
          },
          required: ['productoId', 'cantidad'],
        },
      },
      nombrePack: {
        type: SchemaType.STRING,
        description:
          'Nombre llamativo para la cotización, p. ej. "Pack Detox Hepático".',
      },
    },
    required: ['items'],
  },
};

const registrarPedido: FunctionDeclaration = {
  name: HERRAMIENTA_REGISTRAR_PEDIDO,
  description:
    'Registra el pedido en el sistema. Llámala SOLO cuando se cumplan las dos cosas: el cliente aceptó la cotización, y ya tienes todos los datos que guardar_datos_envio pedía. ' +
    'Si falta algo te lo dirá y no registrará nada: pídeselo y vuelve a intentarlo. ' +
    'Nunca le digas al cliente que su pedido quedó agendado si esta herramienta no te lo confirmó. Se llama una sola vez por pedido.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
};

const derivar: FunctionDeclaration = {
  name: HERRAMIENTA_DERIVAR,
  description:
    'Pasa la conversación a una persona del equipo y deja de responder. Úsala cuando: el cliente es mayorista, revendedor o distribuidor (o compra 6 docenas o más); hay un reclamo, producto dañado, vencido o equivocado, pedido incompleto, cambio, devolución o cancelación con adelanto; manda un comprobante de pago; pregunta por el seguimiento de un pedido ya hecho; pide un descuento fuera de la regla; quiere un producto que no tenemos y pide que lo busquemos con proveedores; o pide hablar con una persona. ' +
    'ANTES de llamarla, pregúntale lo que el asesor va a necesitar (qué producto, qué pasó, qué cantidades) — después de derivar ya no podrás preguntar nada. ' +
    'El mensaje con el que derivas no lleva preguntas. Se deriva UNA sola vez.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      motivo: {
        type: SchemaType.STRING,
        description: `Por qué derivas. Uno de: ${MOTIVOS_DERIVACION.join(', ')}.`,
      },
      detalle: {
        type: SchemaType.STRING,
        description:
          'Lo que el asesor necesita saber para retomar sin volver a preguntar: producto, cantidades, ciudad, qué pasó.',
      },
    },
    required: ['motivo'],
  },
};

/** Las herramientas disponibles hoy. Los bloques C y F añaden las suyas aquí. */
export const HERRAMIENTAS_VENTA: FunctionDeclaration[] = [
  buscarProductos,
  enviarFoto,
  guardarDatosEnvio,
  cotizar,
  registrarPedido,
  derivar,
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
- NO repitas una búsqueda cuyo resultado ya está en esta conversación. Si ya buscaste "moringa" y el cliente sigue hablando de lo mismo, usa lo que ya tienes: volver a buscar cuesta tiempo y no aporta nada.

CÓMO SE CIERRA UNA VENTA
- En cuanto el cliente mencione su distrito, su nombre, su celular o cualquier dato de entrega, guárdalo con ${HERRAMIENTA_GUARDAR_DATOS}. La herramienta te dice qué falta: pide UN dato por mensaje, en el orden en que te los lista, y nunca repreguntes algo que ya está guardado.
- Para cotizar usa ${HERRAMIENTA_COTIZAR}. El envío y el descuento los calcula ella: tú no sumas ni aplicas descuentos. Copia su texto tal cual.
- Cuando el cliente acepte y no falte ningún dato, llama a ${HERRAMIENTA_REGISTRAR_PEDIDO} y a nada más: no vuelvas a buscar ni a cotizar lo que ya cotizaste. Solo después de que te confirme puedes decirle que su pedido quedó agendado.
- Lo que no te toca resolver se deriva con ${HERRAMIENTA_DERIVAR}: mayoristas, reclamos, comprobantes de pago, seguimiento de pedidos ya hechos y quien pida hablar con una persona. Nunca digas que ya informaste a un asesor si en ese mismo turno no la llamaste.
`.trim();
