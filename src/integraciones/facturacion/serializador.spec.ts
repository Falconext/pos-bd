/**
 * Lo que sale hacia el integrador.
 *
 * La prueba que más importa de este archivo no es ninguna traducción: es que
 * el serializador publique campo por campo y nunca el objeto entero. Un
 * `...comprobante` filtraría costos, márgenes y credenciales sin que nadie se
 * entere, y seguiría filtrando cada columna nueva que alguien agregue al
 * modelo. Por eso hay una prueba que le mete basura sensible al comprobante y
 * exige que no aparezca en la salida.
 */
import {
  nuevoIdPublico,
  numeroCompleto,
  serializarComprobante,
  serializarSunat,
} from './serializador';

const COMPROBANTE: any = {
  id: 9123,
  apiPublicId: 'inv_3xK8p2Qm',
  tipoDoc: '01',
  serie: 'F001',
  correlativo: 1234,
  estadoEnvioSunat: 'EMITIDO',
  sunatCdrResponse: JSON.stringify({ code: '0', message: 'La Factura numero F001-1234, ha sido aceptada' }),
  sunatCdrZip: 'UEsDBBQ=',
  sunatXml: '<Invoice/>',
  fechaEmision: new Date('2026-11-02T10:30:00Z'),
  tipoMoneda: 'PEN',
  tipoCambio: 1,
  mtoOperGravadas: 1000,
  mtoIGV: 180,
  mtoImpVenta: 1180,
  createdAt: new Date('2026-11-02T10:30:05Z'),
  updatedAt: new Date('2026-11-02T10:31:00Z'),
  cliente: {
    nombre: 'COMERCIAL ANDINA S.A.C.',
    nroDoc: '20601234567',
    email: 'compras@andina.pe',
    tipoDocumento: { codigo: '6' },
  },
  detalles: [
    { descripcion: 'Consultoría', cantidad: 2, unidad: 'ZZ', mtoValorUnitario: 500, igv: 180, tipAfeIgv: 10 },
  ],
};

describe('nada que no esté escrito sale', () => {
  it('ignora los campos sensibles del comprobante', () => {
    // Si alguien cambia el serializador por un spread, esta prueba se cae.
    const texto = JSON.stringify(
      serializarComprobante(
        {
          ...COMPROBANTE,
          usuarioId: 42,
          cajaId: 7,
          costoTotal: 620.5,
          margenUtilidad: 0.38,
          empresaId: 89,
          usuarioPse: 'KREZKA01',
          contrasenaPse: 'secreto-pse',
          sunatErrorMsg: 'traza interna',
        } as any,
        'iss_8Kp2Qm3x',
      ),
    );
    for (const prohibido of [
      'usuarioId', 'cajaId', 'costoTotal', 'margenUtilidad', 'empresaId',
      'usuarioPse', 'contrasenaPse', 'secreto-pse', 'sunatErrorMsg', 'traza interna',
    ]) {
      expect(texto).not.toContain(prohibido);
    }
  });

  it('el id numérico interno nunca viaja', () => {
    // Es secuencial: delataría el volumen de Krezka y dejaría sondear
    // comprobantes ajenos cambiando un dígito.
    const r = serializarComprobante(COMPROBANTE, 'iss_8Kp2Qm3x')!;
    expect(r.id).toBe('inv_3xK8p2Qm');
    expect(r.id).not.toBe(9123);
    expect(JSON.stringify(r)).not.toContain('9123');
  });
});

describe('el id público', () => {
  it('lleva prefijo y no es adivinable', () => {
    const id = nuevoIdPublico();
    expect(id).toMatch(/^inv_[A-Za-z0-9_-]{12}$/);
  });

  it('no se repite', () => {
    const muchos = new Set(Array.from({ length: 5000 }, () => nuevoIdPublico()));
    expect(muchos.size).toBe(5000);
  });

  it('acepta otro prefijo para otros objetos', () => {
    expect(nuevoIdPublico('cn')).toMatch(/^cn_/);
  });
});

