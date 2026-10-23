import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class DespachoConfigDto {
  @IsOptional() @IsString() mensajeEnCamino?: string;
  @IsOptional() @IsString() mensajeEntregado?: string;
  @IsOptional() @IsBoolean() notificarEnCamino?: boolean;
  @IsOptional() @IsBoolean() notificarEntregado?: boolean;
  /** Días máximos de recordatorio de recojo en agencia; 0 = apagado. */
  @IsOptional() @IsInt() @Min(0) @Max(7) recordatorioRecojoDias?: number;
}
