import { IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class CrearPagoDto {
  @IsNumber()
  @Min(0.01)
  monto: number;

  @IsString()
  medioPago: string;

  @IsOptional()
  @IsString()
  observacion?: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsNumber()
  cuentaBancariaId?: number;
}
