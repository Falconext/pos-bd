import { Type } from 'class-transformer';
import {
    IsString,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsBoolean,
    IsDateString,
    IsArray,
    ValidateNested,
    Min,
    IsDecimal,
    IsEnum,
} from 'class-validator';

export enum TipoGuiaRemision {
    REMITENTE = 'REMITENTE',
    TRANSPORTISTA = 'TRANSPORTISTA',
}

export class CreateDetalleGuiaDto {
    @IsOptional()
    @IsNumber()
    productoId?: number;

    @IsString()
    @IsNotEmpty()
    codigoProducto: string;

    @IsString()
    @IsNotEmpty()
    descripcion: string;

    @IsNumber()
    @Min(0.01)
    cantidad: number;

    @IsOptional()
    @IsString()
    unidadMedida?: string = 'NIU';
}

export class CreateGuiaRemisionDto {
    @IsEnum(TipoGuiaRemision)
    @IsOptional()
    tipoGuia?: TipoGuiaRemision = TipoGuiaRemision.REMITENTE;

    @IsString()
    @IsNotEmpty()
    serie: string;

    @IsOptional()
    @IsNumber()
    correlativo?: number;

    @IsDateString()
    fechaEmision: string;

    @IsOptional()
    @IsString()
    horaEmision?: string;

    // Remitente
    @IsString()
    @IsNotEmpty()
    remitenteRuc: string;

    @IsString()
    @IsNotEmpty()
    remitenteRazonSocial: string;

    @IsString()
    @IsNotEmpty()
    remitenteDireccion: string;

    // Destinatario
    @IsString()
    @IsNotEmpty()
    destinatarioTipoDoc: string;

    @IsString()
    @IsNotEmpty()
    destinatarioNumDoc: string;

    @IsString()
    @IsNotEmpty()
    destinatarioRazonSocial: string;

    @IsOptional()
    @IsNumber()
    clienteId?: number;

    // Shipment
    @IsString()
    @IsNotEmpty()
    tipoTraslado: string;

    @IsString()
    @IsNotEmpty()
    modoTransporte: string;

    @IsNumber()
    @Min(0.01)
    pesoTotal: number;

    @IsOptional()
    @IsString()
    unidadPeso?: string = 'KGM';

    // Transportista (condicional para transporte público)
    @IsOptional()
    @IsString()
    transportistaRuc?: string;

    @IsOptional()
    @IsString()
    transportistaRazonSocial?: string;

    @IsOptional()
    @IsString()
    transportistaMTC?: string;

    // Para GRE-T: RUC/razón social del remitente real de los bienes
    // (la empresa que envía la carga, diferente al transportista)
    @IsOptional()
    @IsString()
    greTRemitenteNumDoc?: string;

    @IsOptional()
    @IsString()
    greTRemitenteRazonSocial?: string;

    // Conductor/Vehículo (condicional para transporte privado)
    @IsOptional()
    @IsString()
    conductorTipoDoc?: string;

    @IsOptional()
    @IsString()
    conductorNumDoc?: string;

    @IsOptional()
    @IsString()
    conductorNombre?: string;

    @IsOptional()
    @IsString()
    conductorApellidos?: string;

    @IsOptional()
    @IsString()
    conductorLicencia?: string;

    @IsOptional()
    @IsString()
    vehiculoPlaca?: string;

    @IsOptional()
    @IsString()
    vehiculoAutorizacion?: string;

    // Punto de partida
    @IsString()
    @IsNotEmpty()
    partidaUbigeo: string;

    @IsString()
    @IsNotEmpty()
    partidaDireccion: string;

    @IsOptional()
    @IsString()
    partidaCodigoEstablecimiento?: string;

    // Punto de llegada
    @IsString()
    @IsNotEmpty()
    llegadaUbigeo: string;

    @IsString()
    @IsNotEmpty()
    llegadaDireccion: string;

    @IsOptional()
    @IsString()
    llegadaCodigoEstablecimiento?: string;

    // Fecha de traslado
    @IsDateString()
    fechaInicioTraslado: string;

    // Flags opcionales
    @IsOptional()
    @IsBoolean()
    retornoVehiculoVacio?: boolean = false;

    @IsOptional()
    @IsBoolean()
    retornoEnvasesVacios?: boolean = false;

    @IsOptional()
    @IsBoolean()
    transbordoProgramado?: boolean = false;

    @IsOptional()
    @IsBoolean()
    trasladoTotal?: boolean = false;

    @IsOptional()
    @IsBoolean()
    vehiculoM1oL?: boolean = false;

    @IsOptional()
    @IsBoolean()
    datosTransportista?: boolean = false;

    // Observaciones
    @IsOptional()
    @IsString()
    observaciones?: string;

    // Detalles
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateDetalleGuiaDto)
    detalles: CreateDetalleGuiaDto[];
}
