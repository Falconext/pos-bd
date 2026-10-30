jest.mock('axios');
import axios from 'axios';
import { MetaConversionesService } from './meta-conversiones.service';

/**
 * 30-10: el panel decía "Avisado" con solo el 200 de Meta. Si Meta dice que
 * registró menos eventos de los enviados, no se marcan como avisados y el
 * panel muestra lo que contestó.
 */
function armar(respuesta: any) {
  const ahora = new Date();
  let config: any = { metaConversiones: { activo: true, datasets: { W1: 'D1' } } };
  const prisma: any = {
    metaEventoConversion: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, empresaId: 7, wabaId: 'W1', conversacionId: 3, comprobanteId: null, evento: 'Purchase', clave: 'venta-9', ocurridoEn: ahora, ctwaClid: 'CLID', valor: 149.9, moneda: 'PEN' },
      ]),
      updateMany: jest.fn(),
    },
    comprobante: { findMany: jest.fn().mockResolvedValue([]) },
    leadConversacion: { findFirst: jest.fn().mockResolvedValue({ numeroWhatsappId: null }) },
    empresa: {
      findUnique: jest.fn(async () => ({ iaVentasConfigJson: config })),
      update: jest.fn(async ({ data }: any) => {
        config = data.iaVentasConfigJson;
      }),
    },
  };
  const whatsapp: any = { cuentaMetaDelChat: jest.fn().mockResolvedValue({ wabaId: 'W1', token: 'T' }) };
  (axios.post as jest.Mock).mockResolvedValue({ data: respuesta });
  const service = new MetaConversionesService(prisma, whatsapp);
  return { service, prisma, config: () => config.metaConversiones };
}

describe('lo que contesta Meta al avisar ventas', () => {
  it('registró el evento: queda ENVIADO y se guarda la respuesta', async () => {
    const { service, prisma, config } = armar({ events_received: 1, fbtrace_id: 'FB1' });
    expect(await service.enviarPendientes(7)).toEqual({ enviados: 1, fallidos: 0 });
    expect(prisma.metaEventoConversion.updateMany.mock.calls[0][0].data.estado).toBe('ENVIADO');
    expect(config().ultimaRespuesta).toMatchObject({ enviados: 1, recibidos: 1, fbtraceId: 'FB1', prueba: false });
  });

  it('200 pero no lo registró: queda en ERROR con el aviso de Meta', async () => {
    const { service, prisma, config } = armar({ events_received: 0, messages: ['Invalid ctwa_clid'] });
    expect(await service.enviarPendientes(7)).toEqual({ enviados: 0, fallidos: 1 });
    const data = prisma.metaEventoConversion.updateMany.mock.calls[0][0].data;
    expect(data.estado).toBe('ERROR');
    expect(data.error).toMatch(/registró 0 de 1: Invalid ctwa_clid/);
    expect(config().ultimoError).toMatch(/Invalid ctwa_clid/);
  });
});
