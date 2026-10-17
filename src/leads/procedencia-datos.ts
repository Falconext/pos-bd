/**
 * ¿Este dato lo dijo el cliente, o lo puso el modelo para poder cerrar?
 *
 * El problema que resuelve, tal como pasó en Hierba Sana el 2026-10-16: un
 * cliente de Cusco cotizó 3 Cardiox, yapeó y mandó la captura. El agente le
 * había pedido el nombre y nada más. Al llegar el comprobante, el pago ya
 * estaba hecho y `registrar_pedido` le contestaba que faltaban DNI, celular y
 * sede de la agencia. En vez de preguntárselos, el modelo los RELLENÓ —DNI
 * 84956217, celular 987456123— y la nota de venta NV01-00000006 salió con un
 * destinatario que nadie podía contactar. El celular inventado ni siquiera
 * era el WhatsApp desde el que escribía.
 *
 * Nada lo impedía: `validarDni` y `validarCelular` comprueban el FORMATO
 * (8 dígitos, 9 dígitos empezando en 9), y cualquier número tecleado al azar
 * lo cumple. Para el sistema un pedido con los campos llenos está completo.
 *
 * Por eso acá no se valida la forma del dato sino su PROCEDENCIA: tiene que
 * aparecer en algo que el cliente escribió. Es la única comprobación posible
 * sin salir a RENIEC en medio de una venta, y ataja el caso que importa —el
 * dato que no existe en ninguna parte de la conversación.
 *
 * Qué se verifica y qué no:
 *
 *  - DNI y celular: comparación EXACTA de dígitos. Son los que dejan un
 *    paquete indespachable y los que el modelo puede teclear al azar.
 *  - Dirección: por palabra distintiva. Una dirección la escribe el cliente,
 *    el agente no la puede ofrecer de un catálogo.
 *  - Sede de agencia y nombre: NO se verifican. El agente ofrece la sede de
 *    la lista del negocio y el cliente contesta "sí, esa": el dato es bueno
 *    aunque el cliente nunca lo haya tecleado. Verificarlo rechazaría ventas
 *    legítimas, que es peor que el riesgo que cubriría.
 */

/** Deja solo los dígitos, para comparar números como los escribe la gente. */
function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * ¿Esta secuencia de dígitos aparece en algo que escribió el cliente?
 *
 * Se compara mensaje por mensaje y no contra todo el historial pegado: al
 * concatenar, el final de un número y el principio del siguiente forman
 * secuencias que nadie escribió, y eso haría pasar justo lo que se quiere
 * atajar.
 *
 * Dentro de UN mensaje sí se quitan los separadores: "987 654 321" y
 * "987-654-321" son el mismo celular, y el cliente los escribe de las dos
 * formas.
 */
export function digitosDichosPorElCliente(
  valor: string | null | undefined,
  mensajesDelCliente: string[],
): boolean {
  // El prefijo del país no es parte del número: se quita de los dos lados,
  // igual que en `normalizarCelular`. Quien escribe "+51 987654321" dijo el
  // mismo celular que quien escribe los 9 dígitos, y el modelo manda tanto
  // uno como el otro.
  const sinPrefijo = (d: string) => d.replace(/^51(?=\d{9}$)/, '');
  const buscado = sinPrefijo(soloDigitos(String(valor ?? '')));
  if (!buscado) return false;
  // En el mensaje no hace falta quitar nada: si el cliente escribió
  // "+51 987654321", esos dígitos contienen los 9 del celular buscado.
  return mensajesDelCliente.some((m) => soloDigitos(m).includes(buscado));
}

/**
 * ¿El texto aparece, al menos en lo esencial, en lo que escribió el cliente?
 *
 * No se exige la frase completa: el modelo acomoda lo que le dictan ("av
 * larco 123 dpto 4" por "en la av. Larco 123, departamento 4") y rechazar eso
 * sería frenar un pedido bueno. Alcanza con que una palabra distintiva —de
 * cuatro caracteres o más, que es lo que descarta "av", "de", "nro"— esté
 * presente.
 */
export function textoDichoPorElCliente(
  valor: string | null | undefined,
  mensajesDelCliente: string[],
): boolean {
  const palabras = normalizar(String(valor ?? ''))
    .split(' ')
    .filter((p) => p.length >= 4);
  if (!palabras.length) return false;
  const dicho = mensajesDelCliente.map(normalizar);
  return palabras.some((p) => dicho.some((m) => m.includes(p)));
}

/**
 * Lo que la IA tiene que hacer cuando un dato no salió del cliente.
 *
 * El texto va dirigido al modelo, no al cliente: le dice que ese dato no
 * existe en la conversación y que la salida es preguntarlo. Sin esta última
 * frase el modelo vuelve a intentarlo con otro número, que es exactamente el
 * bucle que se quiere cortar.
 */
export function pedirDatoAlCliente(campo: string): string {
  return (
    `El ${campo} que mandaste no aparece en ningún mensaje del cliente, así que no se guardó. ` +
    `Nunca lo completes por tu cuenta ni lo saques del comprobante de pago: pregúntaselo al cliente y vuelve a guardarlo con lo que te responda.`
  );
}
