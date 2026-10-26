import { despedidaValida, despedirsePorMotivo, textoDespedida } from './despedida';
import { postergaLaCompra } from './leads-disparadores';
import { motivoParaNoReenganchar } from './leads-seguimiento.service';

const TEXTO_HIERBA_SANA =
  '¡Un gusto ayudarte! Quedamos siempre a tu disposición para lo que necesites. 😊🌿\n\n' +
  'Guarda nuestro número para no perderte nuestras promos en WhatsApp 📦 y síguenos en Facebook:\n' +
  '👉 https://web.facebook.com/HierbaSanaPeru';

describe('la despedida del negocio', () => {
  it('sale tal cual la escribió el negocio, solo si está encendida', () => {
    expect(textoDespedida({ despedida: { activa: true, texto: TEXTO_HIERBA_SANA } })).toBe(TEXTO_HIERBA_SANA);
    expect(textoDespedida({ despedida: { activa: false, texto: TEXTO_HIERBA_SANA } })).toBeNull();
    expect(textoDespedida({})).toBeNull();
    expect(textoDespedida(null)).toBeNull();
  });

  it('encendida pero sin texto no cuenta como encendida', () => {
    expect(despedidaValida({ activa: true, texto: '   ' })).toEqual({ activa: false, texto: '' });
  });

  it('venta cerrada y "lo consulto" se despiden; aviso programado y demo no', () => {
    expect(despedirsePorMotivo('ya agendó su pedido')).toBe(true);
    expect(despedirsePorMotivo('dijo que avisaba o que escribía después')).toBe(true);
    expect(despedirsePorMotivo('tiene un aviso programado para cuando dijo')).toBe(false);
    expect(despedirsePorMotivo('se le acaba de dar la demo')).toBe(false);
    expect(despedirsePorMotivo(null)).toBe(false);
  });

  it.each([
    'Ok, lo consulto con mi médico y te escribo',
    'voy a consultarlo con mi esposa',
    'primero tengo que consultar con mi doctor',
    'déjame preguntarle a mi hija',
  ])('"%s" pausa la compra y lleva a la despedida', (texto) => {
    expect(postergaLaCompra(texto)).toBe(true);
    expect(
      despedirsePorMotivo(
        motivoParaNoReenganchar({ pedidoAgendado: false, esperaAvisoProgramado: false, ultimoDelCliente: texto }),
      ),
    ).toBe(true);
  });
});

describe('la despedida tras el reenganche en el cron', () => {
  // QA 26-10: con un return temprano por "no hay a quién reenganchar" la
  // despedida de las 2 horas no salía nunca.
  it('sale aunque en ese ciclo no haya nadie a quien reenganchar', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LeadsSeguimientoService } = require('./leads-seguimiento.service');
    jest.useFakeTimers().setSystemTime(new Date('2026-10-26T16:30:00Z')); // 11:30 Lima
    const hace = (min: number) => new Date(Date.now() - min * 60_000);
    const prisma = {
      leadConversacion: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([]) // candidatas al reenganche
          .mockResolvedValueOnce([
            {
              id: 7,
              telefonoProspecto: '51900000107',
              ultimoSeguimientoEn: hace(130),
              empresa: { id: 89, iaVentasConfigJson: { despedida: { activa: true, texto: TEXTO_HIERBA_SANA } } },
            },
          ]),
        update: jest.fn().mockResolvedValue({}),
      },
      leadMensaje: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ rol: 'ASISTENTE', creadoEn: hace(130) }) // el reenganche
          .mockResolvedValueOnce({ creadoEn: hace(200) }), // último del cliente
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const enviarTexto = jest.fn().mockResolvedValue({ success: true });
    const svc = new LeadsSeguimientoService(prisma, { disponible: () => true }, { enviarTexto });
    await svc.ejecutar();
    jest.useRealTimers();
    expect(enviarTexto).toHaveBeenCalledWith('51900000107', TEXTO_HIERBA_SANA, 89);
    expect(prisma.leadConversacion.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { seguimientos: 2 } });
  });
});
