/**
 * El aviso al celular del equipo tiene que llegar cuando sirve y callarse
 * cuando sería ruido (ver soporte-aviso.ts).
 */
import { debeAvisar, enHorarioDeSoporte, telefonosDeAviso, textoDeAviso } from './soporte-aviso';

// Fechas en hora de Lima (UTC-5).
const lima = (iso: string) => new Date(`${iso}-05:00`);

describe('horario del aviso de soporte', () => {
  it('lunes a viernes de 9 a 6', () => {
    expect(enHorarioDeSoporte(lima('2026-10-26T09:00:00'))).toBe(true); // lunes
    expect(enHorarioDeSoporte(lima('2026-10-30T17:59:00'))).toBe(true); // viernes
    expect(enHorarioDeSoporte(lima('2026-10-30T18:00:00'))).toBe(false);
    expect(enHorarioDeSoporte(lima('2026-10-27T08:59:00'))).toBe(false);
  });

  it('sábado de 9 a 1 y domingo nada', () => {
    expect(enHorarioDeSoporte(lima('2026-10-31T12:30:00'))).toBe(true);
    expect(enHorarioDeSoporte(lima('2026-10-31T13:00:00'))).toBe(false);
    expect(enHorarioDeSoporte(lima('2026-11-01T11:00:00'))).toBe(false);
  });
});

describe('cuándo se avisa', () => {
  const martes = lima('2026-10-27T11:00:00');
  it('solo con el primer mensaje sin leer: una ráfaga es un solo aviso', () => {
    expect(debeAvisar(1, martes)).toBe(true);
    expect(debeAvisar(2, martes)).toBe(false);
  });
  it('fuera de horario no se avisa', () => {
    expect(debeAvisar(1, lima('2026-10-27T22:00:00'))).toBe(false);
  });
});

describe('números del equipo', () => {
  it('acepta 9 dígitos peruanos, con o sin 51, y no repite', () => {
    expect(telefonosDeAviso('987654321, 51987654321; +51 912 345 678')).toEqual(['51987654321', '51912345678']);
    expect(telefonosDeAviso(undefined)).toEqual([]);
  });
});

it('el texto lleva la empresa, quién escribe y el enlace a la bandeja', () => {
  const t = textoDeAviso('Bodega Ana', 'Ana', 'No me deja emitir', 'https://app.krezka.com');
  expect(t).toContain('Bodega Ana');
  expect(t).toContain('No me deja emitir');
  expect(t).toContain('https://app.krezka.com/administrador/sistema/soporte');
});
