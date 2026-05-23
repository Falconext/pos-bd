import { IsIn, IsString } from 'class-validator';

export class UpdateMetodoSalidaDto {
  @IsString()
  @IsIn(['FEFO', 'FIFO', 'LIFO'])
  metodoSalidaLotes: 'FEFO' | 'FIFO' | 'LIFO';
}

