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
