/**
 * F0 — el motor de disparadores, reglas puras.
 *
 * Los 7 disparadores del anexo son fáciles de describir y fáciles de hacer
 * mal. Lo que de verdad decide si este módulo sirve o hunde la cuenta de
 * WhatsApp del negocio son cuatro cosas, y todas viven acá:
 *
 *  1. La ventana de 24 horas de Meta. Dentro de 24 h del último mensaje del
 *     cliente se puede escribir texto libre y es gratis. Fuera, SOLO
 *     plantillas aprobadas, y se pagan. Los disparadores de 25 y 45 días
 *     están siempre fuera: mandar texto ahí no llega y, repetido, bloquea el
 *     número.
 *  2. El horario. Un aviso de recompra a las 3 de la mañana no vende: hace
 *     que lo reporten.
 *  3. La baja. El pie de las plantillas promete "responde BAJA para no
 *     recibir más avisos". Prometerlo y no cumplirlo es lo que convierte una
 *     cuenta en una cuenta bloqueada.
 *  4. El tope. Tres mensajes de marketing en una semana al mismo cliente es
 *     spam aunque cada uno, por separado, tenga sentido.
 */

export enum TipoDisparo {
  /** 33.1 — el producto que consultó volvió a estar disponible. */
  VUELTA_DISPONIBILIDAD = 'VUELTA_DISPONIBILIDAD',
  /** 33.2 — cotizó y no concretó, a las 3 horas. */
  RECUPERAR_COTIZACION = 'RECUPERAR_COTIZACION',
  /** 33.3 — dijo "te aviso luego": recordatorio a la mañana siguiente. */
  CARRITO_EN_ESPERA = 'CARRITO_EN_ESPERA',
  /** 33.4 — 24 h después de la entrega: reseña y recomendación. */
  POST_ENTREGA = 'POST_ENTREGA',
  /** 33.5 — recompra preventiva a los 25 días. */
  RECOMPRA = 'RECOMPRA',
  /** 33.6 — reactivación tras 45 días sin actividad. */
  REACTIVACION = 'REACTIVACION',
}

export interface DefinicionDisparo {
  tipo: TipoDisparo;
  etiqueta: string;
  /** Cuánto después del hecho que lo origina. */
  demoraHoras: number;
  /** Plantilla aprobada en Meta, para cuando la ventana está cerrada. */
  plantilla: string;
  /** MARKETING se paga más y cuenta para el tope; UTILITY es transaccional. */
  categoria: 'UTILITY' | 'MARKETING';
  /**
   * Si al llegar la hora hay que volver a mirar la disponibilidad del
   * producto. Es el punto 33.7: nunca disparar sobre algo que no hay.
   */
  exigeProductoDisponible: boolean;
  /** Mandarlo a la mañana siguiente en vez de a las N horas exactas. */
  aLaManianaSiguiente?: boolean;
}

/**
 * Los 7 del anexo. Las demoras son los valores que pidió Hierba Sana; cada
 * empresa puede cambiarlas en su configuración, porque un negocio de
 * suplementos mensuales y una ferretería no reponen al mismo ritmo.
 */
