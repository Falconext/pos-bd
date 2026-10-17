/**
 * Cómo se lee la respuesta del PSE al enviar una guía.
 *
 * Tiene test propio porque acá se perdió una guía de verdad: SUNAT la rechazó
 * con el código 2566 y el sistema la dejó en PENDIENTE, sin motivo guardado,
 * sin reintento y con la app diciendo "enviada, seguiremos actualizando su
 * estado". El rechazo llegó como `sunat_success: false` + código, SIN CDR y con
 * `errors: []`, dentro de un envoltorio con `success: true` —que solo dice que
 * la llamada al PSE salió bien— y esa combinación caía en la rama de PENDIENTE.
 *
 * Reglas que se verifican (códigos de SUNAT): 0 = aceptado, 4xxx = observado
 * (aceptado igual), 98 = en proceso, el resto con `sunat_success: false` = rechazo.
 */
import { SunatGuiaService } from './sunat-guia.service';

const estado = (respuesta: any): string =>
  (new SunatGuiaService(null as any) as any).normalizeStatus(respuesta);

describe('estado del envío de una guía según la respuesta del PSE', () => {
  it('rechazo por excepción (2566, sin CDR) es RECHAZADO, no PENDIENTE', () => {
    // La respuesta real que dejó a la guía T001-1 en el limbo.
    expect(
      estado({
        success: true,
        connection: true,
        sunat_success: false,
        code: '2566',
        message: 'Vehiculo principal: 2566 (nodo: "/" valor: "")',
        errors: [],
        cdr: null,
      }),
    ).toBe('RECHAZADO');
  });

  it('rechazo con CDR también es RECHAZADO', () => {
    expect(
      estado({ success: true, sunat_success: false, code: '2325', cdr: 'base64' }),
    ).toBe('RECHAZADO');
  });

  it('el ticket recién enviado sigue PENDIENTE (aún no hay veredicto)', () => {
    expect(
      estado({
        success: true,
        sunat_success: true,
        code: '0',
        message: 'Ticket obtenido con éxito',
        ticket: 'abc123',
        cdr: null,
      }),
    ).toBe('PENDIENTE');
  });

  it('aceptado con CDR es ACEPTADO', () => {
    expect(
      estado({ success: true, sunat_success: true, code: '0', cdr: 'base64' }),
    ).toBe('ACEPTADO');
  });

  it('observado (4xxx con CDR) es ACEPTADO: SUNAT lo recibió', () => {
    expect(
      estado({ success: true, sunat_success: true, code: '4000', cdr: 'base64' }),
    ).toBe('ACEPTADO');
  });

  it('98 es "en proceso": sigue PENDIENTE', () => {
    expect(estado({ success: true, sunat_success: null, code: '98' })).toBe(
      'PENDIENTE',
    );
  });
});
