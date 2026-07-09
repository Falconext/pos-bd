import { PartialType } from '@nestjs/mapped-types';
import { CreateGaleriaDto } from './create-galeria.dto';

export class UpdateGaleriaDto extends PartialType(CreateGaleriaDto) {}
