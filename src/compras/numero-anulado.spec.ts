/**
 * TIENDA MINERA (28-10): anuló la F100-00512547 para corregirla y al
 * registrarla de nuevo le decía "ya existe". El número de una compra anulada
 * o rechazada tiene que quedar libre.
 */
import { BadRequestException } from '@nestjs/common';
import { ComprasService } from './compras.service';

type Fila = {
  id: number;
  empresaId: number;
  serie: string;
  numero: string;
  estado: string;
};

// findFirst que respeta el filtro de estado; cualquier otro acceso a la base
// marca que la validación de duplicado ya pasó.
function armar(filas: Fila[]) {
  const findFirst = jest.fn(async ({ where }: any) => {
    const fuera: string[] = where.estado?.notIn ?? [];
    return (
      filas.find(
        (f) =>
          f.empresaId === where.empresaId &&
          f.serie === where.serie &&
          f.numero === where.numero &&
          (where.id?.not === undefined || f.id !== where.id.not) &&
          !fuera.includes(f.estado),
      ) ?? null
    );
  });
  const prisma = new Proxy({} as any, {
    get: (_, modelo) => {
      if (modelo === 'compra') {
        return new Proxy({ findFirst } as any, {
          get: (o, m) =>
            m === 'findFirst'
              ? o.findFirst
              : () => {
                  throw new Error('PASO_LA_VALIDACION');
                },
        });
      }
      throw new Error('PASO_LA_VALIDACION');
    },
  });
  const servicio = new ComprasService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { servicio, findFirst };
}

const dto = { serie: 'F100', numero: '00512547', detalles: [] } as any;
const compra = (estado: string, id = 479): Fila => ({
  id,
  empresaId: 88,
  serie: 'F100',
  numero: '00512547',
  estado,
});

describe('serie-número de una compra anulada', () => {
  it('se puede volver a registrar la compra que se anuló', async () => {
    const { servicio } = armar([compra('ANULADO')]);
    await expect(servicio.crear(88, 1, dto)).rejects.toThrow(
      'PASO_LA_VALIDACION',
    );
  });

  it('también si la había rechazado el administrador', async () => {
    const { servicio } = armar([compra('RECHAZADA')]);
    await expect(servicio.crear(88, 1, dto)).rejects.toThrow(
      'PASO_LA_VALIDACION',
    );
  });

  it('una compra vigente con ese número sigue bloqueando', async () => {
    const { servicio } = armar([compra('ANULADO'), compra('REGISTRADO', 480)]);
    await expect(servicio.crear(88, 1, dto)).rejects.toThrow(
      BadRequestException,
    );
    await expect(servicio.crear(88, 1, dto)).rejects.toThrow(
      /Ya existe una compra registrada/,
    );
  });

  it('la pendiente de aprobación también bloquea', async () => {
    const { servicio } = armar([compra('PENDIENTE_APROBACION')]);
    await expect(servicio.crear(88, 1, dto)).rejects.toThrow(
      /Ya existe una compra registrada/,
    );
  });

  it('el número de otra empresa no bloquea', async () => {
    const { servicio } = armar([{ ...compra('REGISTRADO'), empresaId: 12 }]);
    await expect(servicio.crear(88, 1, dto)).rejects.toThrow(
      'PASO_LA_VALIDACION',
    );
  });
});
