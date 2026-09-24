/**
 * QA del XML que va a SUNAT cuando la guía lleva documentos relacionados
 * (cac:AdditionalDocumentReference, Catálogo 61). Es el bloque que imprime SUNAT
 * como "Documentos Relacionados" y el que pide el fiscalizador en carretera.
 *
 * Se valida el XML real (el mismo que firma QPSE), no un objeto intermedio.
 */
import { SunatGuiaService } from './sunat-guia.service';
import { buildUblXml } from '../common/utils/ubl-xml';

const service = new SunatGuiaService({} as any);

const guiaBase = (extra: Record<string, any> = {}) => ({
  tipoGuia: 'REMITENTE',
  serie: 'T001',
  correlativo: 7,
  fechaEmision: '2026-09-24',
  horaEmision: '10:30:00',
  remitenteRuc: '20609850443',
  remitenteRazonSocial: 'CORPORACION QA S.A.C.',
  remitenteDireccion: 'AV. PRINCIPAL 123',
  destinatarioTipoDoc: '1',
  destinatarioNumDoc: '10420741354',
  destinatarioRazonSocial: 'CCORAHUA HUAMAN ALEXIS',
  tipoTraslado: '01',
  modoTransporte: '02',
  pesoTotal: 5.563,
  unidadPeso: 'KGM',
  partidaUbigeo: '150142',
  partidaDireccion: 'CAL. PARCELA 3C MZ. U LOTE 18',
  llegadaUbigeo: '080601',
  llegadaDireccion: 'C.C. UCHUCCARCCO',
  fechaInicioTraslado: '2026-09-24',
  conductorTipoDoc: '1',
  conductorNumDoc: '40538989',
  conductorNombre: 'ALEJANDRO',
  conductorApellidos: 'TAMAYO CUSSI',
  conductorLicencia: 'H40538989',
  vehiculoPlaca: 'V8C859',
  detalles: [
    { codigoProducto: 'VG6', descripcion: 'CRISTAL EURO GRIS 6mm', cantidad: 25, unidadMedida: 'NIU' },
  ],
  ...extra,
});

/** Arma el XML tal cual se manda a firmar. */
const xmlDe = (guia: any, tipoDoc = '09') =>
  buildUblXml('DespatchAdvice', (service as any).buildSunatDocument(guia, tipoDoc));

describe('Guía de remisión · documentos relacionados (Catálogo 61)', () => {
  it('sin documentos relacionados el XML no lleva el bloque', () => {
    const xml = xmlDe(guiaBase());
    expect(xml).not.toContain('AdditionalDocumentReference');
  });

  it('con una factura, emite el bloque con número, Catálogo 61 y RUC del emisor', () => {
    const xml = xmlDe(
      guiaBase({
        documentosRelacionados: [
          { tipo: '01', numero: 'F001-00008055', emisorNumDoc: '20609850443' },
        ],
      }),
    );
    expect(xml).toContain('<cac:AdditionalDocumentReference>');
    expect(xml).toContain('<cbc:ID>F001-00008055</cbc:ID>');
    expect(xml).toContain('catalogo61');
    expect(xml).toContain('>01</cbc:DocumentTypeCode>');
    // La descripción legible va junto al código, como en el esquema UBL.
    expect(xml).toContain('<cbc:DocumentType>Factura</cbc:DocumentType>');
    expect(xml).toContain('<cac:IssuerParty>');
    expect(xml).toContain('>20609850443</cbc:ID>');
    // El RUC va con schemeID 6 (Catálogo 06).
    expect(xml).toMatch(/schemeID="6"[^>]*>20609850443</);
  });

  it('el bloque va después de la cabecera y antes de DespatchSupplierParty', () => {
    const xml = xmlDe(
      guiaBase({
        documentosRelacionados: [{ tipo: '01', numero: 'F001-00008055', emisorNumDoc: '20609850443' }],
      }),
    );
    const posTipoDoc = xml.indexOf('DespatchAdviceTypeCode');
    const posRelacionado = xml.indexOf('AdditionalDocumentReference');
    const posRemitente = xml.indexOf('DespatchSupplierParty');
    expect(posTipoDoc).toBeLessThan(posRelacionado);
    expect(posRelacionado).toBeLessThan(posRemitente);
  });

  it('acepta varios documentos (factura + constancia de detracción)', () => {
    const xml = xmlDe(
      guiaBase({
        documentosRelacionados: [
          { tipo: '01', numero: 'F001-00008055', emisorNumDoc: '20609850443' },
          { tipo: '80', numero: '00012345' },
        ],
      }),
    );
    expect(xml.match(/<cac:AdditionalDocumentReference>/g)).toHaveLength(2);
    expect(xml).toContain('>80</cbc:DocumentTypeCode>');
    // El de detracción va sin emisor: solo debe haber un IssuerParty.
    expect(xml.match(/<cac:IssuerParty>/g)).toHaveLength(1);
  });

  it('descarta entradas incompletas y normaliza el número a mayúsculas', () => {
    const xml = xmlDe(
      guiaBase({
        documentosRelacionados: [
          { tipo: '01', numero: 'f001-00008055', emisorNumDoc: '20609850443' },
          { tipo: '', numero: 'X' },
          { tipo: '03', numero: '   ' },
        ],
      }),
    );
    expect(xml.match(/<cac:AdditionalDocumentReference>/g)).toHaveLength(1);
    expect(xml).toContain('<cbc:ID>F001-00008055</cbc:ID>');
  });

  it('también sale en la guía de transportista (GRE-T)', () => {
    const xml = xmlDe(
      guiaBase({
        tipoGuia: 'TRANSPORTISTA',
        modoTransporte: '01',
        transportistaRuc: '20400849906',
        transportistaRazonSocial: 'TRANSPORTES QA',
        documentosRelacionados: [{ tipo: '09', numero: 'T001-00000007', emisorNumDoc: '20609850443' }],
      }),
      '31',
    );
    expect(xml).toContain('<cac:AdditionalDocumentReference>');
    expect(xml).toContain('>09</cbc:DocumentTypeCode>');
  });

  it('un valor no numérico de 11 dígitos usa schemeID 1 (DNI)', () => {
    const xml = xmlDe(
      guiaBase({
        documentosRelacionados: [{ tipo: '01', numero: 'F001-1', emisorNumDoc: '40538989' }],
      }),
    );
    expect(xml).toMatch(/schemeID="1"[^>]*>40538989</);
  });
});
