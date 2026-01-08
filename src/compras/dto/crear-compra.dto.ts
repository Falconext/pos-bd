import { IsNotEmpty, IsString, IsNumber, IsOptional, IsArray, ValidateNested, IsDateString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

class DetalleCompraDto {
    @IsOptional()
    @IsNumber()
    productoId?: number;

    @IsString()
    descripcion: string;

    @IsNumber()
    cantidad: number;

    @IsNumber()
    precioUnitario: number;

    @IsOptional()
    @IsString()
    lote?: string;

    @IsOptional()
    @IsDateString()
    fechaVencimiento?: string;
}

export class CrearCompraDto {
    @IsNumber()
    proveedorId: number;

    @IsString()
    tipoDoc: string;

    @IsString()
    serie: string;

    @IsString()
    numero: string;

    @IsDateString()
    fechaEmision: string;

    @IsOptional()
    @IsDateString()
    fechaVencimiento?: string;

    @IsString()
    moneda: string;

    @IsOptional()
    @IsNumber()
    tipoCambio?: number;

    @IsOptional()
    @IsString()
    observaciones?: string;

    @IsOptional()
    @IsNumber()
    igv?: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DetalleCompraDto)
    detalles: DetalleCompraDto[];

    @IsOptional()
    @IsNumber()
    montoPagadoInicial?: number;

    @IsOptional()
    @IsString()
    metodoPagoInicial?: string;

    @IsOptional()
    @IsString()
    formaPago?: string; // CONTADO o CREDITO

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CuotaCompraDto)
    cuotas?: CuotaCompraDto[];
}

export class CuotaCompraDto {
    @IsNumber()
    monto: number;

    @IsDateString()
    fechaVencimiento: string;
}
