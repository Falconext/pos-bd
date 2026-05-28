import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    ParseIntPipe,
    Query,
    Req,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
} from '@nestjs/common';
import { CombosService } from './combos.service';
import { CreateComboDto, UpdateComboDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadOptions } from '../common/utils/multer.config';

@Controller('combos')
@UseGuards(JwtAuthGuard)
export class CombosController {
    constructor(private readonly combosService: CombosService) { }

    @Post()
    create(@Req() req: any, @Body() createComboDto: CreateComboDto) {
        return this.combosService.create(req.user.empresaId, createComboDto);
    }

    @Get()
    findAll(
        @Req() req: any,
        @Query('includeInactive') includeInactive?: string
    ) {
        return this.combosService.findAll(req.user.empresaId, includeInactive === 'true');
    }

    @Get(':id')
    findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
        return this.combosService.findOne(id, req.user.empresaId);
    }

    @Get(':id/stock')
    checkStock(@Param('id', ParseIntPipe) id: number) {
        return this.combosService.checkStock(id);
    }

    @Post(':id/imagen')
    @UseInterceptors(FileInterceptor('file', imageUploadOptions))
    subirImagenPrincipal(
        @Req() req: any,
        @Param('id', ParseIntPipe) id: number,
        @UploadedFile() file: Express.Multer.File,
        @Body('imagenBase64') imagenBase64?: string,
        @Body('imagenUrl') imagenUrl?: string,
    ) {
        if (file?.buffer) {
            return this.combosService.subirImagenPrincipal(
                req.user.empresaId,
                id,
                { buffer: file.buffer, mimetype: file.mimetype },
            );
        }

        if (typeof imagenBase64 === 'string' && imagenBase64.trim().length > 0) {
            return this.combosService.subirImagenDesdeBase64(
                req.user.empresaId,
                id,
                imagenBase64.trim(),
            );
        }

        if (typeof imagenUrl === 'string' && imagenUrl.trim().length > 0) {
            return this.combosService.actualizarImagenDesdeUrl(
                req.user.empresaId,
                id,
                imagenUrl.trim(),
            );
        }

        throw new BadRequestException(
            'Archivo no proporcionado. Envía multipart con campo "file", o "imagenBase64", o "imagenUrl".',
        );
    }

    @Patch(':id')
    update(
        @Req() req: any,
        @Param('id', ParseIntPipe) id: number,
        @Body() updateComboDto: UpdateComboDto
    ) {
        return this.combosService.update(id, req.user.empresaId, updateComboDto);
    }

    @Put(':id')
    updatePut(
        @Req() req: any,
        @Param('id', ParseIntPipe) id: number,
        @Body() updateComboDto: UpdateComboDto
    ) {
        return this.combosService.update(id, req.user.empresaId, updateComboDto);
    }

    @Delete(':id')
    delete(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
        return this.combosService.delete(id, req.user.empresaId);
    }
}
