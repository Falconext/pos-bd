jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));
import { LeadsMessageProcessor } from './leads-message.processor';

function armar(respuestas: number, pasosDelMenu = 0) {
  const nuestros = [
    ...Array.from({ length: pasosDelMenu }, (_, paso) => ({
      rol: 'ASISTENTE',
      contenido: 'pregunta',
      herramientasJson: [{ nombre: 'menu_inicial', argumentos: { paso } }],
    })),
    ...Array.from({ length: respuestas }, () => ({ rol: 'ASISTENTE', contenido: 'respuesta', herramientasJson: null })),
  ];
  const prisma = { leadMensaje: { findMany: jest.fn().mockResolvedValue(nuestros) } };
  const whatsapp = {
    enviarVideoUrl: jest.fn().mockResolvedValue({ success: true }),
    enviarTexto: jest.fn().mockResolvedValue({ success: true }),
  };
  const p = new LeadsMessageProcessor(
    prisma as never, {} as never, {} as never, whatsapp as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  const enviar = (url?: string) =>
    (p as any).enviarVideoBienvenidaSiEsElPrimero(22, { id: 1, telefonoProspecto: '51991065217' }, { videoBienvenidaUrl: url });
  return { enviar, whatsapp };
}

describe('video de bienvenida (Krezka)', () => {
  it('YouTube: va como mensaje con el enlace, tras la primera respuesta', async () => {
    const { enviar, whatsapp } = armar(1);
    await enviar('https://www.youtube.com/watch?v=32_tWlIAfA4');
    expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
      '51991065217', expect.stringContaining('youtube.com/watch?v=32_tWlIAfA4'), 22,
    );
    expect(whatsapp.enviarVideoUrl).not.toHaveBeenCalled();
  });
  it('MP4: va como video', async () => {
    const { enviar, whatsapp } = armar(1);
    await enviar('https://x.s3.amazonaws.com/v.mp4');
    expect(whatsapp.enviarVideoUrl).toHaveBeenCalled();
  });
  it('no se repite después de la primera respuesta, ni sin video configurado', async () => {
    const a = armar(2); await a.enviar('https://youtu.be/x');
    const b = armar(1); await b.enviar(undefined);
    expect(a.whatsapp.enviarTexto).not.toHaveBeenCalled();
    expect(b.whatsapp.enviarTexto).not.toHaveBeenCalled();
  });
  it('los pasos del menú de bienvenida no cuentan: va tras la primera respuesta de la IA', async () => {
    const { enviar, whatsapp } = armar(1, 3);
    await enviar('https://youtu.be/x');
    expect(whatsapp.enviarTexto).toHaveBeenCalled();
  });
});
