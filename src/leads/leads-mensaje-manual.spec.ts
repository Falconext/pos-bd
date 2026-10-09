/**
 * Responder a mano desde el panel de IA de Ventas.
 *
 * Antes el panel solo dejaba LEER la conversación y pausar la IA: para contestar
 * había que salir a WhatsApp, cosa imposible si el número se migró a la Cloud API
 * y la app del celular dejó de funcionar. Este contrato cubre ese hueco.
 *
 * Lo que se valida: que no se envíe basura, que el mensaje salga por el WhatsApp
 * de la empresa correcta, que el historial refleje SOLO lo que sí salió, y que
 * tomar el chat a mano calle a la IA.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LIMITE_TEXTO_WHATSAPP } from './leads.constants';
import { PAUSA_INTERVENCION_MS } from './pausa-bot';

const EMPRESA = 7;
const CONVERSACION = 42;

/** Conversación de prueba: por defecto con la IA todavía activa. */
const conversacion = (extra: Record<string, any> = {}) => ({
  id: CONVERSACION,
  telefonoProspecto: '51987654321',
  prospecto: { id: 99, botActivo: true },
  ...extra,
});

function armar(
  opts: {
    conv?: any;
    envio?: { success: boolean; error?: string };
  } = {},
) {
  const conv = opts.conv === undefined ? conversacion() : opts.conv;
  const prisma: any = {
    leadConversacion: {
      findFirst: jest.fn().mockResolvedValue(conv),
      update: jest.fn().mockResolvedValue({}),
    },
    leadMensaje: {
      create: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 1, ...data }),
        ),
    },
    leadProspecto: { update: jest.fn().mockResolvedValue({}) },
  };
  const whatsapp: any = {
    enviarTexto: jest.fn().mockResolvedValue(opts.envio ?? { success: true }),
  };
  const service = new LeadsService(prisma, {} as any, {} as any, whatsapp);
  return { service, prisma, whatsapp };
}