describe('la forma pública', () => {
  const r = serializarComprobante(COMPROBANTE, 'iss_8Kp2Qm3x')!;

  it('traduce el tipo de documento', () => {
    expect(r.document_type).toBe('invoice');
    expect(serializarComprobante({ ...COMPROBANTE, tipoDoc: '03' }, 'i')!.document_type).toBe('receipt');
  });

  it('arma el número como figura ante SUNAT', () => {
    expect(r.full_number).toBe('F001-00001234');
    expect(numeroCompleto('B001', 7)).toBe('B001-00000007');
  });

  it('issue_date es un día, no un instante', () => {
    expect(r.issue_date).toBe('2026-11-02');
  });

  it('devuelve el emisor que se le pasó, no el id interno de la empresa', () => {
    expect(r.issuer_id).toBe('iss_8Kp2Qm3x');
  });

  it('traduce el documento del cliente al nombre público', () => {
    expect((r.customer as any).document_type).toBe('ruc');
    expect((r.customer as any).document_number).toBe('20601234567');
  });

  it('traduce la afectación de cada línea', () => {
    expect((r.items as any)[0].tax_affectation).toBe('taxed');
    expect((r.items as any)[0].unit).toBe('ZZ');
  });

  it('redondea el dinero a dos decimales', () => {
    const t = serializarComprobante(
      { ...COMPROBANTE, mtoImpVenta: 1180.00000000003, mtoIGV: 179.999999 },
      'i',
    )!.totals as any;
    expect(t.total).toBe(1180);
    expect(t.tax).toBe(180);
  });

  it('el tipo de cambio solo aparece en moneda extranjera', () => {
    expect(r.exchange_rate).toBeUndefined();
    expect(
      serializarComprobante({ ...COMPROBANTE, tipoMoneda: 'USD', tipoCambio: 3.72 }, 'i')!.exchange_rate,
    ).toBe(3.72);
  });
});

describe('las notas', () => {
  // Olvidarlas hacía que el serializador devolviera null para un 07 y la nota
  // saliera sin `id`. Solo lo vio la QA funcional; esto lo fija acá.
  it('una nota de crédito se serializa y se marca como tal', () => {
    const r = serializarComprobante({ ...COMPROBANTE, tipoDoc: '07', apiPublicId: 'cn_7Hd2Lp9q' }, 'i')!;
    expect(r).not.toBeNull();
    expect(r.id).toBe('cn_7Hd2Lp9q');
    expect(r.object).toBe('credit_note');
    expect(r.document_type).toBe('credit_note');
  });

  it('una nota de débito también', () => {
    expect(serializarComprobante({ ...COMPROBANTE, tipoDoc: '08' }, 'i')!.object).toBe('debit_note');
  });

  it('una factura sigue siendo object invoice', () => {
    expect(serializarComprobante(COMPROBANTE, 'i')!.object).toBe('invoice');
    // Y una boleta también: `object` agrupa, `document_type` distingue.
    const b = serializarComprobante({ ...COMPROBANTE, tipoDoc: '03' }, 'i')!;
    expect(b.object).toBe('invoice');
    expect(b.document_type).toBe('receipt');
  });
});

describe('lo que no es comprobante electrónico no se publica', () => {
  it('una nota de venta devuelve null', () => {
    // Confundirla con algo que tiene valor tributario sería peor que no
    // devolverla.
    expect(serializarComprobante({ ...COMPROBANTE, estadoEnvioSunat: 'NO_APLICA' }, 'i')).toBeNull();
  });

  it('un tipo de documento que la API no emite devuelve null', () => {
    expect(serializarComprobante({ ...COMPROBANTE, tipoDoc: 'NV' }, 'i')).toBeNull();
  });
});

describe('la respuesta de SUNAT', () => {
  it('expone el código y el mensaje del CDR', () => {
    const s = serializarSunat(COMPROBANTE, 'accepted');
    expect(s.response_code).toBe('0');
    expect(s.response_message).toContain('aceptada');
    expect(s.cdr_available).toBe(true);
  });

  it('no promete el CDR cuando no está', () => {
    expect(serializarSunat({ ...COMPROBANTE, sunatCdrZip: null, s3CdrUrl: null }, 'accepted').cdr_available).toBe(false);
  });

  it('en reconciling el CDR no está disponible aunque haya respuesta', () => {
    // SUNAT dice que el documento existe pero no entregó el CDR.
    const s = serializarSunat(
      { ...COMPROBANTE, estadoEnvioSunat: 'PENDIENTE_CONCILIACION', sunatCdrResponse: JSON.stringify({ code: '1033' }) },
      'reconciling',
    );
    expect(s.response_code).toBe('1033');
    expect(s.cdr_available).toBe(false);
  });

  it('aguanta un CDR que no es JSON', () => {
    const s = serializarSunat({ ...COMPROBANTE, sunatCdrResponse: 'timeout del proveedor' }, 'pending');
    expect(s.response_code).toBeUndefined();
    expect(s.cdr_available).toBe(false);
  });
});

describe('un comprobante recién creado, sin nada de SUNAT todavía', () => {
  it('se serializa igual y queda en pending', () => {
    const r = serializarComprobante(
      { ...COMPROBANTE, estadoEnvioSunat: 'PENDIENTE', sunatCdrResponse: null, sunatCdrZip: null, sunatXml: null },
      'iss_1',
    )!;
    expect(r.status).toBe('pending');
    expect((r.sunat as any).cdr_available).toBe(false);
    expect((r.files as any).xml).toBe(false);
    expect((r.files as any).pdf).toBe(true);
  });

  it('sin cliente ni detalles no revienta', () => {
    const r = serializarComprobante({ ...COMPROBANTE, cliente: null, detalles: null }, 'i')!;
    expect(r.customer).toBeUndefined();
    expect(r.items).toEqual([]);
  });
});
