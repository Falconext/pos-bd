import { IsNumber, IsString, IsOptional, Min, IsIn } from 'class-validator';

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

  // A quién fue dirigido el pago. Obligatorio en el registro manual (validado en el front),
  // opcional a nivel API para no romper integraciones existentes (móvil/sync).
  @IsOptional()
  @IsIn(['ADMINISTRADOR', 'EMPRESA', 'VENDEDOR'])
  dirigidoA?: string;

  // Vendedor a cuya cuenta llegó el dinero (cuando dirigidoA = VENDEDOR).
  @IsOptional()
  @IsNumber()
  vendedorId?: number;

  @IsOptional()
  @IsString()
  vendedorNombre?: string;
}
