import { PartialType } from '@nestjs/mapped-types';
import { CreateComboDto } from './create-combo.dto';

export class UpdateComboDto extends PartialType(CreateComboDto) {}
