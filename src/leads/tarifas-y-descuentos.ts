import type { ConfigComercial } from './leads-pedido.service';

/**
 * Las tarifas y los descuentos, escritos a partir de la configuración.
 *
 * Antes estos números vivían en dos sitios: en el texto que el empresario
 * edita a mano —que es lo que la IA DICE— y en `iaVentasConfigJson`, que es
 * lo que el código CALCULA. Dos verdades para el mismo dato.
 *
 * Medido sobre el contexto real de Hierba Sana, subir el delivery de Lima de
 * S/ 15 a S/ 18 obligaba a tocar cinco lugares: la configuración más cuatro
 * líneas sueltas del texto, en cuatro secciones distintas. Olvidar una no
 * rompe nada visible: el bot sigue cotizando bien y miente en un solo caso,
 * el más difícil de encontrar.
 *
 * Con esto el número vive en la configuración y el prompt lo recibe escrito.
 * Lo que la IA dice es, por construcción, lo que el sistema va a cobrar.
 *
 * El bloque se declara AUTORITATIVO a propósito: mientras los clientes que ya
 * tienen los números copiados en su texto no lo limpien, las dos versiones
 * conviven, y el modelo necesita saber cuál manda.
 */
export function bloqueComercial(config: ConfigComercial): string {
  const partes = [lineasDeEnvio(config), lineasDeDescuento(config)].filter(
    (p): p is string => !!p,
  );
  if (partes.length === 0) return '';
  return [
    'TARIFAS Y DESCUENTOS VIGENTES',
    'Estos son los números que el sistema usa para cotizar. Si en otra parte de este contexto aparece otra cifra para lo mismo, la que vale es esta.',
    ...partes,
  ].join('\n');
}

/** Cómo se le nombra cada tipo de zona al cliente. */
const COMO_LLEGA: Record<string, string> = {
  DOMICILIO: 'entrega a domicilio',
  AGENCIA: 'envío a agencia',
  RECOJO: 'recojo en tienda',
};

/** La nota del negocio arranca en minúscula; detrás de un punto queda mal. */
function mayuscula(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function igualIgnorandoFormato(a: string, b: string): boolean {
  const n = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  return n(a) === n(b);
}

function lineasDeEnvio(config: ConfigComercial): string | null {
  const zonas = config.envio?.zonas ?? [];
  if (zonas.length === 0) return null;
  const filas = zonas.map((z) => {
    const como = COMO_LLEGA[String(z.tipo)] ?? String(z.tipo).toLowerCase();
    // "Recojo en tienda (recojo en tienda)": cuando el nombre de la zona ya
    // dice cómo llega, el paréntesis sobra.
    const comoMostrar = igualIgnorandoFormato(z.nombre, como) ? '' : ` (${como})`;
    // Cero es gratis, no "S/ 0.00": decirle a alguien que paga cero soles
    // suena a error del sistema.
    const tarifa =
      Number(z.tarifa) > 0 ? `S/ ${Number(z.tarifa).toFixed(2)}` : 'sin costo';
    const nota = z.notaPago?.trim() ? ` ${mayuscula(z.notaPago.trim())}` : '';
    return `- ${z.nombre}${comoMostrar}: ${tarifa}.${nota}`;
  });
  return ['Envío:', ...filas].join('\n');
}

function lineasDeDescuento(config: ConfigComercial): string | null {
  const reglas = config.descuento;
  const tramos = reglas?.tramos ?? [];
  // Sin tramos no se escribe nada. Un bloque que dice "no hay descuentos" es
  // una invitación a que el cliente pida uno.
  if (tramos.length === 0) return null;

  const base = reglas.envioCuentaEnTotal
    ? 'el total con el envío incluido'
    : 'el subtotal de los productos, sin el envío';
  const filas = [...tramos]
    .sort((a, b) => a.descuento - b.descuento)
    .map(
      (t) =>
        `- S/ ${Number(t.descuento).toFixed(2)} con ${t.unidades} o más unidades válidas y ${base} mayor a S/ ${Number(t.totalMayorQue).toFixed(2)}`,
    );

  const condiciones = [
    reglas.precioUnitarioMinimo > 0
      ? `Solo cuentan como unidad válida los productos de precio unitario mayor a S/ ${Number(reglas.precioUnitarioMinimo).toFixed(2)}; los más baratos entran en la cotización pero no suman para el escalón.`
      : null,
    'Aplica un solo escalón, el más alto que alcance; no se acumulan. Si no llega a ninguno, no menciones una línea de descuento en S/ 0.',
    'No negocies descuentos fuera de estos tramos.',
  ].filter((c): c is string => !!c);

  return ['Descuentos:', ...filas, ...condiciones].join('\n');
}
