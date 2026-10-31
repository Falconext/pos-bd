import { EstadoDespacho } from '@prisma/client';
import { EnvioDespachoService } from './envio-despacho.service';

// Cliente, 31-10: el aviso "en camino" y "entregado" de Lima (motorizado) no
// es el mismo texto que el de provincia (agencia). Se prueba qué texto sale.

const CONFIG = {
  mensajeEnCamino: 'Lima: {{nombre}}, {{repartidor}} va con tu pedido {{pedido}}',
  mensajeEnCaminoAgencia: 'Provincia: {{nombre}}, tu pedido {{pedido}} va a {{agencia}}. Clave {{clave}}',
  mensajeEntregado: 'Lima: entregado {{pedido}}',
  mensajeEntregadoAgencia: 'Provincia: recogiste {{pedido}} en {{agencia}}',
  mensajeEnAgencia: 'Llegó a {{agencia}}',
  notificarEnCamino: true,
  notificarEntregado: true,
  pagoRepartidorPropio: 'Yape o efectivo',
  pagoRepartidorContratado: null,
};

const ENVIO_LIMA = { tipoEnvio: 'DOMICILIO', transportista: 'PROPIOS', agenciaDestino: null, claveEnvio: null, montoCOD: 0 };
const ENVIO_SHALOM = {
  tipoEnvio: 'AGENCIA',
  transportista: 'SHALOM_PRO',
  agenciaDestino: 'Shalom Cusco Centro',
  claveEnvio: '4321',
  montoCOD: 0,
};

function armar(opts: { config?: Partial<typeof CONFIG> | null; envio?: Record<string, unknown>; saldo?: number }) {
  const envio = { ...ENVIO_LIMA, ...opts.envio };
  const prisma = {
    comprobante: {
      findFirst: jest.fn(async () => ({
        serie: 'NV01',
        correlativo: 7,
        saldo: opts.saldo ?? 0,
        cliente: { nombre: 'Ana', telefono: '987654321' },
        empresa: { nombreComercial: 'Hierba Sana', razonSocial: 'HS SAC' },
      })),
    },
    despachoMensajeTemplate: {
      findUnique: jest.fn(async () => (opts.config === null ? null : { ...CONFIG, ...opts.config })),
    },
    envioDespacho: {
      findFirst: jest.fn(async () => envio),
      findUnique: jest.fn(async () => ({ repartidor: { nombre: 'Luis', celular: '911222333', tipo: 'PLANILLA' } })),
    },
  };
  const whatsapp = {
    cuerpoPlantillaDespacho: jest.fn(() => 'Plantilla Meta {{1}} {{2}}'),
    enviarAvisoCliente: jest.fn(async (_e: number, _t: string, _p: string, _v: string[], propio?: string | null) => ({
      success: true,
      via: 'takiy',
      texto: propio ?? null,
    })),
  };
  const servicio = new EnvioDespachoService(prisma as never, {} as never, whatsapp as never, {} as never, {} as never);
  const vista = async (estado: EstadoDespacho) => (await servicio.mensajeParaEstado(1, 1, estado)).texto;
  return { servicio, whatsapp, vista };
}

describe('avisos de despacho: Lima vs provincia', () => {
  it('en camino a domicilio en Lima → texto general', async () => {
    const { vista } = armar({});
    expect(await vista(EstadoDespacho.EN_CAMINO)).toBe(
      'Lima: Ana, Luis (cel. 911 222 333) va con tu pedido NV01-00000007',
    );
  });

  it('en camino por Shalom → texto de provincia con agencia y clave', async () => {
    const { vista } = armar({ envio: ENVIO_SHALOM });
    expect(await vista(EstadoDespacho.EN_CAMINO)).toBe(
      'Provincia: Ana, tu pedido NV01-00000007 va a Shalom Cusco Centro. Clave 4321',
    );
  });

  it('Olva sin tipoEnvio también es provincia', async () => {
    const { vista } = armar({ envio: { tipoEnvio: null, transportista: 'OLVA', agenciaDestino: null } });
    expect(await vista(EstadoDespacho.EN_CAMINO)).toBe(
      'Provincia: Ana, tu pedido NV01-00000007 va a la agencia. Clave',
    );
  });

  it('provincia sin texto propio (vacío) → sale el general, como antes', async () => {
    const { vista } = armar({ envio: ENVIO_SHALOM, config: { mensajeEnCaminoAgencia: '  ', mensajeEntregadoAgencia: null } as never });
    expect(await vista(EstadoDespacho.EN_CAMINO)).toMatch(/^Lima: Ana/);
    expect(await vista(EstadoDespacho.ENTREGADO)).toBe('Lima: entregado NV01-00000007');
  });

  it('entregado en Lima y en provincia', async () => {
    expect(await armar({}).vista(EstadoDespacho.ENTREGADO)).toBe('Lima: entregado NV01-00000007');
    expect(await armar({ envio: ENVIO_SHALOM }).vista(EstadoDespacho.ENTREGADO)).toBe(
      'Provincia: recogiste NV01-00000007 en Shalom Cusco Centro',
    );
  });

  it('llegó a la agencia no cambia: su texto y la clave al final', async () => {
    const { vista } = armar({ envio: ENVIO_SHALOM });
    expect(await vista(EstadoDespacho.EN_AGENCIA)).toBe('Llegó a Shalom Cusco Centro\n\n🔑 Clave de retiro: 4321.');
  });

  it('en camino a provincia con saldo y formas de pago: igual se agrega cómo pagar', async () => {
    const { vista } = armar({ envio: ENVIO_SHALOM, saldo: 50 });
    expect(await vista(EstadoDespacho.EN_CAMINO)).toBe(
      'Provincia: Ana, tu pedido NV01-00000007 va a Shalom Cusco Centro. Clave 4321\n\n💵 A pagar: S/ 50.00. Puedes pagar con Yape o efectivo.',
    );
  });

  it('sin configuración guardada → plantilla de Meta, sin texto propio', async () => {
    const { vista } = armar({ config: null, envio: ENVIO_SHALOM });
    expect(await vista(EstadoDespacho.EN_CAMINO)).toBe('Plantilla Meta Ana NV01-00000007');
  });

  it('el envío real manda el texto de provincia a WhatsApp', async () => {
    const { servicio, whatsapp } = armar({ envio: ENVIO_SHALOM });
    await (servicio as any).notificarCambioEstado(1, 1, EstadoDespacho.ENTREGADO, null);
    expect(whatsapp.enviarAvisoCliente).toHaveBeenCalledWith(
      1,
      '987654321',
      'pedido_entregado',
      ['Ana', 'NV01-00000007'],
      'Provincia: recogiste NV01-00000007 en Shalom Cusco Centro',
    );
  });

  it('con el aviso apagado no sale nada aunque haya texto de provincia', async () => {
    const { servicio, whatsapp } = armar({ envio: ENVIO_SHALOM, config: { notificarEnCamino: false } });
    await (servicio as any).notificarCambioEstado(1, 1, EstadoDespacho.EN_CAMINO, null);
    expect(whatsapp.enviarAvisoCliente).not.toHaveBeenCalled();
  });
});
