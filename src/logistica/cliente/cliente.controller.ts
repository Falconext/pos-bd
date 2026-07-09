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
import { ClienteLogisticaService } from './cliente.service';
import { CreateClienteLogisticaDto } from './dto/create-cliente.dto';
import { UpdateClienteLogisticaDto } from './dto/update-cliente.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('logistica/clientes')
export class ClienteLogisticaController {
  constructor(private readonly clienteService: ClienteLogisticaService) {}

  @Post()
  create(
    @Body() createClienteDto: CreateClienteLogisticaDto,
    @Request() req: any,
  ) {
    return this.clienteService.create(req.user.empresaId, createClienteDto);
  }

  @Get()
  findAll(@Request() req: any, @Query('search') search?: string) {
    return this.clienteService.findAll(req.user.empresaId, { search });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.clienteService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateClienteDto: UpdateClienteLogisticaDto,
    @Request() req: any,
  ) {
    return this.clienteService.update(id, req.user.empresaId, updateClienteDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.clienteService.remove(id, req.user.empresaId);
  }
}
