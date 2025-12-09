import { PartialType } from '@nestjs/mapped-types';
import { CrearGrupoModificadorDto } from './crear-grupo-modificador.dto';

export class ActualizarGrupoModificadorDto extends PartialType(CrearGrupoModificadorDto) {}
