/**
 * El perfil demográfico: sexo y edad.
 *
 * El anexo pide un reporte de hombres, mujeres y edad. La tentación es
 * inferirlo del nombre; esto hace lo contrario: solo se anota lo que el
 * cliente dijo, nunca se le pregunta, y lo que no se sabe queda en blanco
 * para que el reporte lo cuente como "sin dato".
 */
import { LeadsPedidoService } from './leads-pedido.service';

function prismaFalso() {
  const perfiles: Record<string, unknown>[] = [];
  return {
    perfiles,
    empresa: { findUnique: jest.fn().mockResolvedValue({ iaVentasConfigJson: null }) },
    leadPedidoBorrador: {
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({
        zona: null,
        costoEnvio: null,
        nombre: null,
        dni: null,
        celular: null,
        direccion: null,
        tipoZona: null,
      }),
    },
    leadProspecto: {
      updateMany: jest.fn((args: any) => {
        perfiles.push(args.data);
        return Promise.resolve({ count: 1 });
      }),
    },
  } as any;
}

const servicio = (prisma: any) =>
  new LeadsPedidoService(prisma, {} as never, {} as never, {} as never);

const anotar = async (datos: Record<string, unknown>) => {
  const prisma = prismaFalso();
  const srv = servicio(prisma);
  await (srv as any).anotarPerfil(89, 1, datos, []);
  return prisma.perfiles[0];
};

describe('el sexo', () => {
  it('normaliza lo que diga el modelo a M o F', async () => {
    expect(await anotar({ sexo: 'masculino' })).toEqual({ sexo: 'M' });
    expect(await anotar({ sexo: 'Hombre' })).toEqual({ sexo: 'M' });
    expect(await anotar({ sexo: 'varón' })).toEqual({ sexo: 'M' });
    expect(await anotar({ sexo: 'F' })).toEqual({ sexo: 'F' });
    expect(await anotar({ sexo: 'mujer' })).toEqual({ sexo: 'F' });
  });

  it('lo que no entiende NO lo guarda: mejor sin dato que un dato inventado', async () => {
    expect(await anotar({ sexo: 'no sé' })).toBeUndefined();
    expect(await anotar({ sexo: '' })).toBeUndefined();
  });
});

describe('la edad', () => {
  it('guarda una edad razonable', async () => {
    expect(await anotar({ edad: 52 })).toEqual({ edad: 52 });
    expect(await anotar({ edad: '34' })).toEqual({ edad: 34 });
  });

  it('descarta lo que no puede ser una edad', async () => {
    // "Tomo 3 cápsulas" leído como edad ensuciaría el tramo 18-29 sin que
    // nadie lo note. Fuera de rango, no se guarda.
    expect(await anotar({ edad: 0 })).toBeUndefined();
    expect(await anotar({ edad: 500 })).toBeUndefined();
    expect(await anotar({ edad: 'treinta' })).toBeUndefined();
  });
});

describe('qué se le dice al asistente', () => {
  it('sexo y edad nunca aparecen entre los datos que faltan', () => {
    const prisma = prismaFalso();
    const srv = servicio(prisma);
    const faltan = (srv as any).faltantes({
      zona: 'Lima',
      tipoZona: 'DOMICILIO',
      nombre: null,
      dni: null,
      celular: null,
      direccion: null,
    });
    // Si estuvieran acá, el asistente se los pediría al cliente como si
    // fueran necesarios para entregarle el pedido.
    expect(faltan).not.toContain('sexo');
    expect(faltan).not.toContain('edad');
    expect(faltan.length).toBeGreaterThan(0);
  });

  it('cuando se anotan, se reportan como guardados', async () => {
    const prisma = prismaFalso();
    const srv = servicio(prisma);
    const guardado: string[] = [];
    await (srv as any).anotarPerfil(89, 1, { sexo: 'F', edad: 52 }, guardado);
    expect(guardado).toEqual(['sexo', 'edad']);
  });

  it('un fallo al anotar no corta la atención', async () => {
    const prisma = prismaFalso();
    prisma.leadProspecto.updateMany.mockRejectedValue(new Error('BD caída'));
    const srv = servicio(prisma);
    await expect(
      (srv as any).anotarPerfil(89, 1, { edad: 40 }, []),
    ).resolves.toBeUndefined();
  });
});
