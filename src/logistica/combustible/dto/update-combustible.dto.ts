import { PartialType } from '@nestjs/mapped-types';
import { CreateCombustibleDto } from './create-combustible.dto';

export class UpdateCombustibleDto extends PartialType(CreateCombustibleDto) {}
