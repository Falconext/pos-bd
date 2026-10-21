/**
 * El reenganche cuando el cliente deja de responder (Hierba Sana, 20-10).
 *
 * Sale a la hora de silencio y no a las cuatro: a las cuatro se cruzaba con
 * el aviso de cotización sin cerrar, que sale a las tres. Y no sale cuando el
 * cliente ya agendó, cuando dijo que avisaba o escribía después (a ese se le
 * escribe a la mañana siguiente) ni cuando se despidió.
 */
import {
  LeadsSeguimientoService,
  motivoParaNoReenganchar,
} from './leads-seguimiento.service';
import { HERRAMIENTA_DAR_DEMO } from './leads-herramientas';

const base = { pedidoAgendado: false, esperaAvisoProgramado: false, ultimoDelCliente: '¿cuánto cuesta la moringa?' };

describe('cuándo NO se reengancha', () => {
  it('el cliente que solo dejó de responder sí recibe el mensaje', () => {
    expect(motivoParaNoReenganchar(base)).toBeNull();
  });

  it('ya agendó su pedido', () => {
    expect(motivoParaNoReenganchar({ ...base, pedidoAgendado: true })).toMatch(/agendó/);
  });

  it('tiene un aviso programado para el día que dijo', () => {
    expect(motivoParaNoReenganchar({ ...base, esperaAvisoProgramado: true })).toMatch(/aviso programado/);
  });

  it.each(['ok te aviso', 'lo voy a pensar', 'mañana te escribo', 'después te escribo'])(
    'dijo que avisaba: "%s"',
    (texto) => {
      expect(motivoParaNoReenganchar({ ...base, ultimoDelCliente: texto })).toMatch(/avisaba/);
    },
  );

  it('"gracias por la info" SÍ se reengancha: es el cliente a recuperar', () => {
    expect(motivoParaNoReenganchar({ ...base, ultimoDelCliente: 'gracias por la info' })).toBeNull();
  });

  it('se le acaba de dar la demo: tiene 3 horas para revisarla', () => {
    expect(
      motivoParaNoReenganchar({
        ...base,
        herramientasDelUltimo: [{ nombre: HERRAMIENTA_DAR_DEMO, argumentos: {}, resultado: { acceso: {} } }],
      }),
    ).toMatch(/demo/);
  });
});

describe('el servicio', () => {
  const HORA = 3600_000;
  // 3 de la tarde en Lima: dentro del horario de atención.
  const AHORA = new Date('2026-10-21T20:00:00Z');

  function armar(opts: {
    ultimoDelCliente?: string;
    comprobanteId?: number | null;
    disparosEsperando?: number;
  } = {}) {
    const conv = {
      id: 7,
      telefonoProspecto: '51987654321',
      empresa: { id: 89, razonSocial: 'HIERBA SANA', nombreComercial: null, iaVentasContexto: '', rubro: null },
    };
    const prisma: any = {
      leadConversacion: {
        findMany: jest.fn().mockResolvedValue([conv]),
        update: jest.fn().mockResolvedValue({}),
      },
      leadMensaje: {
        findMany: jest.fn().mockResolvedValue([
          { rol: 'ASISTENTE', contenido: 'La moringa está a S/ 31.', creadoEn: new Date(AHORA.getTime() - 70 * 60_000), herramientasJson: null },
          { rol: 'USUARIO', contenido: opts.ultimoDelCliente ?? '¿cuánto cuesta la moringa?', creadoEn: new Date(AHORA.getTime() - 71 * 60_000), herramientasJson: null },
        ]),
        create: jest.fn().mockResolvedValue({}),
      },
      leadPedidoBorrador: {
        findUnique: jest.fn().mockResolvedValue(
          opts.comprobanteId === undefined ? null : { comprobanteId: opts.comprobanteId },
        ),
      },
      leadDisparo: { count: jest.fn().mockResolvedValue(opts.disparosEsperando ?? 0) },
    };
    const ia: any = {
      disponible: () => true,
      generarSeguimiento: jest.fn().mockResolvedValue('¿Te ayudo a separar tu moringa?'),
    };
    const whatsapp: any = { enviarTexto: jest.fn().mockResolvedValue({ success: true }) };
    return { servicio: new LeadsSeguimientoService(prisma, ia, whatsapp), prisma, whatsapp };
  }

  beforeEach(() => jest.useFakeTimers().setSystemTime(AHORA));
  afterEach(() => jest.useRealTimers());

  it('busca a quienes llevan UNA hora sin responder', async () => {
    const { servicio, prisma, whatsapp } = armar();
    await servicio.ejecutar();

    const where = prisma.leadConversacion.findMany.mock.calls[0][0].where;
    expect(AHORA.getTime() - where.actualizadoEn.lte.getTime()).toBe(HORA);
    expect(whatsapp.enviarTexto).toHaveBeenCalledWith('51987654321', '¿Te ayudo a separar tu moringa?', 89);
    expect(prisma.leadMensaje.create).toHaveBeenCalled();
  });

  it('no le escribe al que ya agendó, y no lo vuelve a evaluar', async () => {
    const { servicio, prisma, whatsapp } = armar({ comprobanteId: 500 });
    await servicio.ejecutar();
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    expect(prisma.leadConversacion.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { seguimientos: { increment: 1 } },
    });
  });

  it('no le escribe al que dijo "te aviso": eso sale a la mañana siguiente', async () => {
    const { servicio, whatsapp } = armar({ ultimoDelCliente: 'ok, te aviso' });
    await servicio.ejecutar();
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('no le escribe si ya tiene un recordatorio para el día que dijo', async () => {
    const { servicio, prisma, whatsapp } = armar({ disparosEsperando: 1 });
    await servicio.ejecutar();
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    const where = prisma.leadDisparo.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ empresaId: 89, telefono: '51987654321', estado: 'PROGRAMADO' });
    expect(where.tipo.in).toEqual(['CARRITO_EN_ESPERA', 'RECORDATORIO_ACORDADO']);
  });
});
