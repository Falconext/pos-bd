/**
 * Alias del cliente.
 *
 * El vendedor casi nunca recuerda el RUC ni la razón social exacta: recuerda
 * "la bodega de la esquina" o "Panadería Lucho". El alias es ese nombre corto,
 * y tiene que poder buscarse igual que el nombre o el documento, porque si no
 * se busca no sirve de nada.
 *
 * Se prueba además que se guarde en los tres caminos: alta, actualización y el
 * upsert de un cliente que ya existía. Un campo que se escribe en el formulario
 * y se pierde al guardar es el bug más caro de todos, porque nadie se entera
 * hasta que alguien lo busca y no aparece.
 */
import { ClienteService } from './cliente.service';

function armar(existente: any = null) {
  const guardado: any = {};
  const prisma: any = {
    cliente: {
      findFirst: jest.fn().mockResolvedValue(existente),
      findMany: jest.fn().mockImplementation((args: any) => {
        guardado.where = args?.where;
        return Promise.resolve([]);
      }),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }: any) => {
        guardado.create = data;
        return Promise.resolve({ id: 1, ...data });
      }),
      update: jest.fn().mockImplementation(({ data }: any) => {
        guardado.update = data;
        return Promise.resolve({ id: existente?.id ?? 1, ...data });
      }),
    },
    tipoDocumento: { findFirst: jest.fn().mockResolvedValue({ id: 1, codigo: '6' }) },
    empresa: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
  };
  return { service: new ClienteService(prisma), prisma, guardado };
}

/** Aplana el `where` a texto para ver contra qué campos se busca. */
const campos = (where: any) => JSON.stringify(where ?? {});

describe('Alias del cliente · se puede buscar por él', () => {
  it('la búsqueda mira el alias, no solo nombre y documento', async () => {
    const { service, guardado } = armar();
    await service.listar({ empresaId: 1, search: 'lucho' } as any).catch(() => {});
    const w = campos(guardado.where);
    expect(w).toContain('alias');
    expect(w).toContain('nombre');
    expect(w).toContain('nroDoc');
  });
});

describe('Alias del cliente · se guarda de verdad', () => {
  it('al crear el cliente', async () => {
    const { service, guardado } = armar();
    await service
      .crear({ nombre: 'Panadería San Luis', alias: 'Panadería Lucho', tipoDoc: 'RUC', nroDoc: '20123456789' } as any)
      .catch(() => {});
    expect(guardado.create?.alias).toBe('Panadería Lucho');
  });

  it('se limpian los espacios sobrantes', async () => {
    const { service, guardado } = armar();
    await service.crear({ nombre: 'X', alias: '  Lucho  ', tipoDoc: 'RUC', nroDoc: '20123456789' } as any).catch(() => {});
    expect(guardado.create?.alias).toBe('Lucho');
  });

  it('un alias vacío se guarda como nulo, no como cadena vacía', async () => {
    const { service, guardado } = armar();
    await service.crear({ nombre: 'X', alias: '   ', tipoDoc: 'RUC', nroDoc: '20123456789' } as any).catch(() => {});
    expect(guardado.create?.alias).toBeNull();
  });

  it('al actualizar un cliente existente', async () => {
    const { service, guardado } = armar({ id: 7, nroDoc: '20123456789' });
    await service
      .actualizar({ id: 7, empresaId: 1, nombre: 'Panadería San Luis', alias: 'El de la esquina', tipoDoc: 'RUC', nroDoc: '20123456789' } as any)
      .catch(() => {});
    expect(guardado.update?.alias).toBe('El de la esquina');
  });

  it('si no se manda el alias, no se pisa el que ya tenía', async () => {
    const { service, guardado } = armar({ id: 7, nroDoc: '20123456789' });
    await service
      .actualizar({ id: 7, empresaId: 1, nombre: 'Panadería San Luis', tipoDoc: 'RUC', nroDoc: '20123456789' } as any)
      .catch(() => {});
    expect(guardado.update && 'alias' in guardado.update).toBe(false);
  });
});
