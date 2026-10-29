/**
 * En qué situaciones la IA pasa el chat a una persona, elegidas por el negocio.
 *
 * La lista de motivos (`MOTIVOS_DERIVACION`) era la misma para todos y vivía
 * solo en el código: el dueño no la veía ni podía cambiarla. Una tienda que
 * maneja ella misma los reclamos, o que no vende al por mayor, no tenía cómo
 * decirle a la IA "eso lo resuelves tú". YaVendió lo muestra como casillas, y
 * así quedó acá (Mi vendedor → Personalidad).
 *
 * Sin configurar = todos los motivos, como siempre. "Pide hablar con una
 * persona" no se puede apagar: dejar a alguien pidiendo un humano sin
 * respuesta es lo peor que puede hacer el bot.
 *
 * Solo limita lo que decide el MODELO. Las derivaciones que hace el sistema
 * (cancelación que no se puede hacer sola, promesa de contacto sin
 * herramienta, opción del menú) usan el ejecutor sin este filtro.
 */
import type { EjecutorHerramienta } from '../gemini/gemini.service';
import { HERRAMIENTA_DERIVAR } from './leads-herramientas';
import {
  MOTIVOS_DERIVACION,
  type MotivoDerivacion,
  motivoDerivacionValido,
} from './pausa-bot';

export const SIEMPRE_SE_DERIVA: MotivoDerivacion = 'pide_hablar_con_persona';

/** Cómo lo dice el panel y cómo se le explica a la IA. */
export const ETIQUETA_MOTIVO: Record<MotivoDerivacion, string> = {
  mayorista: 'compra al por mayor o es revendedor',
  reclamo: 'reclamo, producto dañado o equivocado, cambio o devolución',
  seguimiento_de_pedido: 'pregunta cómo va un pedido ya hecho',
  descuento_especial: 'pide un descuento fuera de la regla',
  producto_no_disponible: 'quiere un producto que no tenemos y pide conseguirlo',
  cancelacion: 'quiere cancelar un pedido',
  pide_hablar_con_persona: 'pide hablar con una persona',
};

/** Lo guardado, saneado. `undefined` = sin configurar (todos). */
export function derivarEnValido(raw: unknown): MotivoDerivacion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const elegidos = new Set(
    raw.filter((m): m is MotivoDerivacion =>
      (MOTIVOS_DERIVACION as readonly string[]).includes(m as string),
    ),
  );
  elegidos.add(SIEMPRE_SE_DERIVA);
  // En el orden de la lista, para que guardar dos veces lo mismo no cambie nada.
  return MOTIVOS_DERIVACION.filter((m) => elegidos.has(m));
}

/** Los apagados, o vacío si deriva por todo. */
export function motivosApagados(derivarEn: MotivoDerivacion[] | undefined): MotivoDerivacion[] {
  if (!derivarEn) return [];
  return MOTIVOS_DERIVACION.filter((m) => !derivarEn.includes(m));
}

/**
 * Para el prompt fijo del negocio. Vacío si no apagó nada: así el prompt de
 * quien no tocó las casillas queda igual que antes.
 */
export function bloqueDerivacion(derivarEn: MotivoDerivacion[] | undefined): string {
  const apagados = motivosApagados(derivarEn);
  if (!apagados.length) return '';
  return [
    'DERIVAR EN ESTE NEGOCIO (lo decidió el dueño): en estos casos NO derives, atiéndelos tú con la información del negocio y sigue la conversación:',
    ...apagados.map((m) => `- El cliente ${ETIQUETA_MOTIVO[m]}.`),
    'Si el cliente pide hablar con una persona, derívalo siempre.',
  ].join('\n');
}

/**
 * El ejecutor que recibe el modelo: si deriva por un motivo que el negocio
 * apagó, no se deriva y se le dice que lo atienda él.
 */
export function conMotivosDelNegocio(
  ejecutor: EjecutorHerramienta,
  derivarEn: MotivoDerivacion[] | undefined,
): EjecutorHerramienta {
  const apagados = motivosApagados(derivarEn);
  if (!apagados.length) return ejecutor;
  return async (nombre, argumentos) => {
    if (nombre === HERRAMIENTA_DERIVAR) {
      const motivo = motivoDerivacionValido(String(argumentos?.motivo ?? ''));
      if (motivo && apagados.includes(motivo)) {
        return {
          derivado: false,
          instruccion:
            'En este negocio eso no se deriva: lo atiendes tú. Responde con la información del negocio que tienes, ' +
            'ofrece una solución o el siguiente paso, y sigue la conversación. No le digas al cliente que lo pasaste con nadie.',
        };
      }
    }
    return ejecutor(nombre, argumentos);
  };
}
