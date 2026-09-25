/**
 * QA de la representación impresa de la guía: que salgan los bloques nuevos
 * (documentos relacionados, TUCE e indicadores del traslado) y que no aparezcan
 * cuando no hay nada que mostrar.
 *
 * Se compila la MISMA plantilla .hbs que usa el generador de PDF.
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

const datosBase = (extra: Record<string, any> = {}) => ({
  ruc: '20609850443',
  razonSocial: 'CORPORACION QA S.A.C.',
  serie: 'T001',
  correlativo: '00000007',
  tituloGuia: 'GUÍA DE REMISIÓN ELECTRÓNICA - REMITENTE',
  fechaEmision: '24/09/2026',
  fechaTraslado: '24/09/2026',
  motivoTraslado: 'VENTA',
  modalidadTraslado: 'TRANSPORTE PRIVADO',
  destinatarioRazonSocial: 'CCORAHUA HUAMAN ALEXIS',
  destinatarioTipoDoc: 'DNI',
  destinatarioNumDoc: '10420741354',
  partidaDireccion: 'CAL. PARCELA 3C',
  partidaUbigeo: '150142',
  llegadaDireccion: 'C.C. UCHUCCARCCO',
  llegadaUbigeo: '080601',
  pesoTotal: '5.563',
  unidadPeso: 'KGM',
  esTransportePublico: false,
  vehiculoPlaca: 'V8C859',
  conductorNombre: 'TAMAYO CUSSI ALEJANDRO',
  conductorNumDoc: '40538989',
  conductorLicencia: 'H40538989',
  documentosRelacionados: [],
  detalles: [
    { item: 1, codigo: 'VG6', descripcion: 'CRISTAL EURO GRIS 6mm', cantidad: '25.00', unidad: 'NIU' },
  ],
  ...extra,
});

describe('PDF de la guía · documentos relacionados, TUCE e indicadores', () => {
  it('imprime el documento relacionado con su etiqueta, número y RUC', () => {
    const html = plantilla(
      datosBase({
        documentosRelacionados: [
          { etiqueta: 'Factura', numero: 'F001-00008055', emisor: '20609850443' },
        ],
      }),
    );
    expect(html).toContain('DOCUMENTOS RELACIONADOS');
    expect(html).toContain('Factura');
    expect(html).toContain('F001-00008055');
    expect(html).toContain('20609850443');
  });

  it('sin documentos relacionados no aparece el bloque', () => {
    const html = plantilla(datosBase());
    expect(html).not.toContain('DOCUMENTOS RELACIONADOS');
  });

  it('un documento sin emisor no imprime "RUC"', () => {
    const html = plantilla(
      datosBase({
        documentosRelacionados: [
          { etiqueta: 'Constancia de depósito - Detracción', numero: '00012345', emisor: '' },
        ],
      }),
    );
    expect(html).toContain('00012345');
    expect(html).not.toMatch(/RUC\s*$/m);
  });

  it('imprime el TUCE junto a la placa cuando la guía lo trae', () => {
    const html = plantilla(
      datosBase({ vehiculoAutorizacion: '15M23028581E', mostrarVehiculoConductor: true }),
    );
    expect(html).toContain('TUCE / HAB. VEH.');
    expect(html).toContain('15M23028581E');
  });

  it('sin TUCE no se imprime esa fila', () => {
    const html = plantilla(datosBase({ mostrarVehiculoConductor: true }));
    expect(html).not.toContain('TUCE / HAB. VEH.');
  });

  it('imprime solo los indicadores encendidos', () => {
    const html = plantilla(
      datosBase({
        hayIndicadores: true,
        transbordoProgramado: true,
        retornoEnvasesVacios: true,
        retornoVehiculoVacio: false,
        vehiculoM1oL: false,
      }),
    );
    expect(html).toContain('INDICADORES DEL TRASLADO');
    expect(html).toContain('TRANSBORDO PROGRAMADO');
    expect(html).toContain('RETORNO CON ENVASES VACÍOS');
    expect(html).not.toContain('RETORNO DE VEHÍCULO VACÍO');
    expect(html).not.toContain('VEHÍCULO CATEGORÍA M1 O L');
  });

  it('sin ningún indicador el bloque no sale', () => {
    const html = plantilla(datosBase({ hayIndicadores: false }));
    expect(html).not.toContain('INDICADORES DEL TRASLADO');
  });
});
