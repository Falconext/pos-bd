/**
 * Casillas de "cuándo pasar a una persona" (29-10, idea de YaVendió).
 */
import {
  bloqueDerivacion,
  conMotivosDelNegocio,
  derivarEnValido,
} from './derivar-en';
import { HERRAMIENTA_DERIVAR } from './leads-herramientas';

describe('derivarEnValido', () => {
  it('sin configurar es undefined: deriva por todo, como antes', () => {
    expect(derivarEnValido(undefined)).toBeUndefined();
    expect(derivarEnValido('mayorista')).toBeUndefined();
  });

  it('descarta motivos inventados y siempre deja "pide hablar con una persona"', () => {
    expect(derivarEnValido(['reclamo', 'inventado'])).toEqual(['reclamo', 'pide_hablar_con_persona']);
    expect(derivarEnValido([])).toEqual(['pide_hablar_con_persona']);
  });
});

describe('bloqueDerivacion', () => {
  it('sin casillas apagadas no cambia el prompt', () => {
    expect(bloqueDerivacion(undefined)).toBe('');
  });

  it('lista lo que la IA tiene que atender ella', () => {
    const b = bloqueDerivacion(derivarEnValido(['reclamo', 'cancelacion']));
    expect(b).toContain('compra al por mayor');
    expect(b).not.toContain('reclamo, producto dañado');
    expect(b).toContain('derívalo siempre');
  });
});

describe('conMotivosDelNegocio', () => {
  const base = jest.fn().mockResolvedValue({ derivado: true });
  beforeEach(() => base.mockClear());

  it('un motivo apagado no deriva y le dice a la IA que lo atienda', async () => {
    const ej = conMotivosDelNegocio(base, derivarEnValido(['reclamo']));
    const r = (await ej(HERRAMIENTA_DERIVAR, { motivo: 'mayorista' })) as { derivado: boolean };
    expect(r.derivado).toBe(false);
    expect(base).not.toHaveBeenCalled();
  });

  it('un motivo encendido, pedir una persona y las demás herramientas pasan igual', async () => {
    const ej = conMotivosDelNegocio(base, derivarEnValido(['reclamo']));
    await ej(HERRAMIENTA_DERIVAR, { motivo: 'reclamo' });
    await ej(HERRAMIENTA_DERIVAR, { motivo: 'pide_hablar_con_persona' });
    await ej('buscar_productos', { consulta: 'polo' });
    expect(base).toHaveBeenCalledTimes(3);
  });

  it('sin configurar devuelve el mismo ejecutor', () => {
    expect(conMotivosDelNegocio(base, undefined)).toBe(base);
  });
});
