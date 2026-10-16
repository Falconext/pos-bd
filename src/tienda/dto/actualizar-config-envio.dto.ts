import {
  IsBoolean,
  IsDecimal,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ActualizarConfigEnvioDto {
  @IsOptional()
  @IsDecimal()
  @Type(() => Number)
  costoEnvioFijo?: number;

  @IsOptional()
  @IsBoolean()
  aceptaRecojo?: boolean;

  /**
   * Aceptar pedidos de productos agotados. El negocio que trabaja por encargo
   * prefiere recibir el pedido y luego traer el producto, antes que perder la
   * venta por un stock en cero.
   */
  @IsOptional()
  @IsBoolean()
  tiendaVentaSinStock?: boolean;


  @IsOptional()
  @IsBoolean()
  aceptaEnvio?: boolean;

  @IsOptional()
  @IsString()
  direccionRecojo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  tiempoPreparacionMin?: number;

  @IsOptional()
  @IsDecimal()
  @Type(() => Number)
  envioGratisDesdeSoles?: number;

  @IsOptional()
  @IsDecimal()
  @Type(() => Number)
  minimoCompra?: number;
}
