import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { excelUploadOptions } from '../common/utils/multer.config';
import { ReprecioExcelService } from './reprecio-excel.service';
import { plantillaReprecio } from './reprecio-excel';

/** Reprecio del Kardex con Excel (precio normal o precios por volumen). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reprecio-excel')
export class ReprecioExcelController {
  constructor(private readonly service: ReprecioExcelService) {}

  @Get('plantilla')
  @Roles('ADMIN_EMPRESA')
  plantilla(@Query('tipo') tipo: string, @Res() res: Response) {
    const volumen = String(tipo).toUpperCase() === 'VOLUMEN';
    const buf = plantillaReprecio(volumen ? 'VOLUMEN' : 'PRECIO');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${volumen ? 'Plantilla_Precios_Por_Volumen' : 'Plantilla_Precios'}.xlsx"`,
    );
    res.end(buf);
  }

  @Post('previsualizar')
  @Roles('ADMIN_EMPRESA')
  @UseInterceptors(FileInterceptor('file', excelUploadOptions))
  previsualizar(@UploadedFile() file: any, @User() user: any) {
    if (!file?.buffer) throw new BadRequestException('Sube el archivo Excel');
    return this.service.previsualizar(user.empresaId, file.buffer);
  }

  @Post('aplicar')
  @Roles('ADMIN_EMPRESA')
  @UseInterceptors(FileInterceptor('file', excelUploadOptions))
  aplicar(@UploadedFile() file: any, @User() user: any) {
    if (!file?.buffer) throw new BadRequestException('Sube el archivo Excel');
    return this.service.aplicar(user.empresaId, file.buffer);
  }
}
