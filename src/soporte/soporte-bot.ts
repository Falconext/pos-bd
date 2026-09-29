/**
 * Cuándo contesta el bot de soporte y cuándo se calla.
 *
 * Esta es la parte que decide si el asistente ayuda o estorba. Un bot que
 * responde encima de una conversación que ya tomó una persona, o que insiste
 * cuando le pidieron un humano, hace más daño que no tenerlo: el empresario
 * siente que le pusieron una máquina para no atenderlo.
 *
 * Vive aparte del servicio para poder probar cada regla sin base de datos ni
 * llamadas a Gemini.
 */

/** Lo mínimo que hace falta saber de la conversación para decidir. */
export interface EstadoConversacion {
  /** ¿Alguien de Krezka la tomó? */
  asignadoAId?: number | null;
  /** Momento del último mensaje escrito por una persona de Krezka. */
  ultimoMensajeHumano?: Date | null;
  /** Cuántos mensajes seguidos lleva contestando el bot sin intervención humana. */
  respuestasSeguidasDelBot?: number;
}

/**
 * Ventana en la que el bot no habla después de que contestó una persona.
 *
 * Si alguien del equipo está respondiendo, el empresario está hablando CON esa
 * persona. Que el bot se meta en el medio arruina la conversación y confunde
 * sobre quién le contestó.
 */
export const MINUTOS_SILENCIO_TRAS_HUMANO = 30;

/**
 * Tope de respuestas seguidas del bot.
 *
 * NO es una medida de calidad: un asistente que contesta ocho preguntas
 * distintas y bien está haciendo su trabajo, no fallando. La primera versión
 * lo puso en 3 con la idea de "si sigue preguntando es que no resuelve", y en
 * la primera prueba real mató una conversación sana a la cuarta pregunta —
 * dejando al empresario hablándole a la nada, que es peor que no tener bot.
 *
 * Queda solo como tope de seguridad, para acotar el gasto si alguien deja el
 * chat en un bucle. Las señales de que el bot NO está ayudando son otras y
 * viven aparte: que pidan una persona, o que el propio modelo pida escalar.
 */
export const MAX_RESPUESTAS_SEGUIDAS = 12;

const PIDE_HUMANO = [
  'humano', 'persona', 'asesor', 'alguien del equipo', 'hablar con alguien',
  'no me sirve', 'no entendes', 'no entiendes', 'no me estas entendiendo',
  'quiero hablar con', 'atienda una persona', 'operador', 'soporte real',
  // Señales de que quedó esperando: si escribe esto, algo ya salió mal y lo
  // último que necesita es otra respuesta automática.
  'estas ahi', 'estan ahi', 'hay alguien', 'me responden', 'que paso',
  'no me contestan', 'sigue sin', 'no funciona',
];

/** Texto normalizado: sin tildes, minúsculas. Para comparar lo que escribe la gente. */
export const normalizar = (texto: string): string =>
  String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** ¿El empresario está pidiendo que lo atienda una persona? */
export const pideHumano = (texto: string): boolean => {
  const t = normalizar(texto);
  return PIDE_HUMANO.some((frase) => t.includes(normalizar(frase)));
};

export type MotivoSilencio =
  | 'pidio-humano'
  | 'conversacion-tomada'
  | 'humano-respondiendo'
  | 'demasiadas-seguidas';

export interface Decision {
  responde: boolean;
  motivo?: MotivoSilencio;
}

/**
 * ¿Debe contestar el bot este mensaje?
 *
 * En cuanto alguna regla dice que no, el mensaje queda para una persona: el
 * bot no "intenta igual". Prefiere callarse de más que meterse donde no va.
 */
export const debeResponder = (
  mensaje: string,
  estado: EstadoConversacion,
  ahora = new Date(),
): Decision => {
  if (pideHumano(mensaje)) return { responde: false, motivo: 'pidio-humano' };

  if (estado.asignadoAId != null) {
    return { responde: false, motivo: 'conversacion-tomada' };
  }

  if (estado.ultimoMensajeHumano) {
    const minutos =
      (ahora.getTime() - estado.ultimoMensajeHumano.getTime()) / 60000;
    if (minutos < MINUTOS_SILENCIO_TRAS_HUMANO) {
      return { responde: false, motivo: 'humano-respondiendo' };
    }
  }

  if ((estado.respuestasSeguidasDelBot ?? 0) >= MAX_RESPUESTAS_SEGUIDAS) {
    return { responde: false, motivo: 'demasiadas-seguidas' };
  }

  return { responde: true };
};
