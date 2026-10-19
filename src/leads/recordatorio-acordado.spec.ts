/**
 * "En una semana", "a fin de mes": se le escribe ese día (Hierba Sana, 19-10).
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsMessageProcessor } from './leads-message.processor';
import { HERRAMIENTA_AGENDAR_RECORDATORIO } from './leads-herramientas';
import { TipoDisparo, decidirEnvio, CONFIG_DISPARADORES_DEFECTO } from './leads-disparadores';

function armar() {
  const disparadores = {
    programar: jest.fn().mockResolvedValue({ programado: true }),
    cancelar: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new LeadsMessageProcessor(
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, disparadores as never, {} as never,
  );
  const ejecutor = (processor as any).crearEjecutor(89, 52, '51991065217', new Set());
  return { ejecutor, disparadores };
}

describe('recordatorio en la fecha que dijo el cliente', () => {
  it('lo programa ese día a las 10 a. m. de Lima', async () => {
    const { ejecutor, disparadores } = armar();
    const fecha = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const r: any = await ejecutor(HERRAMIENTA_AGENDAR_RECORDATORIO, { fecha, motivo: 'cobra' });
    expect(r).toEqual({ agendado: true, fecha });
    const datos = disparadores.programar.mock.calls[0][0];
    expect(datos.tipo).toBe(TipoDisparo.RECORDATORIO_ACORDADO);
    expect(datos.referencia).toBe(`conversacion:52:${fecha}`);
    // 10:00 de Lima = 15:00 UTC.
    expect(datos.programadoPara.toISOString()).toBe(`${fecha}T15:00:00.000Z`);
  });

  it('rechaza fechas pasadas o sin formato', async () => {
    const { ejecutor, disparadores } = armar();
    expect(((await ejecutor(HERRAMIENTA_AGENDAR_RECORDATORIO, { fecha: 'fin de mes' })) as any).agendado).toBe(false);
    expect(((await ejecutor(HERRAMIENTA_AGENDAR_RECORDATORIO, { fecha: '2020-01-01' })) as any).agendado).toBe(false);
    expect(disparadores.programar).not.toHaveBeenCalled();
  });

  it('con la ventana cerrada sale por plantilla (es UTILITY)', () => {
    const v = decidirEnvio({
      tipo: TipoDisparo.RECORDATORIO_ACORDADO,
      config: { ...CONFIG_DISPARADORES_DEFECTO, activos: [TipoDisparo.RECORDATORIO_ACORDADO] },
      ahora: new Date('2026-10-26T15:00:00Z'),
      dioDeBaja: false,
      ultimoMensajeDelCliente: new Date('2026-10-19T15:00:00Z'),
      botPausado: false,
      plantillaAprobada: true,
      marketingRecientes: 0,
      productoDisponible: true,
    } as any);
    expect(v).toMatchObject({ enviar: true, via: 'plantilla' });
  });
});
