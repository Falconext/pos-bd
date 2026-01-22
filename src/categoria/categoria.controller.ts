import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadOptions } from '../common/utils/multer.config';
import { CategoriaService } from './categoria.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import type { Response } from 'express';
import { CreateCategoriaDto } from './dto/create-categoria.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('categoria')
export class CategoriaController {
  constructor(private readonly service: CategoriaService) { }

  @Post('crear')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crear(
    @Body() dto: CreateCategoriaDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const categoria = await this.service.crear(dto, user.empresaId);
    res.locals.message = 'Categoría creada correctamente';
    return categoria;
  }

  @Post(':id/imagen')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirImagenPrincipal(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.subirImagenPrincipal(user.empresaId, id, { buffer: file?.buffer, mimetype: file?.mimetype });
  }

  @Get('listar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listar(@User() user: any, @Res({ passthrough: true }) res: Response) {
    const categorias = await this.service.listar(user.empresaId);
    res.locals.message = 'Categorías listadas correctamente';
    return categorias;
  }

  @Get(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtener(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cat = await this.service.obtenerPorId(id, user.empresaId);
    res.locals.message = 'Categoría obtenida correctamente';
    return cat;
  }

  @Put(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCategoriaDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actualizada = await this.service.actualizar(
      id,
      dto,
      user.empresaId,
    );
    res.locals.message = 'Categoría actualizada correctamente';
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
    res.locals.message = 'Categoría eliminada correctamente';
    return eliminada;
  }
}
