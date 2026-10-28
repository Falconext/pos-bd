jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { WhatsAppService } from './whatsapp.service';
import { LeadsMessageProcessor } from '../leads/leads-message.processor';

/**
 * Varios números de WhatsApp por empresa: sumar uno no le quita el número al
 * bot, a cada cliente se le escribe por el número de su chat y los mensajes
 * entrantes encuentran su empresa por cualquiera de sus números.
 */
function servicio(empresa: any = { whatsappProvider: 'EMPRESA', whatsappPhoneNumberId: 'PN-997' }) {
  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        ...empresa,
        whatsappActivo: true,
        whatsappApiToken: 'TOKEN-997',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    numeroWhatsapp: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    leadConversacion: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const s = new WhatsAppService(prisma, { get: () => 'SISTEMA' } as never);
  return { s, prisma };
}

describe('guardar un número', () => {
  const datos = { phoneNumberId: 'PN-972', wabaId: 'W-972', token: null, numeroVisible: '+51 972 258 391', coexistencia: true };

  it('agregar con un principal conectado: se suma y el principal no se toca', async () => {
    const { s, prisma } = servicio();
    const principal = await (s as any).guardarNumero(22, { ...datos, agregar: true });
    expect(principal).toBe(false);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
    expect(prisma.numeroWhatsapp.upsert.mock.calls[0][0].create).toMatchObject({ empresaId: 22, phoneNumberId: 'PN-972', principal: false, coexistencia: true });
  });

  it('reconectar (sin agregar) reemplaza al principal, como antes', async () => {
    const { s, prisma } = servicio();
    const principal = await (s as any).guardarNumero(22, { ...datos, agregar: false });
    expect(principal).toBe(true);
    expect(prisma.empresa.update.mock.calls[0][0].data).toMatchObject({ whatsappPhoneNumberId: 'PN-972', whatsappBusinessId: 'W-972' });
    expect(prisma.numeroWhatsapp.deleteMany.mock.calls[0][0].where).toMatchObject({ empresaId: 22, principal: true });
  });

  it('agregar sin ningún número conectado: el primero queda como principal', async () => {
    const { s, prisma } = servicio({ whatsappProvider: 'PLATFORM', whatsappPhoneNumberId: null });
    expect(await (s as any).guardarNumero(22, { ...datos, agregar: true })).toBe(true);
    expect(prisma.empresa.update).toHaveBeenCalled();
  });

  it('un número de otra empresa no se puede conectar', async () => {
    const { s, prisma } = servicio();
    prisma.numeroWhatsapp.findFirst.mockResolvedValue({ id: 9 });
    prisma.empresa.findFirst = jest.fn().mockResolvedValue(null);
    await expect((s as any).validarNumeroLibre(22, 'PN-972')).rejects.toThrow('otra cuenta');
  });
});

describe('a cada cliente se le escribe por el número de su chat', () => {
  it('chat que entró por el 972 → sale por el 972 con el token de plataforma', async () => {
    const { s, prisma } = servicio();
    prisma.leadConversacion.findFirst.mockResolvedValue({ numeroWhatsappId: 'PN-972' });
    prisma.numeroWhatsapp.findFirst.mockResolvedValue({ phoneNumberId: 'PN-972', token: null });
    const c = await (s as any).getCredentialsForEmpresa(22, '51999888777');
    expect(c).toMatchObject({ phoneId: 'PN-972', token: 'SISTEMA' });
  });

  it('sin chat (o número que ya no es de la empresa) → principal', async () => {
    const { s } = servicio();
    expect(await (s as any).getCredentialsForEmpresa(22, '51999888777')).toMatchObject({ phoneId: 'PN-997', token: 'TOKEN-997' });
  });

  it('sin destino (avisos de la empresa) → principal, sin consultar chats', async () => {
    const { s, prisma } = servicio();
    expect(await (s as any).getCredentialsForEmpresa(22)).toMatchObject({ phoneId: 'PN-997' });
    expect(prisma.leadConversacion.findFirst).not.toHaveBeenCalled();
  });
});

describe('mensajes entrantes', () => {
  const proc = (prisma: any) => Object.assign(Object.create(LeadsMessageProcessor.prototype), { prisma });

  it('un número adicional lleva a su empresa y dice si la IA contesta ahí', async () => {
    const p = proc({
      numeroWhatsapp: { findUnique: jest.fn().mockResolvedValue({ iaActiva: false, empresa: { id: 22, iaVentasActiva: true } }) },
      empresa: { findFirst: jest.fn() },
    });
    expect(await p.empresaDelNumero('PN-972')).toEqual({ id: 22, iaVentasActiva: true, iaActivaEnNumero: false });
  });

  it('un número que solo está en Empresa (conectado antes de esto) sigue funcionando', async () => {
    const p = proc({
      numeroWhatsapp: { findUnique: jest.fn().mockResolvedValue(null) },
      empresa: { findFirst: jest.fn().mockResolvedValue({ id: 5, iaVentasActiva: true }) },
    });
    expect(await p.empresaDelNumero('PN-OLD')).toEqual({ id: 5, iaVentasActiva: true });
  });
});
