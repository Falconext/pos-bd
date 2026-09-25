/**
 * QA del bloque 2 de la guía: fecha de entrega al transportista, vehículos y
 * conductores secundarios, autorización especial del vehículo y códigos del
 * ítem. Se valida el XML real que se firma y se manda a SUNAT.
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
  remitenteRuc: '20602479693',
  remitenteRazonSocial: 'COMERCIAL QA S.A.C.',
  remitenteDireccion: 'AV. PRINCIPAL 123',
  destinatarioTipoDoc: '6',
  destinatarioNumDoc: '20170040938',
  destinatarioRazonSocial: 'CONSTRUCTORA QA S.A.C.',
  tipoTraslado: '01',
  modoTransporte: '02',
  pesoTotal: 850,
  unidadPeso: 'KGM',
  partidaUbigeo: '150125',
  partidaDireccion: 'AV. PARTIDA 1',
  llegadaUbigeo: '150101',
  llegadaDireccion: 'AV. LLEGADA 2',
  fechaInicioTraslado: '2026-09-24',
  conductorTipoDoc: '1',
  conductorNumDoc: '40538989',
  conductorNombre: 'ALEJANDRO',
  conductorApellidos: 'TAMAYO CUSSI',
  conductorLicencia: 'H40538989',
  vehiculoPlaca: 'V8C859',
  detalles: [
    { codigoProducto: 'CEM-01', descripcion: 'CEMENTO PORTLAND', cantidad: 20, unidadMedida: 'NIU' },
  ],
  ...extra,
});

const xmlDe = (guia: any, tipoDoc = '09') =>
  buildUblXml('DespatchAdvice', (service as any).buildSunatDocument(guia, tipoDoc));

describe('Guía de remisión · bloque 2', () => {
  // ── 1. Fecha de entrega de los bienes al transportista ───────────────────
  it('la fecha de entrega al transportista va en LoadingTransportEvent, separada del inicio de traslado', () => {
    const xml = xmlDe(
      guiaBase({ fechaInicioTraslado: '2026-09-24', fechaEntregaBienes: '2026-09-23' }),
    );
    // TransitPeriod = inicio de traslado; LoadingTransportEvent = entrega.
    expect(xml).toMatch(/<cac:TransitPeriod><cbc:StartDate>2026-09-24</);
    expect(xml).toMatch(/<cac:LoadingTransportEvent><cbc:OccurrenceDate>2026-09-23</);
  });

  it('sin fecha de entrega se mantiene la de inicio de traslado (compatibilidad)', () => {
    const xml = xmlDe(guiaBase());
    expect(xml).toMatch(/<cac:LoadingTransportEvent><cbc:OccurrenceDate>2026-09-24</);
  });

  // ── 2. Vehículos secundarios ─────────────────────────────────────────────
  it('los vehículos secundarios salen como AttachedTransportEquipment con su TUCE', () => {
    const xml = xmlDe(
      guiaBase({
        vehiculosSecundarios: [
          { placa: 'a2b985', tuce: '0042000686' },
          { placa: 'C3D111' },
        ],
      }),
    );
    expect(xml.match(/<cac:AttachedTransportEquipment>/g)).toHaveLength(2);
    // La placa se normaliza a mayúsculas.
    expect(xml).toContain('<cbc:ID>A2B985</cbc:ID>');
    expect(xml).toContain('<cbc:RegistrationNationalityID>0042000686</cbc:RegistrationNationalityID>');
    // El que no trae TUCE no emite el nodo.
    expect(xml.match(/<cbc:RegistrationNationalityID>/g)).toHaveLength(1);
  });

  it('sin vehículos secundarios no aparece el nodo', () => {
    const xml = xmlDe(guiaBase());
    expect(xml).not.toContain('AttachedTransportEquipment');
  });

  // ── 3. Conductores secundarios ───────────────────────────────────────────
  it('los conductores secundarios se distinguen del principal por JobTitle', () => {
    const xml = xmlDe(
      guiaBase({
        conductoresSecundarios: [
          { tipoDoc: '1', numDoc: '10101010', nombres: 'JUAN', apellidos: 'PEREZ LOPEZ', licencia: 'q10101010' },
        ],
      }),
    );
    expect(xml.match(/<cac:DriverPerson>/g)).toHaveLength(2);
    expect(xml).toContain('<cbc:JobTitle>Principal</cbc:JobTitle>');
    expect(xml).toContain('<cbc:JobTitle>Secundario</cbc:JobTitle>');
    expect(xml).toContain('<cbc:FamilyName>PEREZ LOPEZ</cbc:FamilyName>');
    expect(xml).toContain('<cbc:ID>Q10101010</cbc:ID>');
  });

  it('descarta conductores secundarios sin documento o sin licencia', () => {
    const xml = xmlDe(
      guiaBase({
        conductoresSecundarios: [
          { numDoc: '10101010', licencia: 'Q1' },
          { numDoc: '', licencia: 'Q2' },
          { numDoc: '20202020', licencia: '' },
        ],
      }),
    );
    expect(xml.match(/<cac:DriverPerson>/g)).toHaveLength(2); // principal + 1 válido
  });

  // ── 4. Autorización especial del vehículo ────────────────────────────────
  it('la autorización especial va con la entidad emisora como schemeID', () => {
    const xml = xmlDe(
      guiaBase({ vehiculoNroAutorizacion: 'AUT-12345', vehiculoEntidadEmisora: '01' }),
    );
    expect(xml).toContain('<cac:ShipmentDocumentReference>');
    expect(xml).toMatch(/schemeID="01"[^>]*schemeName="Entidad Autorizadora"/);
    expect(xml).toContain('>AUT-12345</cbc:ID>');
  });

  it('sin número de autorización no se emite el bloque aunque haya entidad emisora', () => {
    const xml = xmlDe(guiaBase({ vehiculoEntidadEmisora: '01' }));
    expect(xml).not.toContain('ShipmentDocumentReference');
  });

  // ── 5. Códigos del ítem ──────────────────────────────────────────────────
  it('el código del bien viaja en SellersItemIdentification', () => {
    const xml = xmlDe(guiaBase());
    expect(xml).toContain('<cac:SellersItemIdentification><cbc:ID>CEM-01</cbc:ID></cac:SellersItemIdentification>');
  });

  it('el código de producto SUNAT viaja como CommodityClassification con listID UNSPSC', () => {
    const xml = xmlDe(
      guiaBase({
        detalles: [
          { codigoProducto: 'CEM-01', codigoProductoSunat: '30111500', descripcion: 'CEMENTO', cantidad: 5, unidadMedida: 'NIU' },
        ],
      }),
    );
    expect(xml).toContain('<cac:CommodityClassification>');
    expect(xml).toMatch(/listID="UNSPSC"[^>]*>30111500</);
  });

  it('un ítem sin código SUNAT no emite CommodityClassification', () => {
    const xml = xmlDe(guiaBase());
    expect(xml).not.toContain('CommodityClassification');
  });

  // ── Todo junto, también en GRE-T ─────────────────────────────────────────
  it('en la guía de transportista salen secundarios, autorización y códigos', () => {
    const xml = xmlDe(
      guiaBase({
        tipoGuia: 'TRANSPORTISTA',
        modoTransporte: '01',
        transportistaRuc: '20400849906',
        transportistaRazonSocial: 'TRANSPORTES QA',
        vehiculoAutorizacion: '15M23028581E',
        vehiculoNroAutorizacion: 'AUT-999',
        vehiculoEntidadEmisora: '01',
        vehiculosSecundarios: [{ placa: 'A2B985', tuce: '0042000686' }],
        conductoresSecundarios: [{ numDoc: '10101010', nombres: 'JUAN', apellidos: 'PEREZ', licencia: 'Q1' }],
        fechaEntregaBienes: '2026-09-23',
        detalles: [
          { codigoProducto: 'CEM-01', codigoProductoSunat: '30111500', descripcion: 'CEMENTO', cantidad: 5, unidadMedida: 'NIU' },
        ],
      }),
      '31',
    );
    expect(xml).toContain('AttachedTransportEquipment');
    expect(xml).toContain('<cbc:JobTitle>Secundario</cbc:JobTitle>');
    expect(xml).toContain('>AUT-999</cbc:ID>');
    expect(xml).toContain('<cac:SellersItemIdentification>');
    expect(xml).toMatch(/<cac:LoadingTransportEvent><cbc:OccurrenceDate>2026-09-23</);
  });
});

/**
 * El RUC del punto de llegada no puede ser el del remitente cuando el
 * destinatario es persona natural: SUNAT lo rechaza con 3411. Arreglo traído
 * desde vendify-api, donde ya estaba resuelto.
 */
