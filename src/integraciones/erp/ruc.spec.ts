import { rucValido } from './ruc';

describe('rucValido', () => {
  it.each(['20131312955', '20100047218', '20605386076'])('%s es válido', (r) => {
    expect(rucValido(r)).toBe(true);
  });
  it.each(['20123456789', '20131312954', '30131312955', '2013131295', '', null])('%s no es válido', (r) => {
    expect(rucValido(r as any)).toBe(false);
  });
});
