import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateGuiaRemisionDto } from './create-guia-remision.dto';

/**
 * Regresión de un caso real: una guía se rechazaba con
 *   ["fechaEntregaBienes must be a valid ISO 8601 date string"]
 * porque el formulario manda "" cuando el usuario deja vacío ese campo
 * OPCIONAL, y `@IsOptional()` solo perdona `undefined`/`null`.
 */
const payloadBase = (): Record<string, any> => ({
  tipoGuia: 'REMITENTE',
  serie: 'T001',
  correlativo: 0,
  fechaEmision: '2026-09-25',
  horaEmision: '15:32:53',
  tipoTraslado: '01',
  modoTransporte: '01',
  clienteId: 1056,
  remitenteRuc: '20611096977',
  remitenteRazonSocial: 'EQUIPOS & MAQUINARIAS L & N E.I.R.L.',
  remitenteDireccion: 'AV. REPUBLICA DE ARGENTINA NRO. 339',
  destinatarioTipoDoc: '6',
  destinatarioNumDoc: '20615627420',
  destinatarioRazonSocial: "AGROCARL' S S.R.L.",
  partidaUbigeo: '010202',
  partidaDireccion: 'AV. REPUBLICA DE ARGENTINA NRO. 339',
  llegadaUbigeo: '220804',
  llegadaDireccion: 'JR. SAN LUIS NRO. C5',
  pesoTotal: 55,
  unidadPeso: 'KGM',
  fechaInicioTraslado: '2026-09-25',
  documentosRelacionados: [
    { tipo: '01', numero: 'F0A1-00000118', emisorNumDoc: '20611096977' },
  ],
  detalles: [
    {
      codigoProducto: 'S/C-1',
      descripcion: 'Compresora 3hp 2piston 80g',
      cantidad: 1,
      unidadMedida: 'NIU',
    },
  ],
});

const validar = (payload: Record<string, any>) => {
  const dto = plainToInstance(CreateGuiaRemisionDto, payload);
  const errores = validateSync(dto as any, { whitelist: true });
  return {
    dto: dto as any,
    mensajes: errores.flatMap((e) => Object.values(e.constraints || {})),
  };
};

describe('CreateGuiaRemisionDto — fechas opcionales vacías', () => {
  it('acepta el payload real que el formulario envía con fechaEntregaBienes: ""', () => {
    const { mensajes } = validar({ ...payloadBase(), fechaEntregaBienes: '' });
    expect(mensajes).toEqual([]);
  });

  it('normaliza la cadena vacía a undefined en vez de guardarla', () => {
    const { dto } = validar({ ...payloadBase(), fechaEntregaBienes: '' });
    expect(dto.fechaEntregaBienes).toBeUndefined();
  });

  it('trata una cadena de solo espacios igual que vacía', () => {
    const { mensajes, dto } = validar({
      ...payloadBase(),
      fechaEntregaBienes: '   ',
    });
    expect(mensajes).toEqual([]);
    expect(dto.fechaEntregaBienes).toBeUndefined();
  });

  it('acepta el campo omitido por completo', () => {
    const { mensajes } = validar(payloadBase());
    expect(mensajes).toEqual([]);
  });

  it('conserva una fecha válida', () => {
    const { mensajes, dto } = validar({
      ...payloadBase(),
      fechaEntregaBienes: '2026-09-26',
    });
    expect(mensajes).toEqual([]);
    expect(dto.fechaEntregaBienes).toBe('2026-09-26');
  });

  it('sigue rechazando una fecha con formato inválido', () => {
    const { mensajes } = validar({
      ...payloadBase(),
      fechaEntregaBienes: 'no-es-una-fecha',
    });
    expect(mensajes.join(' ')).toContain('fechaEntregaBienes');
  });
});
