import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class AlertaStockConfigDto {
  @IsOptional()
  @IsBoolean()
  correo?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  /** Correos separados por coma; vacío = los de los administradores. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  correos?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  celular?: string | null;
}
