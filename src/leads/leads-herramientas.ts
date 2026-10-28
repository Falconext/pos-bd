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
export const HERRAMIENTA_AVISAR_VISITA = 'avisar_visita_tienda';
export const HERRAMIENTA_AGENDAR_VISITA = 'agendar_visita_tienda';
export const HERRAMIENTA_CANCELAR_PEDIDO = 'cancelar_pedido';
export const HERRAMIENTA_DERIVAR = 'derivar_a_asesor';
export const HERRAMIENTA_AVISAR_RIESGO = 'avisar_cliente_alto_riesgo';
export const HERRAMIENTA_AGENDAR_RECORDATORIO = 'agendar_recordatorio';
export const HERRAMIENTA_DAR_DEMO = 'dar_demo';
export const HERRAMIENTA_LINK_PAGO = 'generar_link_pago';

const buscarProductos: FunctionDeclaration = {
  name: HERRAMIENTA_BUSCAR_PRODUCTOS,
  description:
    'Busca productos en el catálogo real del negocio y devuelve su nombre, precio y disponibilidad exactos. ' +
    'Úsala SIEMPRE antes de nombrar, recomendar, cotizar o afirmar que existe o no existe un producto: nunca respondas de memoria ni inventes precios. ' +
    'Busca con términos cortos: el nombre o el ingrediente ("psyllium", "uña de gato"), el órgano o sistema ("riñón", "próstata", "hígado") o la acción ("diurético", "desinflamante"). ' +
    'Si no encuentras nada útil, vuelve a llamarla con otro enfoque (sinónimo, ingrediente, órgano) antes de decirle al cliente que no lo tenemos. ' +
    'Que un producto aparezca no significa que sirva: revisa para qué es antes de ofrecerlo. ' +
    'Cada producto puede traer `recomendacion` (muy alta, alta, media o baja): es cuánto lo recomienda el negocio. Entre los que sirven para lo que necesita el cliente, ofrece primero el de recomendación más alta; baja al siguiente nivel solo si el de arriba no le sirve (por ejemplo, presentación inadecuada para su edad).',
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
    'El productoId sale de buscar_productos. Si el producto no tiene foto en el catálogo, la herramienta se la pide al equipo y te dice qué responder: sigue esa indicación al pie de la letra.',
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
    'Con el nombre de la ciudad alcanza: cualquier lugar fuera de Lima cae en provincia. No le pidas al cliente que precise más de lo que ya resolvió esta herramienta. ' +
    'Nunca vuelvas a pedirle un dato que esta herramienta ya tiene guardado. ' +
    'Si te devuelve `pedirTodoJunto`, pide los datos que faltan copiando ese bloque TAL CUAL en un solo mensaje, para que el cliente los conteste todos juntos; no los pidas de uno en uno. ' +
    'El nombre se le pregunta: no uses el de su perfil de WhatsApp ni el del comprobante de pago —quien paga no siempre es quien recibe. ' +
    'Y NUNCA completes un dato que el cliente no te dio: ni el DNI, ni el celular, ni la dirección. ' +
    'Si falta uno, pregúntaselo. Un número puesto por ti pasa todas las validaciones y deja un pedido que nadie puede entregar. ' +
    'Si el cliente llegó contando un malestar, guarda en `sintomas` lo que te contó —solo eso, con sus palabras— y pregúntale la edad antes de cerrar el pedido, con naturalidad y en un mensaje donde ya le estés avanzando algo. El negocio arma su guía de consumo con eso y la dosis depende de la edad. Si no quiere decirla, sigue sin insistir.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      pedidoAparte: {
        type: SchemaType.BOOLEAN,
        description:
          'true SOLO si el cliente ya tiene un pedido registrado y pide OTRO pedido aparte (otro destino u otra persona, "aparte de mi pedido"). Su pedido registrado queda como está y este empieza de cero. NO lo uses para cambiar o agregar productos a su pedido.',
      },
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
          'Sede de la agencia donde recogerá. Solo para envíos por agencia. Si el cliente la nombra junto con la agencia ("Shalom de Av. de la Cultura"), guárdala aquí en ese mismo turno: sin ella el pedido no se puede registrar.',
      },
      sintomas: {
        type: SchemaType.STRING,
        description:
          'Qué le pasa al cliente, en sus palabras ("acidez por las noches hace 2 meses"). Se guarda para que el negocio arme su guía de consumo personalizada; no lo inventes ni lo interpretes de más.',
      },
      recibeNombre: {
        type: SchemaType.STRING,
        description:
          'Nombre de un tercero que recibirá, si no es el comprador.',
      },
      notaEntrega: {
        type: SchemaType.STRING,
        description:
          'Indicaciones para quien entrega que no son la dirección: el vuelto que necesita ("vuelto de S/ 50"), piso, timbre. Si el cliente lo dice, guárdalo aquí: es la única forma de que le llegue al motorizado. No le digas que ya se avisó si no lo guardaste.',
      },
      sexo: {
        type: SchemaType.STRING,
        description:
          'Sexo del cliente ("M" o "F"). Cuando la consulta es por un malestar, pregúntalo con naturalidad: sirve para armarle su guía de consumo personalizada. Si no quiere decirlo, sigue sin insistir.',
      },
      edad: {
        type: SchemaType.INTEGER,
        description:
          'Edad del cliente en años. Cuando la consulta es por un malestar, pregúntala con naturalidad junto con el sexo: la dosis y la guía de consumo dependen de eso. Si no quiere decirla, sigue sin insistir.',
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
    'Vuelve a llamarla si el cliente agrega o quita productos. ' +
    'Si te devuelve `pedirTodoJunto` y el cliente acepta la cotización, en tu siguiente mensaje pídele los datos copiando ese bloque TAL CUAL, todos juntos. ' +
    'Si el pedido ya estaba registrado y te devuelve `pedidoActualizado`, dile que su pedido quedó actualizado con el nuevo total; si te devuelve `aviso`, haz lo que dice y no confirmes el cambio.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      items: {
        type: SchemaType.ARRAY,
        description:
          'SOLO los productos que el cliente aceptó, con la cantidad que pidió. Lo que le sugeriste y no dijo que sí, no va.',
        items: {
          type: SchemaType.OBJECT,
          properties: {
            productoId: {
              type: SchemaType.INTEGER,
              description: 'Id del producto, el que te devolvió buscar_productos.',
            },
            nombre: {
              type: SchemaType.STRING,
              description:
                'Nombre del producto tal como te lo devolvió buscar_productos, p. ej. "aceite de copaiba - SAYAL ( 30ml )".',
            },
            cantidad: {
              type: SchemaType.INTEGER,
              description: 'Cuántas unidades.',
            },
          },
          required: ['productoId', 'nombre', 'cantidad'],
        },
      },
      pedidoAparte: {
        type: SchemaType.BOOLEAN,
        description:
          'true SOLO si el cliente ya tiene un pedido registrado y pide OTRO pedido aparte (otro destino u otra persona, "aparte de mi pedido"). Su pedido registrado queda como está y este empieza de cero. NO lo uses para cambiar o agregar productos a su pedido.',
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
    'Si falta algo te lo dirá y no registrará nada: pídeselo y vuelve a intentarlo (si viene `pedirTodoJunto`, copia ese bloque tal cual en un solo mensaje). ' +
    'Nunca le digas al cliente que su pedido quedó agendado si esta herramienta no te lo confirmó. Se llama una sola vez por pedido.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
};

