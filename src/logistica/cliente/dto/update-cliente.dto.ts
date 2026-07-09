import { PartialType } from '@nestjs/mapped-types';
import { CreateClienteLogisticaDto } from './create-cliente.dto';

export class UpdateClienteLogisticaDto extends PartialType(
  CreateClienteLogisticaDto,
) {}
