import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Res, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadOptions } from '../common/utils/multer.config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import type { Response } from 'express';
import { MarcaService } from './marca.service';
import { CreateMarcaDto } from './dto/create-marca.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('marca')
export class MarcaController {
  constructor(private readonly service: MarcaService) { }

  @Post('crear')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crear(
    @Body() dto: CreateMarcaDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const marca = await this.service.crear(dto, user.empresaId);
    res.locals.message = 'Marca creada correctamente';
    return marca;
  }

  @Get('listar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listar(@User() user: any, @Res({ passthrough: true }) res: Response) {
    const marcas = await this.service.listar(user.empresaId);
    res.locals.message = 'Marcas listadas correctamente';
    return marcas;
  }

  @Get(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtener(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const marca = await this.service.obtenerPorId(id, user.empresaId);
    res.locals.message = 'Marca obtenida correctamente';
    return marca;
  }

  @Post(':id/imagen')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirImagen(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.subirImagenPrincipal(user.empresaId, id, { buffer: file?.buffer, mimetype: file?.mimetype });
  }

  @Put(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateMarcaDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actualizada = await this.service.actualizar(id, dto, user.empresaId);
    res.locals.message = 'Marca actualizada correctamente';
    return actualizada;
  }

  @Delete(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async eliminar(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const eliminada = await this.service.eliminar(id, user.empresaId);
    res.locals.message = 'Marca eliminada correctamente';
    return eliminada;
  }
}