const avisarVisitaTienda: FunctionDeclaration = {
  name: HERRAMIENTA_AVISAR_VISITA,
  description:
    'Avisa a la tienda que el cliente va a pasar a recoger, con el día y la hora. ' +
    'Úsala cuando el cliente ya decidió recoger en tienda, ya le mostraste la cotización (con cotizar) y te dio su nombre completo y cuándo va a ir — tanto si dejó reserva como si no. ' +
    'También registra su pedido (nota de venta sin envío): si te devuelve `pedido`, puedes decirle que su pedido quedó registrado; si te devuelve `aviso`, síguelo. En un recojo NO llames a registrar_pedido. ' +
    'Si el negocio cobra una reserva para separar el producto, ofrécesela UNA vez y con naturalidad, antes de llamar a esta herramienta. Si no quiere, no insistas: igual avisas la visita y sigues atendiendo normal. Insistir con la reserva es lo que hace que no venga. ' +
    'Esto NO aparta el stock: avisa al negocio para que él decida si lo separa. Así que no le prometas al cliente que su producto está guardado ni "asegurado" — dile que la tienda queda avisada para tenerlo listo. ' +
    'Si el cliente cambia el día, vuelve a llamarla con el día nuevo.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      cuando: {
        type: SchemaType.STRING,
        description:
          'Cuándo va a pasar, en palabras del cliente ("mañana a las 2 de la tarde", "el sábado por la mañana").',
      },
      fecha: {
        type: SchemaType.STRING,
        description: 'El día de la visita como AAAA-MM-DD, calculado con el día de HOY de la información de apoyo. Omítelo si no dijo el día.',
      },
      nombre: {
        type: SchemaType.STRING,
        description: 'Nombre completo del cliente tal como lo escribió, si te lo dio. Pásalo siempre que lo tengas: sin nombre no se registra su pedido.',
      },
    },
    required: ['cuando'],
  },
};

