import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateSubModuloDto } from './create-submodulo.dto';

export class UpdateSubModuloDto extends PartialType(
  OmitType(CreateSubModuloDto, ['moduloId', 'codigo'] as const),
) {}