export const CATALOGO_DISPAROS: Record<TipoDisparo, DefinicionDisparo> = {
  [TipoDisparo.VUELTA_DISPONIBILIDAD]: {
    tipo: TipoDisparo.VUELTA_DISPONIBILIDAD,
    etiqueta: 'Volvió a estar disponible',
    demoraHoras: 0,
    plantilla: 'producto_disponible',
    categoria: 'UTILITY',
    exigeProductoDisponible: true,
  },
  [TipoDisparo.RECUPERAR_COTIZACION]: {
    tipo: TipoDisparo.RECUPERAR_COTIZACION,
    etiqueta: 'Cotización sin cerrar',
    demoraHoras: 3,
    plantilla: 'recuperar_cotizacion',
    categoria: 'UTILITY',
    exigeProductoDisponible: false,
  },
  [TipoDisparo.CARRITO_EN_ESPERA]: {
    tipo: TipoDisparo.CARRITO_EN_ESPERA,
    etiqueta: 'Dijo que avisaba luego',
    demoraHoras: 12,
    plantilla: 'carrito_en_espera',
    categoria: 'UTILITY',
    exigeProductoDisponible: false,
    aLaManianaSiguiente: true,
  },
  [TipoDisparo.POST_ENTREGA]: {
    tipo: TipoDisparo.POST_ENTREGA,
    etiqueta: 'Reseña post-entrega',
    demoraHoras: 24,
    plantilla: 'post_entrega_resena',
    categoria: 'UTILITY',
    exigeProductoDisponible: false,
  },
  [TipoDisparo.RECOMPRA]: {
    tipo: TipoDisparo.RECOMPRA,
    etiqueta: 'Recompra',
    demoraHoras: 25 * 24,
    plantilla: 'recompra_25',
    categoria: 'MARKETING',
    exigeProductoDisponible: true,
  },
  [TipoDisparo.REACTIVACION]: {
    tipo: TipoDisparo.REACTIVACION,
    etiqueta: 'Reactivación',
    demoraHoras: 45 * 24,
    plantilla: 'reactivacion_45',
    categoria: 'MARKETING',
    exigeProductoDisponible: false,
  },
};

export interface ConfigDisparadores {
  /** Qué disparadores están encendidos. El anexo pide activar los que el negocio priorice. */
  activos: TipoDisparo[];
  /** Demoras a medida, en horas. Lo que no esté acá usa el valor del catálogo. */
  demorasHoras?: Partial<Record<TipoDisparo, number>>;
  /** Franja en que se puede escribir, hora de Lima. */
  horaDesde: number;
  horaHasta: number;
  /** Tope de mensajes de MARKETING por cliente en la ventana de días indicada. */
  topeMarketing: number;
  topeMarketingDias: number;
}

/**
 * Por defecto arrancan los dos que el cliente priorizó —*"recomendamos
 * empezar por la recompra a 25 días y la recuperación de cotización, por su
 * retorno comercial"*— más los dos transaccionales que no molestan a nadie.
 * Los otros se encienden desde el panel cuando el negocio quiera.
 */
export const CONFIG_DISPARADORES_DEFECTO: ConfigDisparadores = {
  activos: [
    TipoDisparo.RECUPERAR_COTIZACION,
    TipoDisparo.RECOMPRA,
    TipoDisparo.VUELTA_DISPONIBILIDAD,
    TipoDisparo.POST_ENTREGA,
  ],
  horaDesde: 9,
  horaHasta: 21,
  topeMarketing: 2,
  topeMarketingDias: 30,
};

/** La hora de Lima de una fecha, sin importar dónde corra el servidor. */
export function horaEnLima(fecha: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Lima',
      hour: '2-digit',
      hour12: false,
    }).format(fecha),
  ) % 24;
}

/** ¿Se puede escribir a esta hora? */
export function enHorarioHabil(
  fecha: Date,
  config: ConfigDisparadores,
): boolean {
  const h = horaEnLima(fecha);
  return h >= config.horaDesde && h < config.horaHasta;
}

/**
 * La próxima hora a la que sí se puede escribir.
 *
 * Si la hora programada cae de noche, el mensaje NO se descarta: se corre a
 * la mañana. Descartarlo perdería la venta por un detalle de reloj.
 */
export function proximoHorarioHabil(
  fecha: Date,
  config: ConfigDisparadores,
): Date {
  if (enHorarioHabil(fecha, config)) return fecha;
  // Antes de abrir: hoy mismo al abrir. Despues de cerrar: manana al abrir.
  const dias = horaEnLima(fecha) >= config.horaHasta ? 1 : 0;
  return aLaHoraEnLima(fecha, config.horaDesde, dias);
}

/**
 * Una hora concreta del dia de Lima, sumando dias si hace falta.
 *
 * Los dias se cuentan sobre el calendario de LIMA y no sobre el de UTC. A las
 * 11 de la noche de Lima en UTC ya es el dia siguiente: sumar un dia ahi daba
 * pasado manana, y el recordatorio de "te aviso luego" llegaba 48 horas tarde.
 *
 * Lima es UTC-5 todo el anio, asi que no hay horario de verano que corregir.
 */
