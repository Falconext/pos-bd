import { formasDePagoParaElAviso, textoParaPlantilla } from './pago-repartidor';

describe('formas de pago según quién reparte (Hierba Sana 24-10)', () => {
  const cfg = {
    pagoRepartidorPropio: 'efectivo, Yape 955 947 892, transferencia o ZIPAGO (HIERBASANA) desde tu banca móvil',
    pagoRepartidorContratado: 'Yape 955 947 892, transferencia o ZIPAGO a nombre de Hierba Sana. No en efectivo ni al Yape del repartidor',
  };

  it('del equipo: todo; contratado: sin efectivo', () => {
    expect(formasDePagoParaElAviso('PLANILLA', cfg)).toMatch(/^efectivo/);
    expect(formasDePagoParaElAviso('EVENTUAL', cfg)).toMatch(/No en efectivo/);
  });

  it('sin repartidor o sin texto configurado, nada', () => {
    expect(formasDePagoParaElAviso(null, cfg)).toBeNull();
    expect(formasDePagoParaElAviso('EVENTUAL', { pagoRepartidorPropio: 'x' })).toBeNull();
    expect(formasDePagoParaElAviso('PLANILLA', null)).toBeNull();
  });

  it('apto para variable de WhatsApp: sin saltos ni espacios de más', () => {
    expect(textoParaPlantilla('Yape 955947892\nZIPAGO\t  HIERBASANA     ')).toBe('Yape 955947892 · ZIPAGO · HIERBASANA');
  });
});