describe('Guía de remisión · punto de llegada con destinatario sin RUC (3411)', () => {
  const conDni = (extra: Record<string, any> = {}) =>
    guiaBase({ destinatarioTipoDoc: '1', destinatarioNumDoc: '40420741', ...extra });

  it('con destinatario DNI NO se manda el RUC del remitente en el punto de llegada', () => {
    const xml = xmlDe(conDni());
    // Antes salía <cbc:AddressTypeCode listID="20602479693"> en la llegada.
    const llegada = xml.slice(xml.indexOf('<cac:DeliveryAddress>'), xml.indexOf('</cac:DeliveryAddress>'));
    expect(llegada).not.toContain('AddressTypeCode');
  });

  it('el punto de partida sí conserva el RUC del remitente', () => {
    const xml = xmlDe(conDni());
    const partida = xml.slice(xml.indexOf('<cac:DespatchAddress>'), xml.indexOf('</cac:DespatchAddress>'));
    expect(partida).toMatch(/listID="20602479693"/);
  });

  it('con destinatario RUC el punto de llegada lleva ese RUC, no el del remitente', () => {
    const xml = xmlDe(guiaBase());
    const llegada = xml.slice(xml.indexOf('<cac:DeliveryAddress>'), xml.indexOf('</cac:DeliveryAddress>'));
    expect(llegada).toMatch(/listID="20170040938"/);
  });

  it('traslado entre establecimientos de la misma empresa (motivo 04) usa el RUC del remitente en ambos puntos', () => {
    const xml = xmlDe(guiaBase({ tipoTraslado: '04' }));
    const llegada = xml.slice(xml.indexOf('<cac:DeliveryAddress>'), xml.indexOf('</cac:DeliveryAddress>'));
    expect(llegada).toMatch(/listID="20602479693"/);
  });
});