/**
 * El cliente va a ir a la tienda SIN pedido: a conocer, a ver los productos,
 * a consultar en persona. Hierba Sana (26-10): "Primero quiero visitarte la
 * tienda el martes 27, 8 am" no quedaba registrado en ningún lado, y los
 * que llegaban se perdían buscando el local.
 */
const agendarVisitaTienda: FunctionDeclaration = {
  name: HERRAMIENTA_AGENDAR_VISITA,
  description:
    'Registra que el cliente va a visitar la tienda física sin haber hecho un pedido todavía (quiere conocer, ver los productos o consultar en persona). ' +
    `Si ya cotizó y decidió recoger su pedido en tienda, NO uses esta: usa ${HERRAMIENTA_AVISAR_VISITA}. ` +
    'Úsala apenas diga que va a ir, aunque no sepa cuándo; si dio día u hora, pásalos. Si vuelve a cambiar el día, llámala otra vez. ' +
    'Le manda sola la ubicación en el mapa, la foto del local y las indicaciones para llegar: si te devuelve `indicacionesEnviadas`, no le repitas la dirección completa, solo dile que le acabas de mandar cómo llegar y que lo esperan.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      cuando: {
        type: SchemaType.STRING,
        description: 'Cuándo dice que va a ir, en sus palabras ("el martes 27 a las 8 am"). Vacío si no lo dijo.',
      },
      fecha: {
        type: SchemaType.STRING,
        description: 'El día como AAAA-MM-DD, calculado con el día de HOY de la información de apoyo. Omítelo si no dijo el día.',
      },
    },
  },
};

const cancelarPedido: FunctionDeclaration = {
  name: HERRAMIENTA_CANCELAR_PEDIDO,
  description:
    'Cancela el pedido YA REGISTRADO de esta conversación cuando el cliente dice que ya no lo quiere. ' +
    'Si te devuelve `cancelado`, dile que su pedido quedó cancelado. Si te devuelve `derivar`, NO le digas que quedó cancelado: haz lo que dice. ' +
    'Nunca le digas al cliente que su pedido quedó cancelado si esta herramienta no te lo confirmó. Si solo estaba cotizado, no hace falta cancelar nada.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      motivo: {
        type: SchemaType.STRING,
        description: 'Lo que dijo el cliente, en pocas palabras ("ya no lo necesita").',
      },
    },
  },
};

