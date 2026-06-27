import { SunatGuiaService } from './src/guia-remision/sunat-guia.service';
const service = new (SunatGuiaService as any)();
const xml = service.buildUblXml('DespatchAdvice', service.buildSunatDocument({
  id: 71,
  serie: 'T001',
  correlativo: 123,
  fechaEmision: new Date(),
  horaEmision: '10:00:00',
  tipoDocumentoRemitente: '6',
  remitenteRuc: '20123456789',
  remitenteRazonSocial: 'EMP',
  tipoTraslado: '01',
  motivoTrasladoDescripcion: 'Venta',
  unidadPeso: 'KGM',
  pesoTotal: 10,
  modoTransporte: '01',
  fechaInicioTraslado: new Date(),
  partidaUbigeo: '150101',
  partidaDireccion: 'Lima',
  llegadaUbigeo: '150101',
  llegadaDireccion: 'Lima',
  destinatarioTipoDocumento: '6',
  destinatarioNumeroDocumento: '20123456789',
  destinatarioRazonSocial: 'DEST',
  transportistaRuc: '20987654321',
  transportistaRazonSocial: 'TRANS',
  items: [
    { codigo: 'P01', descripcion: 'Prod', cantidad: 1, unidadMedida: 'NIU' }
  ]
}));
console.log(xml);
