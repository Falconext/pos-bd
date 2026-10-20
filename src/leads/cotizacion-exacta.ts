/**
 * La cotización que lee el cliente es la que armó el código, letra por letra.
 *
 * `cotizar` devuelve el texto con el formato del negocio y la herramienta le
 * pide al modelo copiarlo tal cual. En la prueba del 20-10 lo reescribió:
 * "Envío Callao: S/ 15.00" salió como "Costo por envío: S/ 15.00" y se
 * perdió el nombre del pack. Peor fue la noche anterior, cuando escribió una
 * cotización entera por su cuenta. Como el descargo legal y la confirmación
 * falsa, lo que no puede variar lo pone el código.
 */
import type { LlamadaHerramienta } from '../gemini/gemini.service';
import { HERRAMIENTA_COTIZAR } from './leads-herramientas';

const INICIO = /te adjunto la cotizaci[oó]n/i;
/** Líneas que todavía son parte del cuadro de la cotización. */
const LINEA_DE_CUADRO =
  /^\s*(\*?\d+\s*x\s|gu[ií]a de consumo|\*?(costo (por|de) )?env[ií]o|\*?total|descuento|\*?monto a pagar|\(con \d+ unidad)/i;

/** El cuadro de la cotización, sin la pregunta de cierre. */
function cuadro(texto: string): string {
  const lineas = texto.split('\n');
  const fin = lineas.findIndex((l) => l.startsWith('Esta sería la cotización'));
  return (fin === -1 ? lineas : lineas.slice(0, fin)).join('\n').trimEnd();
}

export function conCotizacionExacta(
  respuesta: string,
  llamadas: LlamadaHerramienta[],
): string {
  const ultima = [...llamadas]
    .reverse()
    .find(
      (ll) =>
        ll.nombre === HERRAMIENTA_COTIZAR &&
        typeof (ll.resultado as { texto?: unknown } | null)?.texto === 'string',
    );
  if (!ultima) return respuesta;
  const exacto = cuadro((ultima.resultado as { texto: string }).texto);
  if (respuesta.includes(exacto)) return respuesta;

  const lineas = respuesta.split('\n');
  const desde = lineas.findIndex((l) => INICIO.test(l));
  // Sin cuadro en la respuesta no se inventa uno: el modelo pudo haber
  // cotizado y preguntar otra cosa primero.
  if (desde === -1) return respuesta;
  let hasta = desde;
  for (let i = desde + 1; i < lineas.length; i++) {
    if (LINEA_DE_CUADRO.test(lineas[i])) hasta = i;
    else if (lineas[i].trim() !== '') break;
  }
  return [...lineas.slice(0, desde), exacto, ...lineas.slice(hasta + 1)].join('\n');
}
