/**
 * La regla de costeo que usan tanto el costo global del producto como el de
 * cada sede. Se prueba la función real, no una réplica: si alguien cambia la
 * fórmula, esto se cae.
 *
 * Importa porque es la base del costeo por sede: si estuviera mal, cada local
 * heredaría el error en su propio costo.
 */
import { costoDeSede, promedioTrasIngreso } from './costo-sede';

describe('Promedio ponderado tras un ingreso', () => {
  it('el caso normal: 10 a S/100 más 10 a S/140 da S/120', () => {
    // El stock que recibe ya está actualizado: 10 + 10 = 20.
    expect(promedioTrasIngreso(20, 10, 140, 100)).toBe(120);
  });

  it('el primer ingreso de un producto sin stock toma el costo de compra', () => {
    expect(promedioTrasIngreso(5, 5, 88, 0)).toBe(88);
  });

  it('una bonificación (costo 0) baja el promedio, no lo deja igual', () => {
    // 10 a S/100 + 10 gratis = S/50 promedio.
    expect(promedioTrasIngreso(20, 10, 0, 100)).toBe(50);
  });

  it('pondera por cantidad, no promedia a secas', () => {
    // 90 a S/10 = 900, más 10 a S/110 = 1100 → 2000/100 = S/20, no S/60.
    expect(promedioTrasIngreso(100, 10, 110, 10)).toBe(20);
  });

  it('sin stock sobre el cual costear no devuelve nada', () => {
    expect(promedioTrasIngreso(0, 0, 50, 30)).toBeNull();
    expect(promedioTrasIngreso(-3, 0, 50, 30)).toBeNull();
  });

  // ── El borde del stock negativo (sobreventa) ──────────────────────────────
  // No es teórico: 9 empresas tienen "permitir vender sin stock" activo y en
  // producción hay una fila de stock en negativo y 5 productos que terminaron
  // con costo negativo.

  it('si el stock venía negativo, toma el costo de compra y no lo distorsiona', () => {
    // Sobreventa: el producto estaba en -5. Entran 10 a S/200 → stock 5.
    // Sin la guarda daba S/300, más caro que el precio al que se compró.
    expect(promedioTrasIngreso(5, 10, 200, 100)).toBe(200);
  });

  it('nunca produce un costo negativo', () => {
    // Sin la guarda esto daba -S/150.
    expect(promedioTrasIngreso(2, 10, 50, 100)).toBe(50);
  });
});

/**
 * Mientras dure la migración, una sede sin costo propio vale lo que valía
 * antes: el costo global del producto. Esto es lo que permite agregar la
 * columna sin que ningún reporte cambie de número.
 */
describe('Qué costo le corresponde a una sede', () => {
  it('usa el de la sede cuando lo tiene', () => {
    expect(costoDeSede(42.5, 100)).toBe(42.5);
  });

  it('cae al costo global mientras la sede esté en NULL', () => {
    expect(costoDeSede(null, 100)).toBe(100);
    expect(costoDeSede(undefined, 100)).toBe(100);
  });

  it('un costo de sede en cero es un costo, no un "sin dato"', () => {
    // Un producto recibido como bonificación cuesta 0 de verdad; si esto
    // cayera al global, la sede mostraría un costo que no pagó.
    expect(costoDeSede(0, 100)).toBe(0);
  });

  it('sin ninguno de los dos, cero en vez de NaN en los reportes', () => {
    expect(costoDeSede(null, null)).toBe(0);
  });

  it('acepta los Decimal de Prisma, que llegan como objeto', () => {
    // Prisma devuelve Decimal, no number: Number(decimal) es lo que lo resuelve.
    const decimal = { toString: () => '17.75', valueOf: () => 17.75 };
    expect(costoDeSede(decimal, 100)).toBe(17.75);
  });
});
