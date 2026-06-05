import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';
import { RepartidorService } from './repartidor.service';
import { CreateRepartidorDto, UpdateRepartidorDto } from './dto/repartidor.dto';

@UseGuards(JwtAuthGuard)
@Controller('repartidores')
export class RepartidorController {
  constructor(private readonly service: RepartidorService) {}

  @Get()
  findAll(
    @User() user: any,
    @Query('sedeId') sedeId?: string,
    @Query('incluirInactivos') incluirInactivos?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(user.empresaId, {
      sedeId: sedeId ? Number(sedeId) : undefined,
      incluirInactivos: incluirInactivos === 'true',
      search,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @User() user: any) {
    return this.service.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateRepartidorDto, @User() user: any) {
    return this.service.create(user.empresaId, dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRepartidorDto, @User() user: any) {
    return this.service.update(id, user.empresaId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @User() user: any) {
    return this.service.remove(id, user.empresaId);
  }
}