const derivar: FunctionDeclaration = {
  name: HERRAMIENTA_DERIVAR,
  description:
    'Pasa la conversación a una persona del equipo y deja de responder. Úsala SOLO cuando: el cliente es mayorista, revendedor o distribuidor (o compra 6 docenas o más); hay un reclamo, producto dañado, vencido o equivocado, pedido incompleto, cambio, devolución o cancelación con adelanto; pregunta por el seguimiento de un pedido ya hecho; pide un descuento fuera de la regla; quiere un producto que no tenemos y pide que lo busquemos con proveedores; o pide hablar con una persona. ' +
    'Un comprobante de pago NO se deriva: lo recibes leído, se lo confirmas al cliente y sigues tú con los datos de envío. Derivar ahí deja el pedido pagado y sin dirección. ' +
    'Esa lista es CERRADA. Lo que no está en ella se responde, no se deriva: una pregunta difícil o incómoda —certificaciones, registros, permisos, composición, garantía, si el producto es original, desconfianza— se contesta con el contexto del negocio y la conversación sigue. Que no tengas el dato exacto a la mano tampoco es motivo: di lo que sí puedes confirmar y ofrece conseguir el resto. ' +
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
/**
 * Cliente de alto riesgo: el bot SIGUE atendiendo y una persona hace
 * seguimiento. No es una derivación —esa apaga el bot—: Hierba Sana lo
 * decidió así el 19-10 tras la prueba del diabético con metformina.
 */
const avisarAltoRiesgo: FunctionDeclaration = {
  name: HERRAMIENTA_AVISAR_RIESGO,
  description:
    'Avisa al equipo que este cliente es de alto riesgo para que una persona le haga seguimiento. NO te saca de la conversación: sigues atendiendo normal. ' +
    'Úsala UNA vez cuando el cliente diga que toma medicamentos, tiene una enfermedad crónica (diabetes, presión alta, enfermedad del corazón, riñón o hígado, cáncer), está embarazada o dando de lactar, o el producto es para un bebé o niño pequeño. ' +
    'En ese mismo mensaje, después de recomendar, dile con naturalidad que lo consulte con su médico y que no deje su tratamiento actual hasta que su médico lo indique. No le digas que avisaste a nadie.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      riesgo: {
        type: SchemaType.STRING,
        description:
          'Qué lo hace de alto riesgo, en sus palabras: condición y medicamentos ("diabetes e hipertensión, toma metformina y losartán").',
      },
      recomendado: {
        type: SchemaType.STRING,
        description: 'Producto(s) que le recomendaste, si ya lo hiciste.',
      },
    },
    required: ['riesgo'],
  },
};

/**
 * El cliente dijo CUÁNDO retoma: "en una semana", "a fin de mes", "cuando
 * cobre el 30", "cuando regrese de viaje el lunes". Hierba Sana (19-10): ese
 * día hay que escribirle, como un agendado.
 */
const agendarRecordatorio: FunctionDeclaration = {
  name: HERRAMIENTA_AGENDAR_RECORDATORIO,
  description:
    'Programa un mensaje para el cliente en la fecha en que él dijo que retomaría la compra. Úsala cuando el cliente diga una fecha o un plazo concreto ("en una semana", "a fin de mes", "cuando cobre el 30", "regreso de viaje el lunes"). ' +
    'Calcula la fecha con el día de HOY que viene en la información de apoyo y pásala como AAAA-MM-DD. Si dice "fin de mes", usa el último día del mes. ' +
    'Si no da ninguna fecha ("lo voy a pensar", "lo consulto"), NO la uses: de eso ya se encarga otro aviso. Después de usarla, dile en una línea que le escribirás ese día, y despídete sin insistir.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      fecha: {
        type: SchemaType.STRING,
        description: 'Fecha en formato AAAA-MM-DD, entre mañana y 4 meses desde hoy.',
      },
      motivo: {
        type: SchemaType.STRING,
        description: 'Lo que dijo el cliente, en pocas palabras ("cobra a fin de mes").',
      },
    },
    required: ['fecha'],
  },
};

/**
 * Accesos a la demo del rubro del prospecto (Krezka, 20-10). Solo la usan
 * los negocios que configuraron demos; al resto les devuelve que no hay.
 */
const darDemo: FunctionDeclaration = {
  name: HERRAMIENTA_DAR_DEMO,
  description:
    'Entrega al prospecto los accesos (enlace, usuario y clave) a la demo del sistema de SU rubro. ' +
    'Úsala cuando el prospecto ya te mandó sus datos del bloque DATOS PARA CREAR TU DEMO. Pasa todo lo que dijo; si te devuelve `faltan`, pídele solo eso. ' +
    'Si te devuelve `opciones`, ninguna demo es de su rubro: vuelve a llamarla con `demo` = la opción más parecida a su negocio. ' +
    'Si te devuelve `acceso`, mándale el enlace, el usuario y la clave tal cual. Nunca escribas accesos que esta herramienta no te dio.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      rubro: {
        type: SchemaType.STRING,
        description: 'A qué se dedica su negocio, en sus palabras ("farmacia", "venta de repuestos de motos").',
      },
      nombre: { type: SchemaType.STRING, description: 'Nombres y apellidos.' },
      celular: { type: SchemaType.STRING },
      correo: { type: SchemaType.STRING },
      ruc: {
        type: SchemaType.STRING,
        description: 'El RUC que dio. Si dijo que no tiene, pásalo vacío y pon "no tiene".',
      },
      nombreComercial: { type: SchemaType.STRING },
      demo: {
        type: SchemaType.STRING,
        description: 'Solo cuando la herramienta te devolvió `opciones`: la más parecida a su negocio, copiada de la lista.',
      },
    },
    required: ['rubro'],
  },
};

