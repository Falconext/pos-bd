/**
 * El menú de bienvenida dentro del procesador: qué contesta el menú y cuándo
 * le toca a la IA (ver menu-inicial.ts).
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));
import { LeadsMessageProcessor } from './leads-message.processor';
import { HERRAMIENTA_MENU, menuValido } from './menu-inicial';
import { HERRAMIENTA_DERIVAR } from './leads-herramientas';

const MENU = menuValido({
  activo: true,
  bienvenida: '¡Hola! 👋 Bienvenido(a) a KREZKA 🚀',
  pasos: [
    {
      pregunta: '¿Qué deseas mejorar?',
      opciones: [{ titulo: 'Facturación' }, { titulo: 'Envíos' }, { titulo: 'Hablar con asesor', derivar: true }],
    },
    { pregunta: '¿Dónde vendes?', opciones: [{ titulo: 'Tienda física' }, { titulo: 'Internet' }] },
  ],
});

const CONV = { id: 7, telefonoProspecto: '51999888777' };

function armar() {
  const prisma = {
    leadMensaje: { create: jest.fn().mockResolvedValue({}) },
    leadConversacion: { update: jest.fn().mockResolvedValue({}) },
  };
  const whatsapp = {
    enviarMenu: jest.fn().mockResolvedValue({ success: true }),
    enviarTexto: jest.fn().mockResolvedValue({ success: true }),
  };
  const p = new LeadsMessageProcessor(
    prisma as never, {} as never, {} as never, whatsapp as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  const ejecutor = jest.fn().mockResolvedValue({ derivado: true });
  (p as any).crearEjecutor = () => ejecutor;
  const atender = (mensajes: any[], config: any = { menu: MENU }) =>
    (p as any).atenderMenu(22, CONV, mensajes, config) as Promise<boolean>;
  return { atender, prisma, whatsapp, ejecutor };
}

const marca = (paso: number) => [{ nombre: HERRAMIENTA_MENU, argumentos: { paso } }];

describe('menú de bienvenida en el procesador', () => {
  it('conversación nueva: sale el saludo exacto con la primera pregunta, no la IA', async () => {
    const { atender, whatsapp, prisma } = armar();
    expect(await atender([{ rol: 'USUARIO', contenido: 'Hola, quiero más información' }])).toBe(true);
    const enviado = whatsapp.enviarMenu.mock.calls[0][1];
    expect(enviado.cuerpo).toBe('¡Hola! 👋 Bienvenido(a) a KREZKA 🚀\n\n¿Qué deseas mejorar?');
    expect(enviado.tipo).toBe('botones');
    expect(prisma.leadMensaje.create.mock.calls[0][0].data.herramientasJson[0]).toMatchObject({
      nombre: HERRAMIENTA_MENU,
      argumentos: { paso: 0 },
    });
  });

  it('tocó una opción: sale la pregunta siguiente', async () => {
    const { atender, whatsapp } = armar();
    const r = await atender([
      { rol: 'USUARIO', contenido: 'Hola' },
      { rol: 'ASISTENTE', contenido: '…', herramientasJson: marca(0) },
      { rol: 'USUARIO', contenido: 'Envíos' },
    ]);
    expect(r).toBe(true);
    expect(whatsapp.enviarMenu.mock.calls[0][1].cuerpo).toBe('¿Dónde vendes?');
  });

  it('respondió la última pregunta, o escribió otra cosa: sigue la IA', async () => {
    const a = armar();
    expect(
      await a.atender([
        { rol: 'ASISTENTE', contenido: '…', herramientasJson: marca(1) },
        { rol: 'USUARIO', contenido: 'Internet' },
      ]),
    ).toBe(false);
    const b = armar();
    expect(
      await b.atender([
        { rol: 'ASISTENTE', contenido: '…', herramientasJson: marca(0) },
        { rol: 'USUARIO', contenido: 'cuánto cuesta el plan?' },
      ]),
    ).toBe(false);
    expect(a.whatsapp.enviarMenu).not.toHaveBeenCalled();
    expect(b.whatsapp.enviarMenu).not.toHaveBeenCalled();
  });

  it('opción que deriva: pasa a una persona con lo que eligió y avisa al cliente', async () => {
    const { atender, ejecutor, whatsapp } = armar();
    const r = await atender(
      [
        { rol: 'ASISTENTE', contenido: '…', herramientasJson: marca(0) },
        { rol: 'USUARIO', contenido: 'Hablar con asesor' },
      ],
      { menu: MENU, vendedor: { mensajeDerivacion: 'Alguien de ventas se contactará contigo 🙌' } },
    );
    expect(r).toBe(true);
    expect(ejecutor).toHaveBeenCalledWith(HERRAMIENTA_DERIVAR, expect.objectContaining({
      motivo: 'pide_hablar_con_persona',
      detalle: expect.stringContaining('Hablar con asesor'),
    }));
    expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
      CONV.telefonoProspecto, 'Alguien de ventas se contactará contigo 🙌', 22,
    );
  });

  it('menú apagado o conversación ya atendida por la IA: no hace nada', async () => {
    const a = armar();
    expect(await a.atender([{ rol: 'USUARIO', contenido: 'Hola' }], { menu: { ...MENU, activo: false } })).toBe(false);
    const b = armar();
    expect(
      await b.atender([
        { rol: 'ASISTENTE', contenido: 'Hola! En qué te ayudo?' },
        { rol: 'USUARIO', contenido: 'Envíos' },
      ]),
    ).toBe(false);
    expect(a.whatsapp.enviarMenu).not.toHaveBeenCalled();
    expect(b.whatsapp.enviarMenu).not.toHaveBeenCalled();
  });

  it('si WhatsApp rechaza los botones, la pregunta sale como texto numerado', async () => {
    const { atender, whatsapp } = armar();
    whatsapp.enviarMenu.mockResolvedValueOnce({ success: false, error: 'Invalid parameter' });
    await atender([{ rol: 'USUARIO', contenido: 'Hola' }]);
    expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
      CONV.telefonoProspecto, expect.stringContaining('1. Facturación'), 22,
    );
  });
});
