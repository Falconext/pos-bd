/**
 * Cuándo un emisor puede emitir, y qué decirle al integrador cuando no.
 *
 * Esto no es burocracia: es dinero. El correlativo se asigna al CREAR el
 * comprobante, antes de que SUNAT opine, así que cada intento contra un RUC
 * no habilitado gasta un número de serie que no vuelve. En producción hay
 * cuatro RUCs que quemaron 15 correlativos entre todos intentando emitir sin
 * estar dados de alta — uno de ellos siete veces en nueve días, porque nada
 * le dijo que el problema no se iba a resolver reintentando.
 *
 * Con esta puerta, ese caso cuesta un correlativo en vez de siete.
 *
 * Los tres estados y por qué existen:
 *
 *  - `pendiente`: se vinculó hace poco. QPSE tarda unas 24 h en completar el
 *    alta ante SUNAT, así que durante esa ventana emitir es tirar plata. Se
 *    rechaza ANTES de crear nada, diciendo cuándo estará listo.
 *  - `activo`: SUNAT ya le aceptó un comprobante. Es la única prueba real de
 *    que la habilitación funcionó; cualquier otra sería una suposición.
 *  - `bloqueado`: SUNAT rechazó por falta de habilitación. No se resuelve
 *    reintentando, lo tiene que arreglar el contribuyente, así que se corta
 *    hasta que alguien confirme que ya está.
 */

export type EstadoEmisor = 'pendiente' | 'activo' | 'bloqueado';

/**
 * Lo que QPSE indica que demora el alta. No es una promesa: ellos mismos
 * dicen "aproximadamente 24 horas, aunque pueden demorar más si SUNAT
 * presenta intermitencias".
 */
export const ESPERA_ALTA_MS = 24 * 60 * 60 * 1000;

/**
 * Códigos de SUNAT que significan "este RUC no está habilitado para emitir".
 *
 * Son los dos que aparecen de verdad en producción. No se resuelven solos:
 * 0111 es que el RUC no tiene el perfil de emisor electrónico y 0154 que no
 * autorizó al PSE. Los dos los arregla el contribuyente en SUNAT, nunca un
 * reintento.
 */
export const CODIGOS_SIN_HABILITACION: readonly string[] = ['0111', '0154'];

export const esFaltaDeHabilitacion = (codigo: string | null): boolean =>
  codigo !== null && CODIGOS_SIN_HABILITACION.includes(codigo.trim());

export interface EmisorParaEmitir {
  apiEmisorEstado?: string | null;
  apiEmisorDesde?: Date | null;
  apiEmisorMotivo?: string | null;
  usuarioPse?: string | null;
}

export type Veredicto =
  | { puede: true }
  | { puede: false; codigo: string; mensaje: string; disponibleEn?: Date };

/**
 * ¿Puede este emisor emitir ahora?
 *
 * Un emisor sin estado se deja pasar: son los que existían antes de que la
 * API tuviera ciclo de vida, y bloquearlos retroactivamente sería romper lo
 * que hoy funciona.
 */
export const puedeEmitir = (
  emisor: EmisorParaEmitir,
  ahora: Date = new Date(),
): Veredicto => {
  if (!emisor.usuarioPse?.trim()) {
    return {
      puede: false,
      codigo: 'issuer_not_configured',
      mensaje:
        'Este emisor todavía no tiene credenciales de firma configuradas. Escríbenos para completarlo.',
    };
  }

  if (emisor.apiEmisorEstado === 'bloqueado') {
    return {
      puede: false,
      codigo: 'issuer_not_authorized',
      mensaje:
        emisor.apiEmisorMotivo?.trim() ||
        'SUNAT rechazó este RUC por falta de habilitación como emisor electrónico. ' +
          'No se resuelve reintentando: el contribuyente debe habilitarse en SUNAT y autorizar al PSE.',
    };
  }

  if (emisor.apiEmisorEstado === 'pendiente') {
    const desde = emisor.apiEmisorDesde?.getTime();
    // Sin fecha no se puede saber si pasó la ventana. Se deja emitir: una
    // puerta que bloquea sin poder justificarlo es peor que una abierta.
    if (desde === undefined) return { puede: true };

    const listo = new Date(desde + ESPERA_ALTA_MS);
    if (ahora < listo) {
      return {
        puede: false,
        codigo: 'issuer_not_ready',
        mensaje:
          'El alta de este RUC ante SUNAT todavía está en curso. Suele estar listo al día siguiente. ' +
          'Emitir antes consumiría un correlativo que no se puede recuperar.',
        disponibleEn: listo,
      };
    }
  }

  return { puede: true };
};

/**
 * El estado que corresponde después de que SUNAT contestó.
 *
 * `null` significa "no cambia nada": la mayoría de las respuestas no dicen
 * nada sobre la habilitación del RUC y no deben tocar su estado.
 */
export const estadoSegunRespuesta = (
  estadoPublico: string | null,
  codigoCdr: string | null,
): { estado: EstadoEmisor; motivo?: string } | null => {
  // Que SUNAT lo acepte es la única prueba real de que el alta funcionó.
  if (estadoPublico === 'accepted' || estadoPublico === 'observed') {
    return { estado: 'activo' };
  }
  if (estadoPublico === 'rejected' && esFaltaDeHabilitacion(codigoCdr)) {
    return {
      estado: 'bloqueado',
      motivo:
        codigoCdr === '0111'
          ? 'SUNAT responde 0111: el RUC no tiene el perfil para enviar comprobantes electrónicos. ' +
            'El contribuyente debe habilitarse como emisor electrónico en SUNAT.'
          : 'SUNAT responde 0154: el RUC no autorizó al proveedor de firma (PSE). ' +
            'El contribuyente debe autorizarlo desde su clave SOL.',
    };
  }
  return null;
};
