import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { EtapaCrm } from '../leads-embudo';

export class MoverEtapaDto {
  @IsEnum(EtapaCrm, { message: 'La etapa no es una de las 12 del embudo.' })
  etapa!: EtapaCrm;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  nota?: string;
}

export class RechazarPagoDto {
  /**
   * Obligatorio: un rechazo sin motivo deja al equipo sin saber qué pedirle
   * al cliente, y al cliente esperando sin entender por qué.
   */
  @IsString()
  @MaxLength(300)
  motivo!: string;
}

export class RangoBiDto {
  @IsOptional()
  @IsString()
  desde?: string;

  @IsOptional()
  @IsString()
  hasta?: string;
}
