import { LeadsVisitaService } from './leads-visita.service';

// Domingo 25-10-2026, 7 p. m. de Lima: Percy va el martes... y otro mañana.
const AHORA = new Date('2026-10-26T00:00:00Z');
const TIENDA = {
  direccion: 'Av. Emancipación 687, Mercado La Merced, stand D-27',
  mapsUrl: 'https://maps.google.com/?q=-12.05,-77.03',
  indicaciones: 'Entra por la puerta 3.',
};

function armar(opts: { ultimoCliente?: Date | null; tienda?: unknown } = {}) {
  const enviados: { tipo: string; a: string; texto?: string }[] = [];
  const prisma = {
    leadVisitaTienda: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, empresaId: 89, conversacionId: 7, telefono: '51935099488', nombre: 'Percy Rojas Gómez' },
      ]),
      update: jest.fn().mockResolvedValue({}),
    },
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        iaVentasActiva: true,
        iaVentasConfigJson: { tienda: opts.tienda === undefined ? TIENDA : opts.tienda },
        nombreComercial: 'Hierba Sana',
        razonSocial: 'X',
      }),
    },
    leadMensaje: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.ultimoCliente === null ? null : { creadoEn: opts.ultimoCliente ?? new Date('2026-10-25T23:00:00Z') }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const mensajeria = {
    enviarUbicacion: jest.fn(async (a: string) => (enviados.push({ tipo: 'mapa', a }), { success: true })),
    enviarTexto: jest.fn(async (a: string, texto: string) => (enviados.push({ tipo: 'texto', a, texto }), { success: true })),
  };
  const svc = new LeadsVisitaService(prisma as never, mensajeria as never, {} as never);
  return { svc, prisma, enviados };
}

describe('el recordatorio de la víspera', () => {
  it('busca las visitas de mañana y manda mapa + cómo llegar, una sola vez', async () => {
    const { svc, prisma, enviados } = armar();
    await svc.recordarVisitasDeManana(AHORA);
    expect(prisma.leadVisitaTienda.findMany.mock.calls[0][0].where).toMatchObject({
      estado: 'AGENDADA',
      fecha: new Date('2026-10-26T00:00:00Z'),
      recordatorioEn: null,
    });
    expect(enviados.map((e) => e.tipo)).toEqual(['mapa', 'texto']);
    expect(enviados[1].texto).toContain('¡Hola Percy! Te esperamos mañana en Hierba Sana');
    expect(enviados[1].texto).toContain('stand D-27');
    expect(prisma.leadVisitaTienda.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { recordatorioEn: expect.any(Date) } }),
    );
  });

  it('fuera de la ventana de 24 h no se manda (haría falta una plantilla)', async () => {
    const { svc, enviados } = armar({ ultimoCliente: new Date('2026-10-24T12:00:00Z') });
    await svc.recordarVisitasDeManana(AHORA);
    expect(enviados).toHaveLength(0);
  });

  it('sin la tienda configurada no hay nada útil que mandar', async () => {
    const { svc, enviados } = armar({ tienda: null });
    await svc.recordarVisitasDeManana(AHORA);
    expect(enviados).toHaveLength(0);
  });
});

describe('cómo llegar al agendar', () => {
  function conImagenes(tienda: unknown) {
    const { svc, enviados } = armar({ tienda });
    const m = (svc as any).mensajeria;
    m.enviarImagenUrl = jest.fn(async (a: string, url: string, pie?: string) => (
      enviados.push({ tipo: `imagen:${url}${pie ? '+pie' : ''}`, a }), { success: true }
    ));
    return { svc, enviados };
  }

  it('croquis y foto: mapa, las dos imágenes y el texto al final', async () => {
    const { svc, enviados } = conImagenes({ ...TIENDA, croquisUrl: 'c.jpg', fotoUrl: 'f.jpg' });
    await expect((svc as any).enviarComoLlegar(89, '51935099488')).resolves.toBe(true);
    expect(enviados.map((e) => e.tipo)).toEqual(['mapa', 'imagen:c.jpg', 'imagen:f.jpg', 'texto']);
  });

  it('una sola foto y texto corto: el texto va de pie de foto', async () => {
    const { svc, enviados } = conImagenes({ ...TIENDA, fotoUrl: 'f.jpg' });
    await (svc as any).enviarComoLlegar(89, '51935099488');
    expect(enviados.map((e) => e.tipo)).toEqual(['mapa', 'imagen:f.jpg+pie']);
  });

  it('una foto con un texto que no cabe de pie: la foto sola y el texto aparte', async () => {
    const { svc, enviados } = conImagenes({ ...TIENDA, indicaciones: 'x'.repeat(1200), fotoUrl: 'f.jpg' });
    await (svc as any).enviarComoLlegar(89, '51935099488');
    expect(enviados.map((e) => e.tipo)).toEqual(['mapa', 'imagen:f.jpg', 'texto']);
  });
});
