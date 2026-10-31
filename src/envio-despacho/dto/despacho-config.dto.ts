import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class DespachoConfigDto {
  @IsOptional() @IsString() mensajeEnCamino?: string;
  /** Opcional: "en camino" para provincia (agencia). Vacío = sale el general. */
  @IsOptional() @IsString() @MaxLength(1000) mensajeEnCaminoAgencia?: string;
  @IsOptional() @IsString() mensajeEntregado?: string;
  /** Opcional: "entregado" para provincia (recogió en agencia). Vacío = el general. */
  @IsOptional() @IsString() @MaxLength(1000) mensajeEntregadoAgencia?: string;
  @IsOptional() @IsString() mensajeEnAgencia?: string;
  @IsOptional() @IsBoolean() notificarEnCamino?: boolean;
  @IsOptional() @IsBoolean() notificarEntregado?: boolean;
  /** Días máximos de recordatorio de recojo en agencia; 0 = apagado. */
  @IsOptional() @IsInt() @Min(0) @Max(7) recordatorioRecojoDias?: number;
  /** Formas de pago del aviso "en camino" cuando reparte alguien del equipo. */
  @IsOptional() @IsString() @MaxLength(300) pagoRepartidorPropio?: string;
  /** … y cuando reparte un contratado. */
  @IsOptional() @IsString() @MaxLength(300) pagoRepartidorContratado?: string;
}
