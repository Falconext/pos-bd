import { PartialType } from '@nestjs/mapped-types';
import { CreateSedeDto } from './create-sede.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSedeDto extends PartialType(CreateSedeDto) {
    @IsBoolean()
    @IsOptional()
    activo?: boolean;
}