export function aLaHoraEnLima(
  referencia: Date,
  hora: number,
  sumarDias = 0,
): Date {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(referencia);
  const [anio, mes, dia] = partes.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + sumarDias, hora + 5, 0, 0, 0));
}

/** La demora configurada de un disparador, o la del catálogo. */
export function demoraDe(
  tipo: TipoDisparo,
  config: ConfigDisparadores,
): number {
  return config.demorasHoras?.[tipo] ?? CATALOGO_DISPAROS[tipo].demoraHoras;
}

/**
 * Cuándo toca mandarlo.
 *
 * El "carrito en espera" es el único que no cuenta horas: el cliente dijo que
 * avisaba luego, y el anexo pide recordárselo *a la mañana siguiente*. Sumar
 * 12 horas a un mensaje de las 11 de la noche daría las 11 de la mañana del
 * día siguiente por casualidad, y a uno de las 3 de la tarde le daría las 3
 * de la madrugada.
 */
export function cuandoDisparar(
  tipo: TipoDisparo,
  desde: Date,
  config: ConfigDisparadores,
): Date {
  const def = CATALOGO_DISPAROS[tipo];
  if (def.aLaManianaSiguiente) {
    return aLaHoraEnLima(desde, config.horaDesde, 1);
  }
  const programado = new Date(
    desde.getTime() + demoraDe(tipo, config) * 3600_000,
  );
  return proximoHorarioHabil(programado, config);
}

export const VENTANA_META_MS = 24 * 3600_000;

/**
 * ¿La ventana de 24 h de Meta sigue abierta?
 *
 * Abierta = texto libre y gratis. Cerrada = solo plantilla aprobada, y se
 * paga. Equivocarse acá no da un error visible: Meta simplemente no entrega
 * el mensaje, y el negocio cree que avisó.
 */
export function ventanaAbierta(
  ultimoMensajeDelCliente: Date | null | undefined,
  ahora: Date,
): boolean {
  if (!ultimoMensajeDelCliente) return false;
  return ahora.getTime() - ultimoMensajeDelCliente.getTime() < VENTANA_META_MS;
}

/** Palabras con las que la gente pide que no le escriban más. */
const FRASES_DE_BAJA = [
  // Van SIN tildes a proposito: el texto del cliente se normaliza antes de
  // comparar, asi que "numero" cubre tambien "número".
  'no me escriban',
  'no me escribas',
  'no quiero recibir',
  'dejen de escribir',
  'deja de escribir',
  'no mas mensajes',
  'desuscribir',
  'dar de baja',
  'darme de baja',
  // La gente conjuga distinto; las tres formas aparecen en chats reales.
  'eliminar mi numero',
  'eliminen mi numero',
  'borrar mi numero',
  'borren mi numero',
  'borra mi numero',
];

/**
 * ¿El cliente está pidiendo la baja?
 *
 * "BAJA" sola cuenta porque es lo que promete el pie de las plantillas. Dentro
 * de una frase larga, no: "me das de baja el precio" o "la caja" no son una
 * baja, y darla por error deja al negocio sin poder avisarle nunca más.
 */
