import { avisoVoucher, extraerTitular, nombreCoincide } from './voucher-verificacion';

const CONTEXTO =
  'MEDIOS DE PAGO\nYape 955 947 892, titular Edwing Tony Cayo Huerta. BCP cuenta 19199295336017, titular Edwing Tony Cayo Huerta.\nNunca inventes cuentas, titulares ni medios de pago distintos.';

describe('titular de la cuenta del negocio', () => {
  it('se saca de la frase "titular …"', () => {
    expect(extraerTitular(CONTEXTO)).toBe('Edwing Tony Cayo Huerta');
  });
  it('sin la frase, no hay titular (y no se marca nada)', () => {
    expect(extraerTitular('Pagos por Yape al 955 947 892')).toBeNull();
  });
});

describe('¿el nombre de la captura es el del titular?', () => {
  it('Yape enmascara el apellido y aun así coincide', () => {
    expect(nombreCoincide('Edwing Cay*', 'Edwing Tony Cayo Huerta')).toBe(true);
  });
  it('caso real del 19-10: Steysy Deu* no es Edwing', () => {
    expect(nombreCoincide('Steysy Deu*', 'Edwing Tony Cayo Huerta')).toBe(false);
  });
});

describe('aviso para el modelo', () => {
  it('caso real: S/ 500 a otra cuenta para un adelanto con S/ 100 pendientes', () => {
    const a = avisoVoucher({
      monto: 500,
      nombre: 'Steysy Deu*',
      referenciaTitular: 'Edwing Tony Cayo Huerta',
      pendiente: 100,
    })!;
    expect(a).toMatch(/Steysy Deu\* , que no es el titular|Steysy Deu\*, que no es el titular/);
    expect(a).toMatch(/mayor a lo que falta pagar/);
    expect(a).toMatch(/NO confirmes el pago/);
    expect(a).toMatch(/No ofrezcas saldo a favor/);
  });
  it('si cuadra, no dice nada', () => {
    expect(
      avisoVoucher({
        monto: 50,
        nombre: 'Edwing Cay*',
        referenciaTitular: 'Edwing Tony Cayo Huerta',
        pendiente: 100,
      }),
    ).toBeNull();
  });
});
