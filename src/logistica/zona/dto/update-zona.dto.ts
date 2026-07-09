import { PartialType } from '@nestjs/mapped-types';
import { CreateZonaEntregaLogisticaDto } from './create-zona.dto';

export class UpdateZonaEntregaLogisticaDto extends PartialType(
  CreateZonaEntregaLogisticaDto,
) {}
