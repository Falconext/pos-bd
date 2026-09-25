/**
 * Las pasarelas de la tienda cobran a la cuenta DEL COMERCIANTE, no a una
 * cuenta global de la plataforma. Antes Culqi leía CULQI_SECRET_KEY del entorno
 * y el dinero de todas las tiendas entraba a la misma cuenta.
 *
 * Se valida el contrato de las credenciales: que se cifren al guardar, que se
 * puedan recuperar para cobrar, y que sin credenciales propias la tienda no
 * ofrezca el medio de pago.
 */
import { cifrarSecreto, descifrarSecreto } from '../common/utils/secreto.util';

/** Réplica de la condición que decide si la tienda ofrece tarjeta. */
const aceptaTarjeta = (empresa: any) =>
  Boolean(
    empresa.plan?.tieneCulqi &&
      empresa.culqiActivo &&
      (empresa.culqiPublicKey || '').trim() &&
      (descifrarSecreto(empresa.culqiSecretKey) || ''),
  );

const empresaBase = (extra: Record<string, any> = {}) => ({
  plan: { tieneCulqi: true },
  culqiActivo: true,
  culqiPublicKey: 'pk_test_de_la_tienda',
  culqiSecretKey: cifrarSecreto('sk_test_de_la_tienda'),
  ...extra,
});

describe('Pasarelas de pago por empresa', () => {
  describe('la llave secreta se guarda cifrada', () => {
    it('no queda en claro en la base', () => {
      const guardado = cifrarSecreto('sk_test_abc123');
      expect(guardado).not.toContain('sk_test_abc123');
      expect(guardado).toMatch(/^v1:/);
    });

    it('se puede recuperar para cobrar', () => {
      expect(descifrarSecreto(cifrarSecreto('sk_test_abc123'))).toBe('sk_test_abc123');
    });

    it('una credencial vacía se guarda como null, no como cadena cifrada', () => {
      expect(cifrarSecreto('')).toBeNull();
      expect(cifrarSecreto(undefined)).toBeNull();
    });
  });

  describe('cuándo la tienda ofrece pago con tarjeta', () => {
    it('con plan, interruptor y ambas llaves del comerciante: sí', () => {
      expect(aceptaTarjeta(empresaBase())).toBe(true);
    });

    it('sin llaves propias: no (antes caía a la llave global de la plataforma)', () => {
      expect(aceptaTarjeta(empresaBase({ culqiPublicKey: null, culqiSecretKey: null }))).toBe(false);
    });

    it('con llave pública pero sin secreta: no, porque no podría cobrar', () => {
      expect(aceptaTarjeta(empresaBase({ culqiSecretKey: null }))).toBe(false);
    });

    it('con el interruptor apagado: no, aunque tenga credenciales', () => {
      expect(aceptaTarjeta(empresaBase({ culqiActivo: false }))).toBe(false);
    });

    it('sin el módulo en el plan: no', () => {
      expect(aceptaTarjeta(empresaBase({ plan: { tieneCulqi: false } }))).toBe(false);
    });

    it('las llaves de una empresa no sirven para otra', () => {
      const tiendaA = empresaBase({ culqiSecretKey: cifrarSecreto('sk_de_A') });
      const tiendaB = empresaBase({ culqiSecretKey: cifrarSecreto('sk_de_B') });
      expect(descifrarSecreto(tiendaA.culqiSecretKey)).toBe('sk_de_A');
      expect(descifrarSecreto(tiendaB.culqiSecretKey)).toBe('sk_de_B');
      expect(tiendaA.culqiSecretKey).not.toBe(tiendaB.culqiSecretKey);
    });
  });
});
