import { PartialType } from '@nestjs/mapped-types';
import { CreateAlmacenLogisticaDto } from './create-almacen.dto';

export class UpdateAlmacenLogisticaDto extends PartialType(
  CreateAlmacenLogisticaDto,
) {}
