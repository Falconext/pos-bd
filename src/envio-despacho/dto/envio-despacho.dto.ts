import { IsString, IsOptional, IsEnum, IsDateString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum EstadoDespacho {
    PREPARANDO = 'PREPARANDO',
    EN_CAMINO = 'EN_CAMINO',
    EN_DESTINO = 'EN_DESTINO',
    ENTREGADO = 'ENTREGADO',
    DEVUELTO = 'DEVUELTO',
}

export enum TipoEnvio {
    AGENCIA = 'AGENCIA',
    DOMICILIO = 'DOMICILIO',
}

export enum TurnoEnvio {
    MANANA = 'MANANA',
    TARDE = 'TARDE',
    NOCHE = 'NOCHE',
}

export class CreateEnvioDespachoDto {
    @IsOptional() @IsString() transportista?: string;
    @IsOptional() @IsString() codigoGuia?: string;
    @IsOptional() @IsEnum(EstadoDespacho) estado?: EstadoDespacho;
    @IsOptional() @IsString() observaciones?: string;
    @IsOptional() @IsString() direccionDestino?: string;
    @IsOptional() @IsDateString() fechaEstimada?: string;
    // Coordinación de envío nacional
    @IsOptional() @IsEnum(TipoEnvio) tipoEnvio?: TipoEnvio;
    @IsOptional() @IsString() agenciaDestino?: string;
    @IsOptional() @IsString() celularDest?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) nroPaquetes?: number;
    @IsOptional() @IsEnum(TurnoEnvio) turnoEnvio?: TurnoEnvio;
    @IsOptional() @IsString() tipoMercaderia?: string;
    @IsOptional() @IsString() claveEnvio?: string;
    @IsOptional() @IsString() nroOrden?: string;
    @IsOptional() @IsString() claveOrden?: string;
    @IsOptional() @IsString() establecimiento?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) repartidorId?: number;
    // Compatibilidad temporal: si llega texto libre, el backend crea/asigna el repartidor EVENTUAL.
    @IsOptional() @IsString() repartidor?: string;
    @IsOptional() @IsString() empaquetador?: string;
}

export class UpdateEnvioDespachoDto extends CreateEnvioDespachoDto {}
