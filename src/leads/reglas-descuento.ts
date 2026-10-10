/**
 * B3 — descuentos por pack, calculados en código y nunca por la IA.
 *
 * Un modelo de lenguaje no sabe sumar de forma confiable, y el cliente pide
 * auditoría matemática al 100% en cinco carritos combinados "sin desajuste de
 * céntimos". Por eso esto es una función pura, sin IA, y por eso trabaja en
 * céntimos enteros: con flotantes, 0.1 + 0.2 ya no es 0.3 y el total sale
 * descuadrado por un céntimo cada tantas ventas.
 *
 * Las reglas son datos, no código: cambiar los tramos es cambiar una tabla.
 */

/** Un escalón de descuento. Solo se aplica el más alto que se alcance. */
export interface TramoDescuento {
  /** Cuánto se descuenta, en soles. */
  descuento: number;
  /** Unidades válidas mínimas (cantidad, no productos distintos). */
  unidades: number;
  /** El total tiene que SUPERAR este monto; igualarlo no basta. */
  totalMayorQue: number;
}

export interface ReglasDescuento {
  /**
   * Solo cuenta como unidad válida lo que supere este precio unitario. Los
   * productos más baratos entran en la cotización, pero no suman para el
   * escalón.
   */
  precioUnitarioMinimo: number;
  /** Si el envío entra en el total que se compara contra el tramo. */
  envioCuentaEnTotal: boolean;
  tramos: TramoDescuento[];
}

/**
 * La regla de Hierba Sana, según sus tres documentos (prompt AGENTE_01, flujo
 * V20.2 y base de conocimiento V3), que coinciden entre sí.
 *
 * OJO: la propuesta firmada dice otra cosa (3/6/8 unidades y 90/170/220). Está
 * pendiente de que el cliente confirme cuál manda; mientras tanto vale la de
 * sus documentos, que es la que su bot venía aplicando. Cambiarla es cambiar
 * estos seis números.
 */
/**
 * Sin tramos: ninguna empresa regala plata por defecto.
 *
 * Es el valor que se usa cuando la empresa no configuró descuentos, y la
 * razón es concreta: con los tramos de Hierba Sana como defecto, CUALQUIER
 * otra tienda de la plataforma empezaba a descontar S/ 10 a S/ 30 por pedido
 * sin que su dueño lo hubiera pedido ni lo supiera.
 */
export const SIN_DESCUENTO: ReglasDescuento = {
  precioUnitarioMinimo: 0,
  envioCuentaEnTotal: false,
  tramos: [],
};

export const REGLAS_HIERBA_SANA: ReglasDescuento = {
  precioUnitarioMinimo: 20,
  envioCuentaEnTotal: true,
  tramos: [
    { descuento: 10, unidades: 3, totalMayorQue: 90 },
    { descuento: 20, unidades: 5, totalMayorQue: 170 },
    { descuento: 30, unidades: 7, totalMayorQue: 250 },
  ],
};

export interface ItemCotizacion {
  precioUnitario: number;
  cantidad: number;
}

export interface ResultadoDescuento {
  subtotal: number;
  envio: number;
  /** Productos + envío. Es contra esto que se miden los tramos. */
  total: number;
  /** Cuántas unidades cuentan para el escalón. */
  unidadesValidas: number;
  /** 0 si no se alcanzó ningún tramo. */
  descuento: number;
  montoAPagar: number;
  /**
   * Cuántas unidades le faltan para el siguiente escalón, SOLO cuando el monto
   * ya alcanza y es cuestión de una o dos unidades. Si además le falta dinero
   * no se sugiere nada: decirle "te falta una unidad" cuando también le faltan
   * S/ 70 es engañarlo.
   */
  faltaParaSiguiente: { unidades: number; descuento: number } | null;
}

/** Máximas unidades que tiene sentido sugerir para llegar al siguiente tramo. */
const MAX_UNIDADES_A_SUGERIR = 2;

const aCentimos = (soles: number): number => Math.round(soles * 100);
const aSoles = (centimos: number): number => centimos / 100;

export function calcularDescuento(
  items: ItemCotizacion[],
  envio: number,
  reglas: ReglasDescuento = REGLAS_HIERBA_SANA,
): ResultadoDescuento {
  const subtotalC = items.reduce(
    (acc, i) => acc + aCentimos(i.precioUnitario) * Math.max(0, i.cantidad),
    0,
  );
  const envioC = aCentimos(envio);
  const totalC = subtotalC + envioC;
  // Lo que se compara contra el tramo: con o sin envío, según la regla.
  const baseC = reglas.envioCuentaEnTotal ? totalC : subtotalC;

  const minimoC = aCentimos(reglas.precioUnitarioMinimo);
  const unidadesValidas = items.reduce(
    (acc, i) =>
      aCentimos(i.precioUnitario) > minimoC
        ? acc + Math.max(0, i.cantidad)
        : acc,
    0,
  );

  // De mayor a menor: el primero que se alcance es el que manda.
  const ordenados = [...reglas.tramos].sort(
    (a, b) => b.descuento - a.descuento,
  );
  const alcanzado = ordenados.find(
    (t) => unidadesValidas >= t.unidades && baseC > aCentimos(t.totalMayorQue),
  );
  const descuentoC = alcanzado ? aCentimos(alcanzado.descuento) : 0;

  return {
    subtotal: aSoles(subtotalC),
    envio: aSoles(envioC),
    total: aSoles(totalC),
    unidadesValidas,
    descuento: aSoles(descuentoC),
    montoAPagar: aSoles(totalC - descuentoC),
    faltaParaSiguiente: siguienteAlAlcance(
      ordenados,
      unidadesValidas,
      baseC,
      alcanzado?.descuento ?? 0,
    ),
  };
}

/**
 * El tramo más bajo que todavía no alcanza, cuando solo le faltan unidades
 * (el monto ya da) y son pocas.
 */
function siguienteAlAlcance(
  tramosOrdenados: TramoDescuento[],
  unidadesValidas: number,
  baseC: number,
  descuentoActual: number,
): { unidades: number; descuento: number } | null {
  const candidatos = tramosOrdenados
    .filter((t) => t.descuento > descuentoActual)
    .sort((a, b) => a.descuento - b.descuento);

  for (const t of candidatos) {
    // Si todavía le falta dinero, no es cuestión de unidades.
    if (baseC <= aCentimos(t.totalMayorQue)) continue;
    const faltan = t.unidades - unidadesValidas;
    if (faltan > 0 && faltan <= MAX_UNIDADES_A_SUGERIR) {
      return { unidades: faltan, descuento: t.descuento };
    }
  }
  return null;
}

/** Formato de moneda que usa Hierba Sana en el chat: `S/ 25.00`. */
export function soles(monto: number): string {
  return `S/ ${monto.toFixed(2)}`;
}
