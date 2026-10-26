/**
 * Etiquetas de contactos: la base de los envíos masivos.
 *
 * Lo que se cuida acá es lo que después rompe un segmento sin que nadie lo
 * note: etiquetas duplicadas que solo cambian en mayúsculas o tildes, y una
 * empresa que puede tocar las etiquetas o los chats de otra adivinando un id.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  LARGO_MAXIMO_ETIQUETA,
  MAXIMO_ETIQUETAS_POR_EMPRESA,
  buscarMismoNombre,
  colorValido,
  normalizarNombreEtiqueta,
} from './leads-etiquetas';
import { LeadsEtiquetasService } from './leads-etiquetas.service';

describe('normalizarNombreEtiqueta', () => {
  it('quita los espacios de más', () => {
    expect(normalizarNombreEtiqueta('  compró   perfume ')).toBe(
      'compró perfume',
    );
  });

  it('vacío o no-texto no es un nombre', () => {
    expect(normalizarNombreEtiqueta('   ')).toBeNull();
    expect(normalizarNombreEtiqueta(undefined)).toBeNull();
    expect(normalizarNombreEtiqueta(42)).toBeNull();
  });

  it('corta los nombres largos', () => {
    expect(normalizarNombreEtiqueta('x'.repeat(90))).toHaveLength(
      LARGO_MAXIMO_ETIQUETA,
    );
  });
});

describe('buscarMismoNombre', () => {
  const existentes = [
    { id: 1, nombre: 'Mayorista' },
    { id: 2, nombre: 'Compró perfume' },
  ];

  it('encuentra la misma etiqueta aunque cambien mayúsculas y tildes', () => {
    expect(buscarMismoNombre(existentes, 'mayorista')?.id).toBe(1);
    expect(buscarMismoNombre(existentes, 'COMPRO PERFUME')?.id).toBe(2);
  });

  it('al renombrar, la propia etiqueta no choca consigo misma', () => {
    expect(buscarMismoNombre(existentes, 'MAYORISTA', 1)).toBeUndefined();
  });
});

describe('colorValido', () => {
  it('acepta los de la paleta y manda el resto al gris', () => {
    expect(colorValido('verde')).toBe('verde');
    expect(colorValido('#ff0000')).toBe('gris');
    expect(colorValido(undefined)).toBe('gris');
  });
});

function armar(opts: {
  etiquetas?: { id: number; nombre: string; color: string }[];
  conversacion?: { id: number } | null;
}) {
  const etiquetas = opts.etiquetas ?? [];
  const prisma: any = {
    leadEtiqueta: {
      findMany: jest.fn().mockResolvedValue(etiquetas),
      findFirst: jest.fn(
        async ({ where }: any) =>
          etiquetas.find((e) => e.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
      update: jest.fn(async ({ where, data }: any) => ({
        id: where.id,
        ...data,
      })),
      delete: jest.fn(async () => ({})),
    },
    leadConversacion: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.conversacion === undefined ? { id: 10 } : opts.conversacion,
        ),
    },
    leadConversacionEtiqueta: {
      upsert: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn(async () => 3),
      findMany: jest.fn(async () => []),
    },
  };
  return { servicio: new LeadsEtiquetasService(prisma), prisma };
}

describe('crear', () => {
  it('no deja crear un duplicado que solo cambia en mayúsculas', async () => {
    const { servicio, prisma } = armar({
      etiquetas: [{ id: 1, nombre: 'Mayorista', color: 'azul' }],
    });
    await expect(servicio.crear(7, { nombre: 'mayorista' })).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.leadEtiqueta.create).not.toHaveBeenCalled();
  });

  it('sin nombre no crea nada', async () => {
    const { servicio } = armar({});
    await expect(servicio.crear(7, { nombre: '  ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('respeta el tope por empresa', async () => {
    const llenas = Array.from(
      { length: MAXIMO_ETIQUETAS_POR_EMPRESA },
      (_, i) => ({
        id: i + 1,
        nombre: `e${i}`,
        color: 'gris',
      }),
    );
    const { servicio } = armar({ etiquetas: llenas });
    await expect(servicio.crear(7, { nombre: 'nueva' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('guarda el nombre limpio y con la empresa del token', async () => {
    const { servicio, prisma } = armar({});
    await servicio.crear(7, { nombre: '  Cliente   VIP ', color: 'violeta' });
    expect(prisma.leadEtiqueta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { empresaId: 7, nombre: 'Cliente VIP', color: 'violeta' },
      }),
    );
  });
});

describe('aislamiento entre empresas', () => {
  it('editar una etiqueta de otra empresa responde 404', async () => {
    const { servicio, prisma } = armar({ etiquetas: [] });
    await expect(servicio.editar(7, 5, { nombre: 'x' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.leadEtiqueta.update).not.toHaveBeenCalled();
  });

  it('borrar una etiqueta de otra empresa responde 404', async () => {
    const { servicio, prisma } = armar({ etiquetas: [] });
    await expect(servicio.eliminar(7, 5)).rejects.toThrow(NotFoundException);
    expect(prisma.leadEtiqueta.delete).not.toHaveBeenCalled();
  });

  it('etiquetar un chat de otra empresa responde 404', async () => {
    const { servicio, prisma } = armar({ conversacion: null });
    await expect(servicio.poner(7, 10, { nombre: 'vip' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.leadConversacionEtiqueta.upsert).not.toHaveBeenCalled();
  });

  it('se busca la conversación con la empresa del token', async () => {
    const { servicio, prisma } = armar({});
    await servicio.quitar(7, 10, 1);
    expect(prisma.leadConversacion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 10, empresaId: 7 } }),
    );
  });
});

describe('poner', () => {
  it('por nombre reutiliza la existente en vez de duplicarla', async () => {
    const { servicio, prisma } = armar({
      etiquetas: [{ id: 3, nombre: 'Compró perfume', color: 'rosa' }],
    });
    await servicio.poner(7, 10, { nombre: 'compro perfume' }, 1);
    expect(prisma.leadEtiqueta.create).not.toHaveBeenCalled();
    expect(prisma.leadConversacionEtiqueta.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversacionId_etiquetaId: { conversacionId: 10, etiquetaId: 3 },
        },
      }),
    );
  });

  it('por nombre nuevo la crea y la pone', async () => {
    const { servicio, prisma } = armar({});
    await servicio.poner(7, 10, { nombre: 'Talla 38', color: 'azul' }, 1);
    expect(prisma.leadEtiqueta.create).toHaveBeenCalled();
    expect(prisma.leadConversacionEtiqueta.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { conversacionId: 10, etiquetaId: 99, usuarioId: 1 },
      }),
    );
  });

  it('una etiquetaId de otra empresa no se pone', async () => {
    const { servicio, prisma } = armar({ etiquetas: [] });
    await expect(servicio.poner(7, 10, { etiquetaId: 5 })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.leadConversacionEtiqueta.upsert).not.toHaveBeenCalled();
  });
});
