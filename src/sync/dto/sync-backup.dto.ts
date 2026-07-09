import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EmpresaSyncDto {
  @IsOptional()
  @IsString()
  ruc?: string;

  @IsNotEmpty()
  @IsString()
  nombreComercial: string;

  @IsOptional()
  @IsString()
  telefono?: string;
}

export class ProductoSyncDto {
  @IsNumber()
  localId: number;

  @IsOptional()
  @IsNumber()
  remoteId?: number;

  @IsNotEmpty()
  @IsString()
  nombre: string;

  @IsNumber()
  precio: number;

  @IsNumber()
  stock: number;

  @IsOptional()
  @IsString()
  createdAt?: string;

  @IsOptional()
  @IsString()
  syncStatus?: string;
}

export class ClienteSyncDto {
  @IsNumber()
  localId: number;

  @IsOptional()
  @IsNumber()
  remoteId?: number;

  @IsNotEmpty()
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  nota?: string;

  @IsOptional()
  @IsString()
  createdAt?: string;

  @IsOptional()
  @IsString()
  syncStatus?: string;
}

export class VentaDetalleSyncDto {
  @IsNumber()
  localId: number;

  @IsNumber()
  productoLocalId: number;

  @IsOptional()
  @IsNumber()
  productoRemoteId?: number;

  @IsNumber()
  cantidad: number;

  @IsNumber()
  precioUnitario: number;

  @IsNumber()
  subtotal: number;
}

export class VentaSyncDto {
  @IsNumber()
  localId: number;

  @IsOptional()
  @IsNumber()
  remoteId?: number;

  @IsNotEmpty()
  @IsString()
  fecha: string;

  @IsNumber()
  total: number;

  @IsOptional()
  @IsNumber()
  clienteLocalId?: number;

  @IsOptional()
  @IsNumber()
  clienteRemoteId?: number;

  @IsNotEmpty()
  @IsString()
  tipoDoc: string;

  @IsNotEmpty()
  @IsString()
  serie: string;

  @IsNumber()
  correlativo: number;

  @IsOptional()
  @IsString()
  estadoPago?: string;

  @IsOptional()
  @IsString()
  estadoOT?: string;

  @IsOptional()
  @IsNumber()
  adelanto?: number;

  @IsOptional()
  @IsNumber()
  saldo?: number;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  medioPago?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VentaDetalleSyncDto)
  detalles: VentaDetalleSyncDto[];

  @IsOptional()
  @IsString()
  syncStatus?: string;

  @IsOptional()
  @IsString()
  updatedAt?: string;
}

export class SyncBackupDto {
  @IsNotEmpty()
  @IsString()
  version: string;

  @IsNotEmpty()
  @IsString()
  timestamp: string;

  @ValidateNested()
  @Type(() => EmpresaSyncDto)
  empresa: EmpresaSyncDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductoSyncDto)
  productos: ProductoSyncDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClienteSyncDto)
  clientes: ClienteSyncDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VentaSyncDto)
  ventas: VentaSyncDto[];
}
