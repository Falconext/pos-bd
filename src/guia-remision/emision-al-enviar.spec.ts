/**
 * Guía 102 de IRBA (26-10): creada el 22-10 a las 16:03, editada y enviada el
 * 26-10 a las 10:25. El XML salió con IssueDate 2026-10-26 + IssueTime
 * 16:03:56 (en el futuro) y número T001-00000000. SUNAT: "Presentación fuera
 * de fecha o con Fecha/hora mayor a la recepción".
 */
import { ahoraEnLima, emisionAlEnviar } from './emision-al-enviar';
import { GuiaRemisionService } from './guia-remision.service';

// 26-10-2026 10:25:07 en Lima (UTC-5).
const ENVIO = new Date('2026-10-26T15:25:07.000Z');

describe('fecha y hora de emisión al enviar la guía', () => {
  it('usa la hora de Lima del envío, no la del servidor ni la del borrador', () => {
    expect(ahoraEnLima(ENVIO)).toEqual({ fecha: '2026-10-26', hora: '10:25:07' });
    // Pasada la medianoche UTC sigue siendo el día anterior en Lima.
    expect(ahoraEnLima(new Date('2026-10-27T03:10:00.000Z'))).toEqual({ fecha: '2026-10-26', hora: '22:10:00' });
    expect(ahoraEnLima(new Date('2026-10-26T05:00:00.000Z')).hora).toBe('00:00:00');
  });

  it('guarda la fecha como medianoche UTC del día de Lima (el XML lee el día UTC)', () => {
    const r = emisionAlEnviar({ fechaInicioTraslado: '2026-10-26T00:00:00.000Z' }, ENVIO);
    expect(r.fechaEmision.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(r.horaEmision).toBe('10:25:07');
    expect(r.fechaInicioTraslado).toBeUndefined();
  });

  it('un inicio de traslado anterior a la emisión pasa a hoy; uno futuro se respeta', () => {
    expect(emisionAlEnviar({ fechaInicioTraslado: '2026-10-22T00:00:00.000Z' }, ENVIO).fechaInicioTraslado?.toISOString())
      .toBe('2026-10-26T00:00:00.000Z');
    expect(emisionAlEnviar({ fechaInicioTraslado: '2026-10-28T00:00:00.000Z' }, ENVIO).fechaInicioTraslado).toBeUndefined();
    expect(emisionAlEnviar({ fechaInicioTraslado: null }, ENVIO).fechaInicioTraslado).toBeUndefined();
  });
});

describe('servicio de guías: envío y edición', () => {
  const guiaIrba = () => ({
    id: 102,
    empresaId: 90,
    serie: 'T001',
    correlativo: 1,
    tipoGuia: 'REMITENTE',
    tipoTraslado: '01',
    modoTransporte: '01',
    transportistaRuc: '20600000001',
    transportistaRazonSocial: 'LOGISTICA HINOSTROZA E.I.R.L.',
    remitenteRuc: '20616097076',
    destinatarioTipoDoc: '6',
    destinatarioNumDoc: '10405598782',
    destinatarioRazonSocial: 'SANCHEZ AMIQUERO KATTY',
    partidaUbigeo: '150101',
    partidaDireccion: 'MZA. R LOTE. 18 URB. AMERICA',
    llegadaUbigeo: '120606',
    llegadaDireccion: 'JR. INDEPENDENCIA N° 388 - PICHANAQUI',
    pesoTotal: 10,
    estadoSunat: 'PENDIENTE',
    documentoId: null,
    fechaEmision: new Date('2026-10-26T00:00:00.000Z'),
    horaEmision: '16:03:56',
    fechaInicioTraslado: new Date('2026-10-26T00:00:00.000Z'),
    sunatRetriesCount: 0,
    detalles: [],
  });

  const armar = (guia: any) => {
    const updates: any[] = [];
    const prisma: any = {
      guiaRemision: {
        findFirst: jest.fn(async () => guia),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          Object.assign(guia, data);
          return { ...guia };
        }),
      },
      empresa: { findUnique: jest.fn(async () => ({ usuarioPse: 'u', contrasenaPse: 'p', usaDemo: false })) },
      detalleGuiaRemision: { deleteMany: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const enviadas: any[] = [];
    const sunat: any = {
      enviarGuia: jest.fn(async (g: any) => {
        enviadas.push({ ...g });
        return { success: true, numeracionRepetida: false, xml: '<x/>', documentoId: 'D1', message: 'ok' };
      }),
    };
    const servicio = new GuiaRemisionService(prisma, sunat, {} as any, {} as any);
    return { servicio, updates, enviadas, prisma };
  };

  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval'] });
    jest.setSystemTime(ENVIO);
  });
  afterAll(() => jest.useRealTimers());

  it('una guía que SUNAT no recibió sale con la fecha y hora del envío', async () => {
    const { servicio, enviadas } = armar(guiaIrba());
    await servicio.enviarSunat(102, 90);
    expect(enviadas[0].horaEmision).toBe('10:25:07');
    expect(new Date(enviadas[0].fechaEmision).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('una guía que quedó con correlativo 0 sale con el siguiente número de su serie', async () => {
    // Así quedó la 102 de IRBA en producción.
    const { servicio, enviadas, prisma } = armar({ ...guiaIrba(), correlativo: 0 });
    const original = prisma.guiaRemision.findFirst;
    prisma.guiaRemision.findFirst = jest.fn(async (args: any) =>
      args?.select?.correlativo ? { correlativo: 0 } : original(args),
    );
    await servicio.enviarSunat(102, 90);
    expect(enviadas[0].correlativo).toBe(1);
  });

  it('con un envío en curso (documentoId) no se le cambia la fecha', async () => {
    const { servicio, enviadas } = armar({ ...guiaIrba(), documentoId: 'ABC' });
    await servicio.enviarSunat(102, 90);
    expect(enviadas[0].horaEmision).toBe('16:03:56');
  });

  it('editar no deja el correlativo en 0 (ni lo cambia)', async () => {
    const { servicio, updates } = armar(guiaIrba());
    await servicio.update(102, { correlativo: 0, observaciones: 'x' } as any, 90);
    const editado = updates[updates.length - 1];
    expect(editado).not.toHaveProperty('correlativo');
    expect(editado.observaciones).toBe('x');
  });

  it('si cambia la serie, toma el siguiente número de esa serie', async () => {
    const { servicio, updates, prisma } = armar(guiaIrba());
    const original = prisma.guiaRemision.findFirst;
    prisma.guiaRemision.findFirst = jest.fn(async (args: any) =>
      args?.where?.serie === 'T002' ? { correlativo: 7 } : original(args),
    );
    await servicio.update(102, { serie: 't002', correlativo: 0 } as any, 90);
    const editado = updates[updates.length - 1];
    expect(editado.serie).toBe('T002');
    expect(editado.correlativo).toBe(8);
  });
});
