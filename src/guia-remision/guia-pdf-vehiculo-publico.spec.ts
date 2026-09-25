/**
 * QA de la representación impresa cuando el traslado es PÚBLICO: la primera
 * columna la ocupa el transportista, así que el vehículo y el conductor deben
 * salir en una columna aparte. Antes eso solo pasaba en la guía de
 * transportista y una GRE-Remitente escondía placa, TUCE y chofer.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

const plantilla = Handlebars.compile(
  fs.readFileSync(
    path.join(__dirname, '../comprobante/templates/guia-remision.hbs'),
    'utf8',
  ),
);

const datos = (extra: Record<string, any> = {}) => ({
  ruc: '20602479693',
  razonSocial: 'FERRETERA QA S.A.C.',
  serie: 'T001',
  correlativo: '00000030',
  tituloGuia: 'GUÍA DE REMISIÓN ELECTRÓNICA - REMITENTE',
  fechaEmision: '24/09/2026',
  fechaTraslado: '24/09/2026',
  motivoTraslado: 'VENTA',
  modalidadTraslado: 'TRANSPORTE PÚBLICO',
  destinatarioRazonSocial: 'CONSTRUCTORA QA',
  destinatarioTipoDoc: 'RUC',
  destinatarioNumDoc: '20170040938',
  partidaDireccion: 'A', partidaUbigeo: '150142',
  llegadaDireccion: 'B', llegadaUbigeo: '080601',
  pesoTotal: '5563', unidadPeso: 'KGM',
  esTransportePublico: true,
  transportistaRazonSocial: 'MOROCCO MAMANI TRANSPORTES S.A.C.',
  transportistaRuc: '20400849906',
  transportistaMTC: '1598621CNG',
  vehiculoPlaca: 'V8C859',
  vehiculoAutorizacion: '15M23028581E',
  conductorNombre: 'TAMAYO CUSSI ALEJANDRO',
  conductorNumDoc: '40538989',
  conductorLicencia: 'H40538989',
  vehiculosSecundarios: [{ orden: 1, placa: 'A2B985', tuce: '0042000686' }],
  conductoresSecundarios: [],
  documentosRelacionados: [],
  detalles: [{ item: 1, codigo: 'VG6', descripcion: 'CRISTAL', cantidad: '25', unidad: 'NIU' }],
  ...extra,
});

describe('PDF de la guía · vehículo y conductor en transporte público', () => {
  it('con transporte público imprime el transportista Y el vehículo con su conductor', () => {
    const html = plantilla(datos({ mostrarVehiculoConductor: true }));
    expect(html).toContain('>TRANSPORTISTA<');
    expect(html).toContain('MOROCCO MAMANI TRANSPORTES S.A.C.');
    expect(html).toContain('1598621CNG');
    // Lo que antes se perdía:
    expect(html).toContain('V8C859');
    expect(html).toContain('15M23028581E');
    expect(html).toContain('TAMAYO CUSSI ALEJANDRO');
    expect(html).toContain('H40538989');
    expect(html).toContain('A2B985');
  });

  it('sin vehículo ni conductor no se abre la columna extra', () => {
    const html = plantilla(
      datos({ mostrarVehiculoConductor: false, vehiculoPlaca: '', conductorNombre: '', vehiculosSecundarios: [] }),
    );
    expect(html).toContain('MOROCCO MAMANI TRANSPORTES S.A.C.');
    expect(html).not.toContain('V8C859');
  });

  it('en transporte privado el vehículo también sale, sin duplicarse', () => {
    const html = plantilla(
      datos({
        esTransportePublico: false,
        mostrarVehiculoConductor: true,
        modalidadTraslado: 'TRANSPORTE PRIVADO',
      }),
    );
    expect(html).toContain('>VEHÍCULO<');
    expect(html).toContain('>CONDUCTOR<');
    // La placa aparece una sola vez.
    expect(html.match(/V8C859/g)).toHaveLength(1);
    // Sin transporte público no hay recuadro de transportista.
    expect(html).not.toContain('>TRANSPORTISTA<');
  });

  it('vehículo y conductor van en columnas separadas, no apilados', () => {
    const html = plantilla(datos({ mostrarVehiculoConductor: true }));
    const posVehiculo = html.indexOf('>VEHÍCULO<');
    const posConductor = html.indexOf('>CONDUCTOR<');
    expect(posVehiculo).toBeGreaterThan(-1);
    expect(posConductor).toBeGreaterThan(posVehiculo);
    // La columna del conductor lleva el divisor que la separa de la del vehículo.
    expect(html.slice(posVehiculo, posConductor)).toContain('with-divider');
  });
});
