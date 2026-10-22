/**
 * El turno de caja sigue abierto pasada la medianoche.
 *
 * Caso real (LA DESPENSA HM, 21-10): abren a las 17:00 y venden después de las
 * 12; a esa hora el celular mostraba la caja cerrada y tenían que abrir otra.
 */
import {
  HORAS_TURNO_ABIERTO,
  turnosEnCurso,
  turnosSinCuadrar,
  ventanaTurnoAbierto,
  type MovimientoTurno,
} from './turno-abierto';

// 21/10 17:18 hora Lima = 21/10 22:18 UTC.
const APERTURA_TARDE = new Date('2026-10-21T22:18:00.000Z');
const horas = (base: Date, h: number) => new Date(base.getTime() + h * 3_600_000);

let siguienteId = 1;
const mov = (
  tipoMovimiento: 'APERTURA' | 'CIERRE',
  fecha: Date,
  extra: Partial<MovimientoTurno> = {},
): MovimientoTurno => ({
  id: siguienteId++,
  fecha,
  tipoMovimiento,
  sedeId: 67,
  usuarioId: 81,
  movimientoVinculadoId: null,
  ...extra,
});

describe('ventanaTurnoAbierto', () => {
  it('a la 1 de la mañana todavía alcanza la apertura de las 17:18', () => {
    const unaAm = horas(APERTURA_TARDE, 7.7); // 22/10 01:00 Lima
    const { gte, lte } = ventanaTurnoAbierto(unaAm);
    expect(gte <= APERTURA_TARDE).toBe(true);
    expect(lte).toEqual(unaAm);
  });

  it(`deja afuera una apertura de hace más de ${HORAS_TURNO_ABIERTO} horas`, () => {
    const { gte } = ventanaTurnoAbierto(horas(APERTURA_TARDE, HORAS_TURNO_ABIERTO + 1));
    expect(gte > APERTURA_TARDE).toBe(true);
  });

  it('sin fecha de referencia no pone techo (la base puede ir adelantada)', () => {
    expect(ventanaTurnoAbierto().lte).toBeUndefined();
  });
});

describe('turnosSinCuadrar', () => {
  it('el turno en curso de ayer no es un pendiente', () => {
    const a = mov('APERTURA', APERTURA_TARDE);
    expect(turnosSinCuadrar([a], horas(APERTURA_TARDE, 8))).toEqual([]);
  });

  it('cerrado pasada la medianoche con el vínculo: no queda pendiente', () => {
    const a = mov('APERTURA', APERTURA_TARDE);
    const c = mov('CIERRE', horas(APERTURA_TARDE, 8), { movimientoVinculadoId: a.id });
    expect(turnosSinCuadrar([a, c], horas(APERTURA_TARDE, 60))).toEqual([]);
  });

  it('cierre viejo sin vínculo al día siguiente: se empareja por usuario', () => {
    const a = mov('APERTURA', APERTURA_TARDE);
    const c = mov('CIERRE', horas(APERTURA_TARDE, 8));
    expect(turnosSinCuadrar([a, c], horas(APERTURA_TARDE, 60))).toEqual([]);
  });

  it('un administrador cuadró el turno de otro el mismo día: se empareja por día', () => {
    const a = mov('APERTURA', APERTURA_TARDE);
    const c = mov('CIERRE', horas(APERTURA_TARDE, 1), { usuarioId: 1 });
    expect(turnosSinCuadrar([a, c], horas(APERTURA_TARDE, 60))).toEqual([]);
  });

  it('olvidado más allá del tope: sí es pendiente', () => {
    const a = mov('APERTURA', APERTURA_TARDE);
    expect(turnosSinCuadrar([a], horas(APERTURA_TARDE, HORAS_TURNO_ABIERTO + 1))).toEqual([a]);
  });

  it('si el mismo usuario abrió otro después, el anterior es pendiente', () => {
    const viejo = mov('APERTURA', APERTURA_TARDE);
    const nuevo = mov('APERTURA', horas(APERTURA_TARDE, 20));
    expect(turnosSinCuadrar([viejo, nuevo], horas(APERTURA_TARDE, 21))).toEqual([viejo]);
  });

  it('el cierre de una sede no cierra el turno de otra', () => {
    const a = mov('APERTURA', APERTURA_TARDE);
    const c = mov('CIERRE', horas(APERTURA_TARDE, 1), { sedeId: 99 });
    expect(turnosSinCuadrar([a, c], horas(APERTURA_TARDE, 60))).toEqual([a]);
  });

  it('dos cajeros en la misma sede: el cierre de uno no cierra el del otro', () => {
    const ana = mov('APERTURA', APERTURA_TARDE, { usuarioId: 10 });
    const beto = mov('APERTURA', horas(APERTURA_TARDE, 0.5), { usuarioId: 20 });
    const cierreAna = mov('CIERRE', horas(APERTURA_TARDE, 26), { usuarioId: 10, movimientoVinculadoId: ana.id });
    // Beto sigue con su turno en curso (dentro del tope): nada pendiente.
    expect(turnosSinCuadrar([ana, beto, cierreAna], horas(APERTURA_TARDE, 27))).toEqual([]);
    // Pasado el tope, el de Beto sí.
    expect(turnosSinCuadrar([ana, beto, cierreAna], horas(APERTURA_TARDE, 60))).toEqual([beto]);
  });
});

describe('turnos en curso del equipo (LA DESPENSA HM, 22-10)', () => {
  it('el dueño ve el turno que su cajera tiene abierto, y no los pendientes', () => {
    const viejo = mov('APERTURA', horas(APERTURA_TARDE, -120), { usuarioId: 159 });
    const cajera = mov('APERTURA', APERTURA_TARDE, { usuarioId: 160 });
    const enCurso = turnosEnCurso([viejo, cajera], horas(APERTURA_TARDE, 7));
    expect(enCurso).toEqual([cajera]);
    expect(turnosSinCuadrar([viejo, cajera], horas(APERTURA_TARDE, 7))).toEqual([viejo]);
  });

  it('cerrado o pasado el tope, ya no está en curso', () => {
    const a = mov('APERTURA', APERTURA_TARDE, { usuarioId: 160 });
    const c = mov('CIERRE', horas(APERTURA_TARDE, 7), { usuarioId: 160, movimientoVinculadoId: a.id });
    expect(turnosEnCurso([a, c], horas(APERTURA_TARDE, 8))).toEqual([]);
    expect(turnosEnCurso([a], horas(APERTURA_TARDE, HORAS_TURNO_ABIERTO + 1))).toEqual([]);
  });
});
