/**
 * Qué se le dice al empresario cuando su comprobante no sale.
 *
 * El aviso era uno solo para toda causa: "verifica tu conexión y credenciales
 * PSE". El 09/10/2026 SUNAT dejó de responder y 10 comprobantes de 4 empresas
 * se quedaron en cola; a todos esos clientes se les dijo que revisaran algo que
 * no estaba roto. El riesgo no es el susto: es que la reacción natural —volver
 * a emitir o anular— rompe correlativos y duplica comprobantes.
 *
 * Estas pruebas fijan que el mensaje diga la verdad según la causa real, que ya
 * viene clasificada: RED es SUNAT, CONFIG y DATOS son del cliente.
 */
import { avisoFallaSunat } from './verificar-pendientes-sunat.service';

const REF = 'B0A1-00000412';
// El mensaje real que guardó el sistema la noche del incidente.
const ERROR_RED = '[RED] (intento 3/30): QPSE: No se recibió respuesta válida de SUNAT';

describe('Aviso al empresario · cuando el problema es de SUNAT', () => {
  const aviso = avisoFallaSunat(REF, 5, ERROR_RED);

  it('lo reconoce como problema de SUNAT', () => {
    expect(aviso.esDeSunat).toBe(true);
  });

  it('NO le pide revisar credenciales ni conexión: no es su culpa', () => {
    expect(aviso.mensaje).not.toMatch(/credencial/i);
    expect(aviso.mensaje).not.toMatch(/verifica tu conexión/i);
  });

  it('le dice explícitamente que no reemita ni anule', () => {
    expect(aviso.mensaje).toMatch(/no lo vuelvas a emitir/i);
    expect(aviso.mensaje).toMatch(/anules/i);
  });

  it('lo tranquiliza: el comprobante es válido y se reenvía solo', () => {
    expect(aviso.mensaje).toMatch(/válido/i);
    expect(aviso.mensaje).toMatch(/reenviando/i);
  });

  it('nombra el comprobante para que sepa cuál es', () => {
    expect(aviso.mensaje).toContain(REF);
  });

  it('el título no alarma culpando al cliente', () => {
    expect(aviso.titulo).toMatch(/SUNAT/i);
    expect(aviso.titulo).not.toMatch(/error|fall/i);
  });
});

describe('Aviso al empresario · cuando el problema sí es suyo', () => {
  it('con error de configuración sí le pide revisar sus credenciales', () => {
    const aviso = avisoFallaSunat(REF, 5, '[CONFIG] Certificado digital vencido');
    expect(aviso.esDeSunat).toBe(false);
    expect(aviso.mensaje).toMatch(/credenciales PSE/i);
    expect(aviso.mensaje).toMatch(/certificado/i);
  });

  it('con error de datos tampoco lo trata como caída de SUNAT', () => {
    const aviso = avisoFallaSunat(REF, 5, '[DATOS] El RUC del cliente no existe');
    expect(aviso.esDeSunat).toBe(false);
    expect(aviso.mensaje).not.toMatch(/no lo vuelvas a emitir/i);
  });

  it('sin mensaje de error, no se asume que SUNAT está caída', () => {
    // Ante la duda conviene el mensaje accionable, no el tranquilizador: decirle
    // "no hagas nada" cuando sí hay algo que corregir deja el comprobante sin emitir.
    expect(avisoFallaSunat(REF, 5, undefined).esDeSunat).toBe(false);
    expect(avisoFallaSunat(REF, 5, '').esDeSunat).toBe(false);
  });

  it('informa cuántos intentos se hicieron', () => {
    expect(avisoFallaSunat(REF, 7, '[CONFIG] x').mensaje).toContain('7 intentos');
  });
});
