import { IsIn, IsString } from 'class-validator';

export class UpdateEstadoOrdenDto {
  @IsString()
  @IsIn(['BORRADOR', 'PLANIFICADA', 'EN_PROCESO', 'ANULADA'])
  estado: 'BORRADOR' | 'PLANIFICADA' | 'EN_PROCESO' | 'ANULADA';
}
