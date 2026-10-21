/**
 * Krezka (20-10): al entregar la demo se le dan 3 horas para revisarla y
 * después se le pregunta qué le pareció. Si contesta, la IA sigue la
 * conversación; por eso la pregunta queda en el chat.
 */
import { LeadsDisparadoresService } from './leads-disparadores.service';
import {
  CONFIG_DISPARADORES_DEFECTO,
  TipoDisparo,
  cuandoDisparar,
} from './leads-disparadores';

const CREADO = new Date('2026-10-20T22:46:00Z'); // 5:46 p. m. de Lima

function armar(ultimoMensajeDelCliente: Date | null) {
  const prisma: any = {
    leadDisparo: {
      findUnique: jest.fn().mockResolvedValue({
        id: 7,
        empresaId: 22,
        tipo: TipoDisparo.SEGUIMIENTO_DEMO,
        telefono: '51987654321',
        referencia: 'demo:3',
        estado: 'PROGRAMADO',
        creadoEn: CREADO,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    leadMensaje: { create: jest.fn().mockResolvedValue({}) },
    empresa: { findUnique: jest.fn().mockResolvedValue({ iaVentasConfigJson: {} }) },
  };
  const whatsapp = { enviarTexto: jest.fn().mockResolvedValue({ success: true }) };
  const servicio = new LeadsDisparadoresService(prisma, whatsapp as never, {} as never);
  jest.spyOn(servicio as any, 'estaDeBaja').mockResolvedValue(false);
  jest.spyOn(servicio as any, 'esNumeroDeLaEmpresa').mockResolvedValue(false);
  jest.spyOn(servicio as any, 'marketingRecientes').mockResolvedValue(0);
  jest.spyOn(servicio as any, 'situacionDelChat').mockResolvedValue({
    id: 70,
    nombre: 'Diego Jesus Ortega Roldan',
    botPausado: false,
    ultimoMensajeDelCliente,
  });
  return { servicio, prisma, whatsapp };
}

describe('seguimiento de la demo', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-21T14:00:00Z'))); // 9 a. m.
  afterEach(() => jest.useRealTimers());

  it('se programa a las 3 horas, dentro del horario de atención', () => {
    const cuando = cuandoDisparar(
      TipoDisparo.SEGUIMIENTO_DEMO,
      new Date('2026-10-20T17:00:00Z'), // 12 del día
      CONFIG_DISPARADORES_DEFECTO,
    );
    expect(cuando.toISOString()).toBe('2026-10-20T20:00:00.000Z');
    expect(CONFIG_DISPARADORES_DEFECTO.activos).toContain(TipoDisparo.SEGUIMIENTO_DEMO);
  });

  it('pregunta qué le pareció y deja la pregunta en el chat', async () => {
    const { servicio, prisma, whatsapp } = armar(new Date(CREADO.getTime() - 60_000));
    const r = await servicio.procesarUno(7);
    expect(r).toEqual({ enviado: true, via: 'texto' });
    const texto = whatsapp.enviarTexto.mock.calls[0][1];
    expect(texto).toMatch(/^Hola Diego, ¿qué tal te pareció el sistema\?/);
    expect(prisma.leadMensaje.create).toHaveBeenCalledWith({
      data: { conversacionId: 70, rol: 'ASISTENTE', contenido: texto },
    });
  });

  it('si siguió conversando después de la demo, no se pregunta', async () => {
    const { servicio, whatsapp, prisma } = armar(new Date(CREADO.getTime() + 2 * 3600_000));
    const r = await servicio.procesarUno(7);
    expect(r.enviado).toBe(false);
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    expect(prisma.leadDisparo.update.mock.calls[0][0].data.estado).toBe('OMITIDO');
  });

  it('con la ventana de 24 h cerrada no se manda: no tiene plantilla', async () => {
    jest.setSystemTime(new Date('2026-10-22T15:00:00Z'));
    const { servicio, whatsapp } = armar(new Date(CREADO.getTime() - 60_000));
    const r = await servicio.procesarUno(7);
    expect(r).toMatchObject({ enviado: false, motivo: expect.stringMatching(/24 h/) });
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });
});
