/**
 * Hierba Sana, 28-10: "citaron para el viernes a las 2 pm, pero no me llegó
 * notificación". El aviso existía, pero solo en la campana del panel. Ahora la
 * visita también llega por WhatsApp a quien atiende, y si falta el nombre para
 * separar los productos el cliente igual recibe el mapa.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsMessageProcessor } from './leads-message.processor';
import { HERRAMIENTA_AGENDAR_VISITA, HERRAMIENTA_AVISAR_VISITA } from './leads-herramientas';

const NOTIF = { titulo: '🏬 Va a visitar la tienda: Arturo', mensaje: 'Arturo dice que va a pasar el viernes.' };

function armar(opciones: { aviso?: Record<string, unknown>; visita?: Record<string, unknown> } = {}) {
  const prisma = {
    leadConversacion: { findUnique: jest.fn().mockResolvedValue({ nombreProspecto: 'Arturo' }) },
  } as never;
  const pedido = {
    configDe: jest.fn().mockResolvedValue({ supervisorTelefono: '955947892' }),
    avisarVisitaTienda: jest.fn().mockResolvedValue(opciones.aviso ?? {}),
  };
  const alerta = { avisarVisitaTienda: jest.fn().mockResolvedValue(undefined) };
  const visitas = {
    registrar: jest.fn().mockResolvedValue(
      opciones.visita ?? { registrada: true, fecha: '2026-10-30', indicacionesEnviadas: true, yaTeniaIndicaciones: false, notificacion: NOTIF },
    ),
  };
  const disparadores = { cancelar: jest.fn().mockResolvedValue(undefined) };
  const processor = new LeadsMessageProcessor(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    { notificarAdminsEmpresa: jest.fn() } as never,
    alerta as never,
    {} as never,
    pedido as never,
    {} as never,
    {} as never,
    disparadores as never,
    {} as never,
    undefined,
    visitas as never,
  );
  (processor as any).marcarEtapa = jest.fn().mockResolvedValue(undefined);
  const ejecutor = (processor as any).crearEjecutor(89, 1036, '51967983909', new Set());
  return { ejecutor, alerta, visitas };
}

describe('la visita también llega por WhatsApp', () => {
  it('agendar_visita_tienda avisa al supervisor y no le pasa el aviso al modelo', async () => {
    const { ejecutor, alerta } = armar();
    const res = await ejecutor(HERRAMIENTA_AGENDAR_VISITA, { cuando: 'el viernes a las 2 pm' });

    expect(alerta.avisarVisitaTienda).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 89,
        telefonoProspecto: '51967983909',
        nombreProspecto: 'Arturo',
        supervisorTelefono: '955947892',
        titulo: NOTIF.titulo,
      }),
    );
    expect(res.notificacion).toBeUndefined();
    expect(res.registrada).toBe(true);
  });

  it('si la visita no notificó nada nuevo, no manda WhatsApp', async () => {
    const { ejecutor, alerta } = armar({
      visita: { registrada: true, fecha: null, indicacionesEnviadas: false, yaTeniaIndicaciones: true },
    });
    await ejecutor(HERRAMIENTA_AGENDAR_VISITA, { cuando: 'el viernes' });
    expect(alerta.avisarVisitaTienda).not.toHaveBeenCalled();
  });

  it('el recojo avisado también va por WhatsApp', async () => {
    const pasa = { titulo: '🏬 Pasa por la tienda: Arturo Franco', mensaje: '• 1x Pasuchaca' };
    const { ejecutor, alerta } = armar({ aviso: { avisado: true, pedido: 'NV01-00000120', notificacion: pasa } });
    const res = await ejecutor(HERRAMIENTA_AVISAR_VISITA, { cuando: 'el viernes a las 2 pm' });

    expect(alerta.avisarVisitaTienda).toHaveBeenCalledWith(expect.objectContaining({ titulo: pasa.titulo }));
    expect(res.notificacion).toBeUndefined();
    expect(res.pedido).toBe('NV01-00000120');
  });

  it('si falta el nombre: registra la visita, manda el mapa y pide el nombre', async () => {
    const { ejecutor, alerta, visitas } = armar({
      aviso: { falta: ['nombre completo'], cambio: 'El pedido pasó de envío a recojo en tienda.' },
    });
    const res = await ejecutor(HERRAMIENTA_AVISAR_VISITA, { cuando: 'el viernes a las 2 pm' });

    expect(visitas.registrar).toHaveBeenCalledWith(89, 1036, '51967983909', expect.objectContaining({ conPedido: false }));
    expect(alerta.avisarVisitaTienda).toHaveBeenCalled();
    expect(res.aviso).toMatch(/falta nombre completo/);
    expect(res.aviso).toMatch(/ni que sus productos están separados/);
    expect(res.cambio).toMatch(/recojo/);
    expect(res.pedido).toBeUndefined();
  });

  it('un WhatsApp caído no rompe la respuesta al cliente', async () => {
    const { ejecutor, alerta } = armar();
    alerta.avisarVisitaTienda.mockRejectedValue(new Error('Meta caído'));
    const res = await ejecutor(HERRAMIENTA_AGENDAR_VISITA, { cuando: 'el viernes' });
    expect(res.registrada).toBe(true);
  });
});
