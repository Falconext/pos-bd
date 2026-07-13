import { PartialType } from '@nestjs/mapped-types';
import { CreatePeajeDto } from './create-peaje.dto';

export class UpdatePeajeDto extends PartialType(CreatePeajeDto) {}
