import { PartialType } from '@nestjs/mapped-types';
import { CreateVehiculoLogisticaDto } from './create-vehiculo.dto';

export class UpdateVehiculoLogisticaDto extends PartialType(
  CreateVehiculoLogisticaDto,
) {}
