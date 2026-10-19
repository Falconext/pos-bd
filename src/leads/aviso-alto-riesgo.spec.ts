/**
 * Cliente de alto riesgo: se avisa a una persona y la IA SIGUE atendiendo.
 *
 * Decisión de Hierba Sana tras la prueba del 19-10 (diabético que toma
 * metformina y losartán). La primera versión llegó a producción con la
 * herramienta declarada pero sin ejecutor: el modelo la llamaba y recibía
 * "Herramienta desconocida". Esta prueba pasa por el ejecutor real.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsMessageProcessor } from './leads-message.processor';
import { HERRAMIENTA_AVISAR_RIESGO } from './leads-herramientas';

function armar(previos: unknown[] = []) {
  const escrituras: unknown[] = [];
  const avisos: Record<string, unknown>[] = [];
  const prisma = {
    leadMensaje: { findMany: jest.fn().mockResolvedValue(previos) },
    leadConversacion: {
      update: jest.fn((x: unknown) => escrituras.push(x)),
      findUnique: jest.fn().mockResolvedValue({ nombreProspecto: 'Diego' }),
    },
    leadProspecto: { updateMany: jest.fn((x: unknown) => escrituras.push(x)) },
  } as never;
  const pedido = {
    configDe: jest.fn().mockResolvedValue({ supervisorTelefono: '955947892' }),
  } as never;
  const notificaciones = {
    notificarAdminsEmpresa: jest.fn().mockResolvedValue({}),
  };
  const alerta = {
    avisarAltoRiesgo: jest.fn(async (p: Record<string, unknown>) => {
      avisos.push(p);
    }),
  } as never;
  const processor = new LeadsMessageProcessor(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    notificaciones as never,
    alerta,
    {} as never,
    pedido,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const ejecutor = (processor as any).crearEjecutor(89, 52, '51991065217', new Set());
  return { ejecutor, escrituras, avisos, notificaciones };
}

const ARGS = {
  riesgo: 'diabetes e hipertensión, toma metformina y losartán',
  recomendado: 'Diabetizan - NATURAL MEDIX',
};

describe('aviso de cliente de alto riesgo', () => {
  it('avisa al supervisor y en el panel, y NO pausa el bot', async () => {
    const { ejecutor, escrituras, avisos, notificaciones } = armar();
    const r = (await ejecutor(HERRAMIENTA_AVISAR_RIESGO, ARGS)) as any;

    expect(r.avisado).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.instruccion).toMatch(/no deje su tratamiento/i);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      supervisorTelefono: '955947892',
      motivo: ARGS.riesgo,
      detalle: ARGS.recomendado,
    });
    expect(notificaciones.notificarAdminsEmpresa).toHaveBeenCalledTimes(1);
    // Ninguna escritura de pausa: la IA sigue.
    expect(escrituras).toHaveLength(0);
  });

  it('una sola vez por conversación', async () => {
    const { ejecutor, avisos } = armar([
      {
        herramientasJson: [
          { nombre: HERRAMIENTA_AVISAR_RIESGO, resultado: { avisado: true } },
        ],
      },
    ]);
    const r = (await ejecutor(HERRAMIENTA_AVISAR_RIESGO, ARGS)) as any;
    expect(r.yaEstaba).toBe(true);
    expect(avisos).toHaveLength(0);
  });

  it('un intento que falló antes no cuenta como aviso dado', async () => {
    // Lo que quedó en prod el 19-10 antes de este arreglo.
    const { ejecutor, avisos } = armar([
      {
        herramientasJson: [
          {
            nombre: HERRAMIENTA_AVISAR_RIESGO,
            resultado: { error: `Herramienta desconocida: ${HERRAMIENTA_AVISAR_RIESGO}` },
          },
        ],
      },
    ]);
    await ejecutor(HERRAMIENTA_AVISAR_RIESGO, ARGS);
    expect(avisos).toHaveLength(1);
  });
});
