import { evolutionDisponible, leerEvolutionEnv } from './evolution-config';
import { ENV_EVOLUTION } from './evolution.fixtures';

describe('Evolution apagado por defecto', () => {
  it.each([
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_WEBHOOK_SECRET',
  ])('sin %s → apagado', (falta) => {
    const env = { ...ENV_EVOLUTION, [falta]: '  ' };
    expect(leerEvolutionEnv(env)).toBeNull();
    expect(evolutionDisponible(1, leerEvolutionEnv(env))).toBe(false);
  });

  it('sin ninguna variable → apagado', () => {
    expect(leerEvolutionEnv({})).toBeNull();
  });
});

describe('piloto', () => {
  it('lista de empresas separada por comas (con espacios y basura)', () => {
    const cfg = leerEvolutionEnv({
      ...ENV_EVOLUTION,
      EVOLUTION_EMPRESAS_PILOTO: ' 7, 12 ,abc,,-3',
    });
    expect(evolutionDisponible(7, cfg)).toBe(true);
    expect(evolutionDisponible(12, cfg)).toBe(true);
    expect(evolutionDisponible(1, cfg)).toBe(false);
    expect(evolutionDisponible(-3, cfg)).toBe(false);
  });
  it('"*" = todas', () => {
    const cfg = leerEvolutionEnv({
      ...ENV_EVOLUTION,
      EVOLUTION_EMPRESAS_PILOTO: '*',
    });
    expect(evolutionDisponible(999, cfg)).toBe(true);
  });
  it('vacío = nadie (configurado pero sin piloto)', () => {
    const cfg = leerEvolutionEnv({
      ...ENV_EVOLUTION,
      EVOLUTION_EMPRESAS_PILOTO: '',
    });
    expect(cfg).not.toBeNull();
    expect(evolutionDisponible(1, cfg)).toBe(false);
  });
});

describe('límites anti-bloqueo', () => {
  it('por defecto: tope 300/día, pausa 3–7 s, cola de 20', () => {
    const cfg = leerEvolutionEnv({
      ...ENV_EVOLUTION,
      EVOLUTION_PAUSA_MIN_MS: undefined,
      EVOLUTION_PAUSA_MAX_MS: undefined,
    })!;
    expect([
      cfg.topeDiario,
      cfg.pausaMinMs,
      cfg.pausaMaxMs,
      cfg.colaMax,
    ]).toEqual([300, 3000, 7000, 20]);
  });
  it('valores inválidos vuelven al defecto; max nunca menor que min', () => {
    const cfg = leerEvolutionEnv({
      ...ENV_EVOLUTION,
      EVOLUTION_TOPE_DIARIO: '0',
      EVOLUTION_PAUSA_MIN_MS: '5000',
      EVOLUTION_PAUSA_MAX_MS: '1000',
      EVOLUTION_COLA_MAX: 'muchos',
    })!;
    expect([
      cfg.topeDiario,
      cfg.pausaMinMs,
      cfg.pausaMaxMs,
      cfg.colaMax,
    ]).toEqual([300, 5000, 5000, 20]);
  });
  it('URL del webhook: EVOLUTION_WEBHOOK_BASE_URL (red privada) gana a BACKEND_URL', () => {
    expect(leerEvolutionEnv(ENV_EVOLUTION)!.webhookBase).toBe(
      'https://api.krezka.com',
    );
    const cfg = leerEvolutionEnv({
      ...ENV_EVOLUTION,
      EVOLUTION_WEBHOOK_BASE_URL: 'http://backend.railway.internal:4001/',
    })!;
    expect(cfg.webhookBase).toBe('http://backend.railway.internal:4001');
  });
});
