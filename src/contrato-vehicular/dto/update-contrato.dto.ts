import { PartialType } from '@nestjs/mapped-types';
import { CreateContratoVehicularDto } from './create-contrato.dto';

export class UpdateContratoVehicularDto extends PartialType(
  CreateContratoVehicularDto,
) {}