export function pideBaja(texto: string): boolean {
  const t = (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  // Una palabra sola: tiene que ser exactamente la palabra de baja.
  if (!t.includes(' ')) return t === 'baja' || t === 'stop';
  return FRASES_DE_BAJA.filter((f) => f.includes(' ')).some((f) =>
    t.includes(f),
  );
}

/**
 * Frases con las que el cliente posterga la compra sin rechazarla.
 *
 * Es el disparador 33.3. Importa que estas frases NO se confundan con una
 * despedida (ver `esDespedidaClara` en leads-repeticion): "lo voy a pensar"
 * es una venta en pausa, no una venta perdida, y tratarla como cierre deja
 * ir al cliente que estaba a un recordatorio de comprar.
 */
const FRASES_DE_POSTERGAR = [
  'te aviso',
  'le aviso',
  'les aviso',
  'aviso luego',
  'aviso despues',
  'lo voy a pensar',
  'lo pensare',
  'déjame pensarlo',
  'dejame pensarlo',
  'mas tarde te',
  'despues te escribo',
  'luego te escribo',
  'manana te escribo',
  'lo consulto y',
  'tengo que consultarlo',
  'cuando cobre',
  'a fin de mes',
  'el proximo mes',
  'ahora no puedo',
  'por ahora no',
];

/** ¿El cliente está postergando la compra (33.3)? */
export function postergaLaCompra(texto: string): boolean {
  const t = (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 4) return false;
  return FRASES_DE_POSTERGAR.some((f) => t.includes(f));
}

export interface SituacionDelDisparo {
  tipo: TipoDisparo;
  config: ConfigDisparadores;
  ahora: Date;
  /** El cliente pidió no recibir más avisos. */
  dioDeBaja: boolean;
  /** Última vez que ESCRIBIÓ el cliente, para la ventana de 24 h. */
  ultimoMensajeDelCliente?: Date | null;
  /** Hay una persona atendiendo ese chat. */
  botPausado?: boolean;
  /** La plantilla está aprobada en la WABA del negocio. */
  plantillaAprobada?: boolean;
  /** Cuántos MARKETING ya recibió en la ventana del tope. */
  marketingRecientes?: number;
  /** Para el 33.7: el producto del que trata el aviso sigue disponible. */
  productoDisponible?: boolean;
}

export interface Veredicto {
  enviar: boolean;
  /** Con la ventana abierta se manda texto; cerrada, plantilla. */
  via?: 'texto' | 'plantilla';
  /** Por qué no se manda, en palabras que se puedan mostrar y registrar. */
  motivo?: string;
  /** Se puede reintentar más tarde (no es un "nunca"). */
  reprogramar?: boolean;
}

/**
 * La decisión final, justo antes de mandar.
 *
 * Se evalúa en el momento del envío y no al programar, porque entre una cosa
 * y la otra pasan días: el cliente pudo darse de baja, escribir (y entonces
 * el recordatorio ya no tiene sentido), o el producto pudo agotarse.
 */
export function decidirEnvio(s: SituacionDelDisparo): Veredicto {
  const def = CATALOGO_DISPAROS[s.tipo];

  if (!s.config.activos.includes(s.tipo)) {
    return { enviar: false, motivo: 'El negocio tiene este aviso apagado.' };
  }

  // La baja manda sobre todo lo demás. Es una promesa escrita en el pie de
  // cada plantilla de marketing.
  if (s.dioDeBaja) {
    return { enviar: false, motivo: 'El cliente pidió no recibir más avisos.' };
  }

  // Punto 33.7 del anexo, textual: "Prohibición estricta de disparar triggers
  // sobre artículos con estado no disponible".
  if (def.exigeProductoDisponible && s.productoDisponible === false) {
    return {
      enviar: false,
      motivo: 'El producto del aviso ya no está disponible.',
    };
  }

  if (s.botPausado) {
    // Hay una persona atendiendo: un automático encima la contradice delante
    // del cliente.
    return {
      enviar: false,
      reprogramar: true,
      motivo: 'Hay alguien atendiendo este chat.',
    };
  }

  if (!enHorarioHabil(s.ahora, s.config)) {
    return {
      enviar: false,
      reprogramar: true,
      motivo: 'Fuera del horario de atención.',
    };
  }

  const abierta = ventanaAbierta(s.ultimoMensajeDelCliente, s.ahora);

  if (def.categoria === 'MARKETING') {
    const tope = s.config.topeMarketing;
    if ((s.marketingRecientes ?? 0) >= tope) {
      return {
        enviar: false,
        motivo: `Ya recibió ${s.marketingRecientes} avisos comerciales en los últimos ${s.config.topeMarketingDias} días.`,
      };
    }
  }

  if (abierta) return { enviar: true, via: 'texto' };

  // Ventana cerrada: sin plantilla aprobada no se manda nada. Mandar texto
  // acá no da error visible — Meta no lo entrega y el negocio cree que avisó.
  if (s.plantillaAprobada === false) {
    return {
      enviar: false,
      reprogramar: true,
      motivo: `La plantilla "${def.plantilla}" todavía no está aprobada por Meta.`,
    };
  }
  return { enviar: true, via: 'plantilla' };
}