describe('Mensaje manual del vendedor en una conversación de leads', () => {
  describe('validación de entrada', () => {
    it('rechaza un mensaje vacío', async () => {
      const { service, whatsapp } = armar();
      await expect(
        service.enviarMensajeManual(EMPRESA, CONVERSACION, ''),
      ).rejects.toThrow(BadRequestException);
      expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    });

    it('rechaza un mensaje que solo tiene espacios y saltos de línea', async () => {
      const { service, whatsapp } = armar();
      await expect(
        service.enviarMensajeManual(EMPRESA, CONVERSACION, '   \n\t  '),
      ).rejects.toThrow(BadRequestException);
      expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    });

    it('rechaza un mensaje más largo de lo que admite WhatsApp, sin llamar a Meta', async () => {
      const { service, whatsapp } = armar();
      const largo = 'a'.repeat(LIMITE_TEXTO_WHATSAPP + 1);
      await expect(
        service.enviarMensajeManual(EMPRESA, CONVERSACION, largo),
      ).rejects.toThrow(/supera los 4096/);
      expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    });

    it('acepta un mensaje justo en el límite', async () => {
      const { service, whatsapp } = armar();
      await service.enviarMensajeManual(
        EMPRESA,
        CONVERSACION,
        'a'.repeat(LIMITE_TEXTO_WHATSAPP),
      );
      expect(whatsapp.enviarTexto).toHaveBeenCalled();
    });

    it('recorta los espacios de los bordes antes de enviar y de guardar', async () => {
      const { service, whatsapp, prisma } = armar();
      await service.enviarMensajeManual(EMPRESA, CONVERSACION, '  hola  ');
      expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
        '51987654321',
        'hola',
        EMPRESA,
      );
      expect(prisma.leadMensaje.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contenido: 'hola' }),
        }),
      );
    });
  });

  describe('aislamiento entre empresas', () => {
    it('no deja escribir en una conversación de otra empresa', async () => {
      const { service, whatsapp } = armar({ conv: null });
      await expect(
        service.enviarMensajeManual(EMPRESA, CONVERSACION, 'hola'),
      ).rejects.toThrow(NotFoundException);
      expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    });

    it('busca la conversación filtrando por empresaId, no solo por id', async () => {
      const { service, prisma } = armar();
      await service.enviarMensajeManual(EMPRESA, CONVERSACION, 'hola');
      expect(prisma.leadConversacion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CONVERSACION, empresaId: EMPRESA },
        }),
      );
    });
  });

  describe('envío por WhatsApp', () => {
    it('envía al teléfono del prospecto desde el número de la empresa', async () => {
      const { service, whatsapp } = armar();
      await service.enviarMensajeManual(
        EMPRESA,
        CONVERSACION,
        'ya te despacho',
      );
      expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
        '51987654321',
        'ya te despacho',
        EMPRESA,
      );
    });

    it('si Meta rechaza el envío, falla con el motivo real', async () => {
      const { service } = armar({
        envio: { success: false, error: 'Ventana de 24h cerrada' },
      });
      await expect(
        service.enviarMensajeManual(EMPRESA, CONVERSACION, 'hola'),
      ).rejects.toThrow('Ventana de 24h cerrada');
    });

    it('si el envío falla, NO queda un mensaje fantasma en el historial', async () => {
      const { service, prisma } = armar({ envio: { success: false } });
      await expect(
        service.enviarMensajeManual(EMPRESA, CONVERSACION, 'hola'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.leadMensaje.create).not.toHaveBeenCalled();
      expect(prisma.leadConversacion.update).not.toHaveBeenCalled();
    });

    it('si el envío falla, tampoco se pausa la IA', async () => {
      const { service, prisma } = armar({ envio: { success: false } });
      await expect(
        service.enviarMensajeManual(EMPRESA, CONVERSACION, 'hola'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.leadProspecto.update).not.toHaveBeenCalled();
    });
  });

  describe('historial del chat', () => {
    it('guarda el mensaje como SISTEMA, para distinguirlo del bot y del cliente', async () => {
      const { service, prisma } = armar();
      await service.enviarMensajeManual(EMPRESA, CONVERSACION, 'hola');
      expect(prisma.leadMensaje.create).toHaveBeenCalledWith({
        data: {
          conversacionId: CONVERSACION,
          rol: 'SISTEMA',
          contenido: 'hola',
        },
      });
    });

    it('suma el mensaje al contador de la conversación', async () => {
      const { service, prisma } = armar();
      await service.enviarMensajeManual(EMPRESA, CONVERSACION, 'hola');
      expect(prisma.leadConversacion.update).toHaveBeenCalledWith({
        where: { id: CONVERSACION },
        data: { cantidadMensajes: { increment: 1 } },
      });
    });
  });

  describe('la IA se calla cuando el humano toma el chat', () => {
    it('pausa el bot al enviar el primer mensaje manual', async () => {
      const { service, prisma } = armar();
      const r = await service.enviarMensajeManual(
        EMPRESA,
        CONVERSACION,
        'hola',
      );
      const llamada = prisma.leadProspecto.update.mock.calls[0][0];
      expect(llamada.where).toEqual({ id: 99 });
      expect(llamada.data.botActivo).toBe(false);
      expect(llamada.data.motivoPausa).toBe('respuesta manual');
      // La pausa VENCE: antes era permanente y una sola respuesta manual
      // dejaba esa conversación sin IA para siempre.
      const faltanMs = llamada.data.pausadoHasta.getTime() - Date.now();
      expect(faltanMs).toBeGreaterThan(PAUSA_INTERVENCION_MS - 5000);
      expect(faltanMs).toBeLessThanOrEqual(PAUSA_INTERVENCION_MS);
      expect(r.botPausado).toBe(true);
    });

    it('no vuelve a pausarlo si el vendedor ya había tomado el chat', async () => {
      const { service, prisma } = armar({
        conv: conversacion({ prospecto: { id: 99, botActivo: false } }),
      });
      const r = await service.enviarMensajeManual(
        EMPRESA,
        CONVERSACION,
        'hola',
      );
      expect(prisma.leadProspecto.update).not.toHaveBeenCalled();
      expect(r.botPausado).toBe(false);
    });

    it('una conversación sin prospecto calificado todavía acepta el mensaje', async () => {
      const { service, prisma, whatsapp } = armar({
        conv: conversacion({ prospecto: null }),
      });
      const r = await service.enviarMensajeManual(
        EMPRESA,
        CONVERSACION,
        'hola',
      );
      expect(whatsapp.enviarTexto).toHaveBeenCalled();
      expect(prisma.leadProspecto.update).not.toHaveBeenCalled();
      expect(r.botPausado).toBe(false);
    });
  });
});
