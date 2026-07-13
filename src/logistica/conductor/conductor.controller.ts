import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { ConductorService } from './conductor.service';
import { CreateConductorDto } from './dto/create-conductor.dto';
import { UpdateConductorDto } from './dto/update-conductor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/conductores')
export class ConductorController {
  constructor(private readonly conductorService: ConductorService) {}

  @Post()
  create(@Body() createConductorDto: CreateConductorDto, @Request() req: any) {
    return this.conductorService.create(req.user.empresaId, createConductorDto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('estado') estado?: string,
  ) {
    return this.conductorService.findAll(req.user.empresaId, {
      search,
      estado,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.conductorService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateConductorDto: UpdateConductorDto,
    @Request() req: any,
  ) {
    return this.conductorService.update(
      id,
      req.user.empresaId,
      updateConductorDto,
    );
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.conductorService.remove(id, req.user.empresaId);
  }
}
