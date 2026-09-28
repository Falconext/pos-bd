/**
 * Las excepciones de comisión.
 *
 * Nacen del pedido de IMPORTEMOS JUNTOS: el fin de semana se paga más que de
 * lunes a viernes. Hoy lo resuelven duplicando productos con distinta comisión.
 *
 * Lo que más importa acá no es que la regla nueva funcione, sino que **una
 * empresa sin reglas no cambie de comisión**: la tabla arranca vacía y así se
 * queda hasta que alguien cargue una a propósito.
 */
import {
  describirRegla,
  diaEnPeru,
  elegirRegla,
  especificidad,
  reglaAplica,
  type ReglaComision,
} from './regla-comision';

/** Setiembre 2026: el 26 cae sábado, el 27 domingo y el 28 lunes. */
const enLima = (dia: number, hora = 12) =>
  new Date(Date.UTC(2026, 8, dia, hora + 5));

const SABADO = enLima(26);
const DOMINGO = enLima(27);
const LUNES = enLima(28);

const FIN_DE_SEMANA = '0,6';
const JOSHI = 131;
const FATIMA = 16;
const HOLDER = 7739;

const venta = (fecha: Date, vendedorId = JOSHI, productoId = HOLDER) => ({
  productoId,
  vendedorId,
  fecha,
});

describe('Sin reglas cargadas, nada cambia', () => {
  it('una empresa sin reglas no obtiene ninguna: sigue la cascada de siempre', () => {
    // Es la garantía de que esto no le toca la comisión a nadie que no lo pida.
    expect(elegirRegla([], venta(SABADO))).toBeNull();
    expect(elegirRegla([], venta(LUNES))).toBeNull();
  });

  it('una regla desactivada es como si no existiera', () => {
    const regla: ReglaComision = { id: 1, diasSemana: FIN_DE_SEMANA, montoFijo: 9, activa: false };
    expect(elegirRegla([regla], venta(SABADO))).toBeNull();
  });
});

describe('El caso de IMPORTEMOS JUNTOS: el fin de semana se paga más', () => {
  const finDeSemana: ReglaComision = { id: 1, diasSemana: FIN_DE_SEMANA, montoFijo: 9 };

  it('el sábado y el domingo aplica', () => {
    expect(elegirRegla([finDeSemana], venta(SABADO))?.id).toBe(1);
    expect(elegirRegla([finDeSemana], venta(DOMINGO))?.id).toBe(1);
  });

  it('de lunes a viernes no aplica: cae a la comisión del producto', () => {
    expect(elegirRegla([finDeSemana], venta(LUNES))).toBeNull();
  });

  it('aplica a CUALQUIERA que venda ese día, no solo a Joshi', () => {
    // Es la razón de modelarlo por día y no por vendedor: si Fátima cubre un
    // domingo, cobra la tarifa del domingo sin tocar ninguna configuración.
    expect(elegirRegla([finDeSemana], venta(DOMINGO, FATIMA))?.id).toBe(1);
  });

  it('el motivo que se guarda dice "fin de semana", no "0,6"', () => {
    // Esta línea es la que se le muestra al vendedor cuando reclama.
    expect(describirRegla(finDeSemana, venta(SABADO))).toBe(
      'Regla de comisión (fin de semana)',
    );
  });
});

describe('El día se resuelve en hora de Perú', () => {
  it('domingo 23:30 de Lima sigue siendo domingo, aunque en UTC ya sea lunes', () => {
    // 2026-09-28 04:30 UTC = domingo 23:30 en Lima. Con la hora del servidor
    // esta venta se pagaría a tarifa de lunes.
    const domingoDeNoche = new Date('2026-09-28T04:30:00Z');
    expect(diaEnPeru(domingoDeNoche)).toBe(0);
    const finDeSemana: ReglaComision = { id: 1, diasSemana: FIN_DE_SEMANA, montoFijo: 9 };
    expect(reglaAplica(finDeSemana, venta(domingoDeNoche))).toBe(true);
  });

  it('lunes de madrugada en Lima ya es lunes', () => {
    // 2026-09-28 14:00 UTC = lunes 09:00 en Lima.
    expect(diaEnPeru(new Date('2026-09-28T14:00:00Z'))).toBe(1);
  });
});

describe('Gana la regla más específica', () => {
  const general: ReglaComision = { id: 1, montoFijo: 5 };
  const porDia: ReglaComision = { id: 2, diasSemana: FIN_DE_SEMANA, montoFijo: 9 };
  const porProductoYDia: ReglaComision = {
    id: 3, productoId: HOLDER, diasSemana: FIN_DE_SEMANA, montoFijo: 12,
  };
  const porVendedor: ReglaComision = { id: 4, vendedorId: JOSHI, montoFijo: 7 };

  it('cuenta las condiciones: a más condiciones, más específica', () => {
    expect(especificidad(general)).toBe(0);
    expect(especificidad(porDia)).toBe(1);
    expect(especificidad(porProductoYDia)).toBe(2);
  });

  it('una excepción de producto+día le gana a la de solo día', () => {
    const r = elegirRegla([general, porDia, porProductoYDia], venta(SABADO));
    expect(r?.id).toBe(3);
  });

  it('un lunes gana la de vendedor, porque la de fin de semana no aplica', () => {
    const r = elegirRegla([general, porDia, porProductoYDia, porVendedor], venta(LUNES));
    expect(r?.id).toBe(4);
  });

  it('sin nada más específico queda la general', () => {
    const r = elegirRegla([general, porDia], venta(LUNES, FATIMA));
    expect(r?.id).toBe(1);
  });

  it('entre dos igual de específicas gana la última cargada', () => {
    // Arbitrario pero determinista, y se le puede explicar a alguien:
    // "vale la más reciente".
    const a: ReglaComision = { id: 10, diasSemana: FIN_DE_SEMANA, montoFijo: 9 };
    const b: ReglaComision = { id: 11, diasSemana: FIN_DE_SEMANA, montoFijo: 11 };
    expect(elegirRegla([a, b], venta(SABADO))?.id).toBe(11);
    expect(elegirRegla([b, a], venta(SABADO))?.id).toBe(11);
  });
});

describe('Condiciones mal cargadas no rompen el cálculo', () => {
  it('días vacíos se leen como "todos los días"', () => {
    expect(reglaAplica({ id: 1, diasSemana: '', montoFijo: 9 }, venta(LUNES))).toBe(true);
    expect(reglaAplica({ id: 1, diasSemana: '   ', montoFijo: 9 }, venta(LUNES))).toBe(true);
  });

  it('días con basura se ignoran en vez de tumbar la venta', () => {
    // Si alguien deja "sabado" escrito a mano, la regla no filtra por día;
    // preferible a que reviente la emisión de un comprobante.
    expect(reglaAplica({ id: 1, diasSemana: 'sabado', montoFijo: 9 }, venta(LUNES))).toBe(true);
  });

  it('un día fuera de rango se descarta y quedan los válidos', () => {
    const r: ReglaComision = { id: 1, diasSemana: '6,99', montoFijo: 9 };
    expect(reglaAplica(r, venta(SABADO))).toBe(true);
    expect(reglaAplica(r, venta(LUNES))).toBe(false);
  });
});