/**
 * Link de Mercado Pago para lo cotizado (21-10). Solo cobra en los negocios
 * que lo activaron y tienen Mercado Pago conectado; al resto les devuelve
 * `noDisponible`.
 */
const generarLinkPago: FunctionDeclaration = {
  name: HERRAMIENTA_LINK_PAGO,
  description:
    'Genera un link de Mercado Pago para que el cliente pague lo cotizado con tarjeta o con su cuenta de Mercado Pago. ' +
    'Úsala cuando el cliente ya aceptó la cotización y va a pagar (el total, o la reserva o el adelanto que pida el negocio), si cotizar te indicó que el negocio cobra por link o si el cliente pide pagar con tarjeta. ' +
    'Si te devuelve `link`, mándaselo tal cual. Si te devuelve `noDisponible` o `error`, haz lo que dice. ' +
    'Nunca le digas que su pago está confirmado: el sistema te avisa en la conversación cuando Mercado Pago lo confirme.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      monto: {
        type: SchemaType.NUMBER,
        description:
          'Solo si va a pagar una parte (la reserva o el adelanto que fija el negocio). Para cobrar todo lo que falta, no lo pases.',
      },
    },
  },
};

export const HERRAMIENTAS_VENTA: FunctionDeclaration[] = [
  buscarProductos,
  enviarFoto,
  guardarDatosEnvio,
  cotizar,
  registrarPedido,
  avisarVisitaTienda,
  agendarVisitaTienda,
  cancelarPedido,
  derivar,
  avisarAltoRiesgo,
  agendarRecordatorio,
  darDemo,
  generarLinkPago,
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
- Una ciudad basta. Si ${HERRAMIENTA_GUARDAR_DATOS} ya te devolvió la zona y el costo de envío, el destino ESTÁ resuelto: no pidas el distrito exacto ni más precisión "para cotizar mejor". Cotiza. Solo pregunta cuando la herramienta te diga explícitamente que el destino es ambiguo.
- El complemento que ofrezcas antes de cotizar también sale de ${HERRAMIENTA_BUSCAR_PRODUCTOS}, nunca de tu memoria. Si la búsqueda no devuelve uno que le sirva de verdad, no ofrezcas nada y sigue al cierre.
- Para cotizar usa ${HERRAMIENTA_COTIZAR}. El envío y el descuento los calcula ella: tú no sumas ni aplicas descuentos. Copia su texto tal cual.
- Cuando el cliente acepte y no falte ningún dato, llama a ${HERRAMIENTA_REGISTRAR_PEDIDO} y a nada más: no vuelvas a buscar ni a cotizar lo que ya cotizaste. Solo después de que te confirme puedes decirle que su pedido quedó agendado.
- Si recoge en tienda, también se cotiza con ${HERRAMIENTA_COTIZAR} (sin envío) y se cierra con ${HERRAMIENTA_AVISAR_VISITA}, que registra el pedido.
- Si dice que va a ir a la tienda a conocer o a ver antes de comprar, regístralo con ${HERRAMIENTA_AGENDAR_VISITA}.
- Si el cliente cancela un pedido ya registrado, usa ${HERRAMIENTA_CANCELAR_PEDIDO}.
- Si el prospecto te manda sus datos para la demo, usa ${HERRAMIENTA_DAR_DEMO}.
- Lo que no te toca resolver se deriva con ${HERRAMIENTA_DERIVAR}: mayoristas, reclamos, comprobantes de pago, seguimiento de pedidos ya hechos y quien pida hablar con una persona. Esos casos y nada más: una duda que puedas contestar con el contexto se contesta. Nunca digas que ya informaste a un asesor si en ese mismo turno no la llamaste.
`.trim();
