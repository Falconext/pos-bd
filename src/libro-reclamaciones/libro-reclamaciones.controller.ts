import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { LibroReclamacionesService } from './libro-reclamaciones.service';
import { ResponderReclamacionDto } from './dto/registrar-reclamacion.dto';

interface UsuarioToken {
  id: number;
  empresaId?: number | null;
}

/** La empresa sale SIEMPRE del token, nunca de la petición. */
function empresaDe(user: UsuarioToken): number {
  if (!user?.empresaId)
    throw new ForbiddenException('Tu usuario no pertenece a una empresa.');
  return user.empresaId;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
@Controller('libro-reclamaciones')
export class LibroReclamacionesController {
  constructor(private readonly service: LibroReclamacionesService) {}

  @Get()
  listar(
    @User() user: UsuarioToken,
    @Query('estado') estado?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listar(empresaDe(user), {
      estado,
      search,
      page,
      limit,
    });
  }

  // Rutas fijas antes de ':id'.
  @Get('exportar')
  async exportar(
    @User() user: UsuarioToken,
    @Res() res: Response,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    const buffer = await this.service.exportar(empresaDe(user), desde, hasta);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="libro-reclamaciones.xlsx"',
    );
    res.end(buffer);
  }

  @Get(':id')
  obtener(@User() user: UsuarioToken, @Param('id', ParseIntPipe) id: number) {
    return this.service.obtener(empresaDe(user), id);
  }

  @Post(':id/respuesta')
  responder(
    @User() user: UsuarioToken,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResponderReclamacionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.locals.message = 'Respuesta registrada';
    return this.service.responder(empresaDe(user), id, user.id, dto?.respuesta);
  }

  @Get(':id/constancia')
  async constancia(
    @User() user: UsuarioToken,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const { codigo, pdf } = await this.service.constanciaPanel(
      empresaDe(user),
      id,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="hoja-reclamacion-${codigo}.pdf"`,
    );
    res.end(pdf);
  }
}
