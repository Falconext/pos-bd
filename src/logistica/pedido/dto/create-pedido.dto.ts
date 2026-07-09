import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum OrigenPedidoLogistica {
  MANUAL = 'MANUAL',
  EXCEL = 'EXCEL',
  API = 'API',
  WEBHOOK = 'WEBHOOK',
  ECOMMERCE = 'ECOMMERCE',
  FALCONEXT_ERP = 'FALCONEXT_ERP',
}

export class CreateItemPedidoLogisticaDto {
  @IsOptional()
  @IsString()
  sku?: string;

  @IsString()
  descripcion: string;

  @IsInt()
  @Type(() => Number)
  cantidad: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  pesoUnitarioKg?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  volumenUnitarioM3?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  valorDeclarado?: number;
}

export class CreatePedidoLogisticaDto {
  @IsInt()
  @Type(() => Number)
  clienteId: number;

  @IsInt()
  @Type(() => Number)
  direccionEntregaId: number;

  @IsOptional()
  @IsString()
  nroOrdenExterna?: string;

  @IsOptional()
  @IsString()
  fechaSolicitada?: string; // ISO string

  @IsOptional()
  @IsString()
  ventanaInicio?: string;

  @IsOptional()
  @IsString()
  ventanaFin?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  prioridad?: number;

  @IsOptional()
  @IsBoolean()
  esUrgente?: boolean;

  @IsOptional()
  @IsBoolean()
  requiereFirma?: boolean;

  @IsOptional()
  @IsBoolean()
  requiereFoto?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  cobroContraEntrega?: number;

  @IsOptional()
  @IsString()
  notasCliente?: string;

  @IsOptional()
  @IsString()
  notasInternas?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateItemPedidoLogisticaDto)
  items: CreateItemPedidoLogisticaDto[];
}
