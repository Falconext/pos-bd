import { IsNotEmpty, IsInt, IsNumber, IsString, IsOptional, Min, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TrasladoItemDto {
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  productoId: number;

  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  cantidad: number;

  @IsOptional()
  @IsString()
  lote?: string;
}

export class TrasladoKardexDto {
  @IsNotEmpty()
  @IsInt()
  sedeOrigenId: number;

  @IsNotEmpty()
  @IsInt()
  sedeDestinoId: number;

  @IsOptional()
  @IsString()
  observacion?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrasladoItemDto)
  items: TrasladoItemDto[];
}
