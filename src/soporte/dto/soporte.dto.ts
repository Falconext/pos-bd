import { IsString, MaxLength, MinLength } from 'class-validator';

export class EnviarMensajeSoporteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  contenido: string;
}
