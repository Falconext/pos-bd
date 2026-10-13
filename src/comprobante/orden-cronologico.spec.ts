import { BadRequestException } from '@nestjs/common';
import { ComprobanteService } from './comprobante.service';

/**
 * Dentro de una serie, a número mayor le toca fecha igual o posterior.
 *
 * Caso real (IMPORTEMOS JUNTOS): la boleta 95 quedó fechada el 04/07 cuando la
 * 94 era del 08/07. Pasó 11 veces. El número se asigna por orden de creación
 * —eso está bien— pero la fecha la elige quien factura, y la ponían para atrás
 * para calzar con el día de la venta real.
 */
describe('Orden cronológico dentro de una serie', () => {
  const montar = (previo: { correlativo: number; fechaEmision: string } | null) => {
    const prisma = {
      comprobante: {
        findFirst: jest.fn().mockResolvedValue(
          previo
            ? { correlativo: previo.correlativo, fechaEmision: new Date(previo.fechaEmision) }
            : null,
        ),
      },
    };
    const deps = Array(7).fill({}) as [any, any, any, any, any, any, any];
    return new ComprobanteService(prisma as any, ...deps);
  };

  const validar = (s: any, tipoDoc: string, correlativo: number, fecha: string | null) =>
    s.validarOrdenCronologico(14, tipoDoc, 'B0A1', correlativo, fecha);

  it('rechaza una fecha anterior a la del número previo', async () => {
    const s = montar({ correlativo: 94, fechaEmision: '2026-07-08T00:00:00Z' });
    await expect(validar(s, '03', 95, '2026-07-04')).rejects.toThrow(BadRequestException);
  });

  it('el mensaje dice contra qué comprobante choca y desde cuándo puede', async () => {
    // Sin eso, la cajera solo sabe que "no se pudo" y vuelve a intentar igual.
    const s = montar({ correlativo: 94, fechaEmision: '2026-07-08T00:00:00Z' });
    await expect(validar(s, '03', 95, '2026-07-04')).rejects.toThrow(
      /B0A1-94 \(2026-07-08\)[\s\S]*desde 2026-07-08/,
    );
  });

  it('el mismo día pasa: es lo normal cuando se emite seguido', async () => {
    const s = montar({ correlativo: 94, fechaEmision: '2026-07-08T00:00:00Z' });
    await expect(validar(s, '03', 95, '2026-07-08')).resolves.toBeUndefined();
  });

  it('una fecha posterior pasa', async () => {
    const s = montar({ correlativo: 94, fechaEmision: '2026-07-08T00:00:00Z' });
    await expect(validar(s, '03', 95, '2026-07-09')).resolves.toBeUndefined();
  });

  it('el primero de la serie no tiene contra qué compararse', async () => {
    const s = montar(null);
    await expect(validar(s, '03', 1, '2026-07-04')).resolves.toBeUndefined();
  });

  it('solo alcanza a Factura y Boleta', async () => {
    // Las notas y los internos quedan fuera: acotarlo limita el alcance del
    // cambio a las series que SUNAT fiscaliza por este lado.
    const s = montar({ correlativo: 94, fechaEmision: '2026-07-08T00:00:00Z' });
    for (const tipo of ['07', '08', 'NV', 'TICKET']) {
      await expect(validar(s, tipo, 95, '2026-07-04')).resolves.toBeUndefined();
    }
  });

  it('sin fecha no bloquea: el servidor pondrá la de hoy', async () => {
    const s = montar({ correlativo: 94, fechaEmision: '2026-07-08T00:00:00Z' });
    await expect(validar(s, '03', 95, null)).resolves.toBeUndefined();
  });
});
