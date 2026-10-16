/**
 * Cuando la IA no puede responder, que no sea silencio.
 *
 * El escenario que esto cubre pasa de verdad: se acaban los créditos de
 * Gemini, o la clave vence, o Google se cae. Hasta ahora la cola reintentaba
 * tres veces y el trabajo moría. Para el cliente de Hierba Sana eso es
 * indistinguible de que lo ignoren: escribió y nadie le contestó nunca. Y el
 * negocio se enteraba por el reclamo, no por el sistema.
 *
 * Tres cosas tienen que pasar, y ninguna antes de tiempo:
 *   1. el cliente recibe que lo atiende una persona;
 *   2. la IA se pausa en ese chat para no chocar contra la misma pared —pero
 *      con vencimiento, porque si el problema era pasajero tiene que volver
 *      sola;
 *   3. el negocio recibe el aviso, una vez, no cuarenta.
 */
// @nestjs/bullmq se publica como ESM y Jest no transforma node_modules: sin
// este doble, el import del processor revienta antes de empezar.
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { UnrecoverableError } from 'bullmq';
import { LeadsMessageProcessor } from './leads-message.processor';
import { PAUSA_INTERVENCION_MS } from './pausa-bot';

const EMPRESA = 89;
const CONV = 212;

function armar(opts: { botActivo?: boolean } = {}) {
  const pausas: any[] = [];
  const avisos: any[] = [];
  const mensajesAlCliente: any[] = [];

  const anota = ({ data }: any) => {
    pausas.push(data);
    return Promise.resolve({ count: 1 });
  };
  const prisma: any = {
    leadConversacion: {
      findUnique: jest.fn().mockResolvedValue({
        telefonoProspecto: '51987654321',
        nombreProspecto: 'Diego Ortega',
        botActivo: opts.botActivo ?? true,
      }),
      update: jest.fn(anota),
    },
    leadProspecto: { updateMany: jest.fn(anota) },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  };
  const whatsapp: any = {
    enviarTexto: jest.fn((tel: string, texto: string) => {
      mensajesAlCliente.push({ tel, texto });
      return Promise.resolve({ success: true });
    }),
  };
  const notificaciones: any = {
    notificarAdminsEmpresa: jest.fn((n: any) => {
      avisos.push(n);
      return Promise.resolve({});
    }),
  };
  const alerta: any = { avisarDerivacion: jest.fn().mockResolvedValue({}) };
  const pedido: any = { configDe: jest.fn().mockResolvedValue({ supervisorTelefono: '955947892' }) };

  // Orden del constructor: prisma, ia, rag, whatsapp, notificaciones, alerta,
  // comprobante, pedido, embudo, consultas, disparadores, queue.
  const processor = new LeadsMessageProcessor(
    prisma,
    {} as never,
    {} as never,
    whatsapp,
    notificaciones,
    alerta,
    {} as never,
    pedido,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // El método es privado: se llama por su nombre, que es lo que se está
  // probando. Envolverlo en un wrapper público solo para el test sería
  // inventar una API que nadie usa.
  const avisar = (job: any, error: unknown) =>
    (processor as any).avisarQueLaIaNoPudo(job, error);

  return { avisar, pausas, avisos, mensajesAlCliente, prisma, whatsapp, alerta };
}

const job = (attemptsMade: number, attempts = 3) => ({
  data: { empresaId: EMPRESA, conversacionId: CONV },
  attemptsMade,
  opts: { attempts },
});

describe('la IA no pudo responder', () => {
  describe('cuándo se avisa', () => {
    it('NO avisa mientras queden reintentos', async () => {
      const { avisar, avisos, mensajesAlCliente } = armar();
      await avisar(job(0), new Error('503 UNAVAILABLE'));
      await avisar(job(1), new Error('503 UNAVAILABLE'));
      expect(avisos).toHaveLength(0);
      expect(mensajesAlCliente).toHaveLength(0);
    });

    it('avisa en el último intento', async () => {
      const { avisar, avisos } = armar();
      await avisar(job(2), new Error('429 RESOURCE_EXHAUSTED'));
      expect(avisos).toHaveLength(1);
    });

    it('un error irrecuperable avisa de una, sin esperar reintentos', async () => {
      // La clave inválida no mejora reintentando: BullMQ ni lo intenta.
      const { avisar, avisos } = armar();
      await avisar(job(0), new UnrecoverableError('IA auth error: API key not valid'));
      expect(avisos).toHaveLength(1);
    });
  });

  describe('qué recibe el cliente', () => {
    it('le llega que lo atiende una persona, no silencio', async () => {
      const { avisar, mensajesAlCliente } = armar();
      await avisar(job(2), new Error('429'));
      expect(mensajesAlCliente).toHaveLength(1);
      expect(mensajesAlCliente[0].tel).toBe('51987654321');
      expect(mensajesAlCliente[0].texto).toMatch(/te atiende una persona/i);
    });

    it('si el chat ya estaba tomado por un humano, no se le escribe encima', async () => {
      const { avisar, mensajesAlCliente } = armar({ botActivo: false });
      await avisar(job(2), new Error('429'));
      expect(mensajesAlCliente).toHaveLength(0);
    });
  });

  describe('la pausa', () => {
    it('pausa la IA en ese chat, y VENCE sola', async () => {
      const { avisar, pausas } = armar();
      await avisar(job(2), new Error('429 quota'));
      expect(pausas.length).toBeGreaterThan(0);
      const p = pausas[0];
      expect(p.botActivo).toBe(false);
      // Que venza es lo que evita que un corte de una hora mate la atención
      // de esa conversación para siempre.
      expect(p.pausadoHasta).toBeInstanceOf(Date);
      const faltan = p.pausadoHasta.getTime() - Date.now();
      expect(faltan).toBeGreaterThan(PAUSA_INTERVENCION_MS - 5000);
      expect(faltan).toBeLessThanOrEqual(PAUSA_INTERVENCION_MS);
    });

    it('la escribe en la conversación Y en el prospecto', async () => {
      // La conversación es la que mira el processor; el prospecto es lo que
      // pinta "IA en pausa" en el embudo.
      const { avisar, prisma } = armar();
      await avisar(job(2), new Error('429'));
      expect(prisma.leadConversacion.update).toHaveBeenCalled();
      expect(prisma.leadProspecto.updateMany).toHaveBeenCalled();
    });

    it('no vuelve a pausar lo que ya estaba pausado', async () => {
      const { avisar, prisma } = armar({ botActivo: false });
      await avisar(job(2), new Error('429'));
      expect(prisma.leadConversacion.update).not.toHaveBeenCalled();
    });
  });

  describe('qué recibe el negocio', () => {
    it('dice que es por créditos cuando es por créditos', async () => {
      const { avisar, avisos } = armar();
      await avisar(job(2), new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));
      expect(avisos[0].titulo).toMatch(/sin créditos/i);
      expect(avisos[0].mensaje).toMatch(/Carga créditos/i);
      expect(avisos[0].metaData.porCuota).toBe(true);
    });

    it('y no lo dice cuando es otra cosa', async () => {
      const { avisar, avisos } = armar();
      await avisar(job(2), new Error('ECONNRESET'));
      expect(avisos[0].titulo).not.toMatch(/créditos/i);
      expect(avisos[0].metaData.porCuota).toBe(false);
    });

    it('dice qué hacer mientras tanto', async () => {
      const { avisar, avisos } = armar();
      await avisar(job(2), new Error('429'));
      expect(avisos[0].mensaje).toMatch(/atenderlos a mano/i);
    });

    it('también avisa por WhatsApp: nadie mira el panel a las 11 de la noche', async () => {
      const { avisar, alerta } = armar();
      await avisar(job(2), new Error('429'));
      expect(alerta.avisarDerivacion).toHaveBeenCalledWith(
        expect.objectContaining({ empresaId: EMPRESA, supervisorTelefono: '955947892' }),
      );
    });

    it('veinte clientes chocando con el mismo problema = UN aviso', async () => {
      // Sin esto, quedarse sin créditos le llena el panel de notificaciones
      // idénticas y el aviso deja de leerse.
      const { avisar, avisos, mensajesAlCliente } = armar();
      for (let i = 0; i < 20; i++) await avisar(job(2), new Error('429'));
      expect(avisos).toHaveLength(1);
      // Pero cada cliente sí recibe su mensaje: el problema es del negocio,
      // la espera es de cada uno.
      expect(mensajesAlCliente).toHaveLength(20);
    });
  });
});
