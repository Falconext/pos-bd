/**
 * Gastos registrados desde la CAJA (`MovimientoCaja` con tipoMovimiento EGRESO).
 *
 * Son gastos reales del negocio —"pago de luz", "cambio de foco", "menú"— que
 * salen del efectivo del cajón. Viven en una tabla distinta de `GastoOperativo`
 * (que es a nivel empresa, mensual y admite recurrencias), así que los reportes
 * financieros tienen que leer AMBAS fuentes o el P&L reporta menos egresos de
 * los reales e infla la utilidad.
 *
 * Cada gasto sigue siendo UNA sola fila en su tabla de origen: acá solo se leen
 * y se normalizan, nunca se copian. Por eso se exponen como solo lectura
 * (`editable: false`): se corrigen en Caja, no en Finanzas.
 *
 * Este helper centraliza las reglas para que las tres pantallas que los
 * consumen (Finanzas → resumen, Finanzas → egresos, Rentabilidad → P&L) no se
 * desincronicen entre sí.
 */

/** Filtro común: qué movimientos de caja cuentan como gasto del periodo. */
export function egresosCajaWhere(empresaId: number, gte: Date, lte: Date) {
  return {
    empresaId,
    tipoMovimiento: 'EGRESO' as const,
    // Las transferencias entre sedes NO son gastos: es plata que cambia de
    // cajón. La caja ya las distingue con este flag.
    esTransferencia: false,
    estado: 'ACTIVO' as const,
    // Mismo criterio que usa el cierre de caja: pendientes y rechazados no
    // suman. Lista blanca explícita porque `NOT { in }` excluiría los null,
    // que son los gastos sin flujo de aprobación (y cuentan como aprobados).
    OR: [{ estadoAprobacion: null }, { estadoAprobacion: 'APROBADO' }],
    fecha: { gte, lte },
  };
}

/**
 * La caja guarda `categoriaGasto` como texto libre ("Otros", "Servicios
 * básicos", " menu") mientras que `GastoOperativo.categoria` es un enum
 * cerrado. Se mapea lo que coincide y el resto cae en OTROS; el texto original
 * se conserva en `etiqueta`, así que no se pierde información.
 */
export function mapCategoriaCaja(texto?: string | null): string {
  const t = String(texto ?? '')
    .trim()
    .toLowerCase();
  if (!t) return 'OTROS';
  if (t.includes('public')) return 'PUBLICIDAD';
  if (t.includes('sueldo') || t.includes('planilla') || t.includes('nomina'))
    return 'SUELDOS';
  if (t.includes('envio') || t.includes('envío') || t.includes('flete'))
    return 'ENVIOS';
  if (t.includes('comision') || t.includes('comisión')) return 'COMISIONES';
  if (t.includes('alquiler') || t.includes('renta')) return 'ALQUILER';
  return 'OTROS';
}

/**
 * Fecha del movimiento como YYYY-MM-DD en hora de Lima. No usar
 * `toISOString().split('T')[0]`: un gasto de las 21:00 de Lima es 02:00 UTC del
 * día siguiente y quedaría contado en el día equivocado.
 */
export function fechaKeyLima(fecha: Date): string {
  return fecha.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

/** Fila cruda de MovimientoCaja que este helper necesita. */
export interface MovimientoEgresoCaja {
  id: number;
  fecha: Date;
  monto: any;
  categoriaGasto: string | null;
  descripcionGasto: string | null;
  metodoPago: string | null;
  sedeId: number | null;
  usuario?: { nombre: string | null } | null;
  sede?: { nombre: string | null } | null;
}

/**
 * Normaliza un egreso de caja a la forma de un `GastoOperativo`, para que las
 * pantallas puedan renderizar ambas fuentes con el mismo componente.
 * `origen: 'CAJA'` y `editable: false` son lo que permite a la UI mostrarlos en
 * su propio bloque y evitar que alguien los vuelva a cargar a mano.
 */
export function normalizarEgresoCaja(m: MovimientoEgresoCaja) {
  const monto = Number(m.monto ?? 0);
  return {
    id: m.id,
    fecha: m.fecha,
    categoria: mapCategoriaCaja(m.categoriaGasto),
    etiqueta: m.categoriaGasto?.trim() || null,
    descripcion: m.descripcionGasto ?? null,
    monto,
    moneda: 'PEN',
    tipoCambio: null,
    medioPago: m.metodoPago ?? 'Efectivo',
    recurrenteDiario: false,
    fechaInicio: null,
    fechaFin: null,
    // Un gasto de caja siempre aplica a un solo día (no hay recurrencia).
    dias: 1,
    montoPeriodo: monto,
    // Metadatos propios de la caja, para que la UI muestre de dónde viene.
    origen: 'CAJA' as const,
    editable: false,
    sedeId: m.sedeId,
    sedeNombre: m.sede?.nombre ?? null,
    usuarioNombre: m.usuario?.nombre ?? null,
  };
}

export type EgresoCajaNormalizado = ReturnType<typeof normalizarEgresoCaja>;

/** Select mínimo compartido por las consultas de egresos de caja. */
export const EGRESO_CAJA_SELECT = {
  id: true,
  fecha: true,
  monto: true,
  categoriaGasto: true,
  descripcionGasto: true,
  metodoPago: true,
  sedeId: true,
  usuario: { select: { nombre: true } },
  sede: { select: { nombre: true } },
} as const;
