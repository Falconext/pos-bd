import { PartialType } from '@nestjs/mapped-types';
import { CreateGuiaRemisionDto } from './create-guia-remision.dto';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateGuiaRemisionDto extends PartialType(CreateGuiaRemisionDto) {
    @IsOptional()
    @IsNumber()
    @Min(0.01)
    pesoTotal?: number;
}
