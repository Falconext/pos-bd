import { PartialType } from '@nestjs/mapped-types';
import { CreateGeocercaDto } from './create-geocerca.dto';

export class UpdateGeocercaDto extends PartialType(CreateGeocercaDto) {}
