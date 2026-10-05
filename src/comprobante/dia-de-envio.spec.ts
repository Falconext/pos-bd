/**
 * El día de entrega que se imprime en el comprobante.
 *
 * Pedido de COMERCIAL LINNA MODA: el ticket solo mostraba la fecha de emisión y
 * el cliente no sabía cuándo le llega. La trampa está en la zona horaria.
 */
import { diaDeEnvio } from './dia-de-envio';

describe('La fecha no se corre un día', () => {
  it('EL RIESGO: medianoche UTC sigue siendo el mismo día en el papel', () => {
    // Así se guarda `fechaEstimada`. Leído con el reloj de Lima (UTC-5) sería
    // el 2 a las 19:00, y el cliente leería que llega un día antes.
    expect(diaDeEnvio('2026-10-03T00:00:00.000Z')).toBe('03/10/2026');
  });

  it('un Date con esa misma medianoche da lo mismo', () => {
    expect(diaDeEnvio(new Date('2026-10-03T00:00:00.000Z'))).toBe('03/10/2026');
  });

  it('el primer día del mes no se va al mes anterior', () => {
    expect(diaDeEnvio('2026-11-01T00:00:00.000Z')).toBe('01/11/2026');
  });

  it('el primer día del año no se va al año anterior', () => {
    expect(diaDeEnvio('2027-01-01T00:00:00.000Z')).toBe('01/01/2027');
  });
});

describe('Sin fecha no se inventa nada', () => {
  it('vacío, nulo o indefinido devuelven texto vacío', () => {
    // El template solo imprime la línea si hay valor: una venta que el cliente
    // se llevó no debe mostrar "FECHA DE ENVIO:" en blanco.
    expect(diaDeEnvio(null)).toBe('');
    expect(diaDeEnvio(undefined)).toBe('');
    expect(diaDeEnvio('')).toBe('');
  });

  it('una fecha ilegible tampoco inventa', () => {
    expect(diaDeEnvio('mañana')).toBe('');
  });
});
