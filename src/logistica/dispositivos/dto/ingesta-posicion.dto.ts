import { IsString, IsOptional, IsNumber, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class IngestaPosicionDto {
  @IsString()
  token: string;

  @Type(() => Number)
  @IsNumber()
  lat: number;

  @Type(() => Number)
  @IsNumber()
  lng: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  velocidad?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rumbo?: number;
}
