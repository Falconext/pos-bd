/**
 * F 33.3 — "te aviso luego" es una venta en pausa, no una venta perdida.
 *
 * Importa distinguirlo de una despedida: tratarlo como cierre deja ir al
 * cliente que estaba a un recordatorio de comprar. Y al revés, ver un
 * "aviso" donde no lo hay le manda un recordatorio a alguien que no dijo
 * nada de eso.
 */
import { postergaLaCompra } from './leads-disparadores';
import { esDespedidaClara } from './leads-repeticion';

describe('el cliente que posterga', () => {
  const POSTERGAN = [
    'ok, te aviso',
    'luego te aviso cualquier cosa',
    'déjame pensarlo y te escribo',
    'lo voy a pensar',
    'mañana te escribo',
    'ahora no puedo, cuando cobre te escribo',
    'lo consulto y te confirmo',
    'a fin de mes lo compro',
  ];

  it.each(POSTERGAN)('reconoce "%s"', (frase) => {
    expect(postergaLaCompra(frase)).toBe(true);
  });

  const NO_POSTERGAN = [
    'cuánto cuesta la moringa',
    'gracias',
    'sí, lo quiero',
    'ok',
    'dale, mándame la cuenta',
  ];

  it.each(NO_POSTERGAN)('no ve una postergación en "%s"', (frase) => {
    expect(postergaLaCompra(frase)).toBe(false);
  });

  it('postergar NO es despedirse: son dos caminos distintos', () => {
    // Si "lo voy a pensar" contara como despedida, la conversación se
    // cerraría y el recordatorio de 33.3 nunca se programaría.
    for (const frase of ['lo voy a pensar', 'te aviso', 'mañana te escribo']) {
      expect(postergaLaCompra(frase)).toBe(true);
      expect(esDespedidaClara(frase)).toBe(false);
    }
  });

  it('y una despedida de verdad no es una postergación', () => {
    for (const frase of ['gracias, hasta luego', 'ok gracias']) {
      expect(postergaLaCompra(frase)).toBe(false);
    }
  });
});
