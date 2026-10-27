import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { SoporteService } from './soporte.service';
import { EnviarMensajeSoporteDto } from './dto/soporte.dto';

/** Foto o nota de voz: `archivo` por multipart y, en la foto, `texto` opcional como pie. */
const ADJUNTO = FileInterceptor('archivo', { limits: { fileSize: 16 * 1024 * 1024 } });

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('soporte')
export class SoporteController {
  constructor(private readonly service: SoporteService) {}

  // ── Lado empresa ──────────────────────────────────────────────────────────

  @Get('estado')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  estado(@User() user: any) {
    return this.service.estado(user.empresaId);
  }

  @Get('mensajes')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  listarMensajes(@User() user: any) {
    return this.service.listarMensajes(user.empresaId);
  }

  @Post('mensajes')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  enviarMensaje(@User() user: any, @Body() dto: EnviarMensajeSoporteDto) {
    return this.service.enviarMensajeEmpresa(
      user.empresaId,
      user.id,
      dto.contenido,
    );
  }

  // ── Bandeja Krezka (ADMIN_SISTEMA) ──────────────────────────────────────────

  /** Foto al soporte (multipart `archivo` + `texto` opcional). */
  @Post('mensajes/imagen')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(ADJUNTO)
  enviarImagen(@User() user: any, @UploadedFile() archivo: Express.Multer.File, @Body() body: { texto?: string }) {
    return this.service.enviarAdjuntoEmpresa(user.empresaId, user.id, 'imagen', archivo, body?.texto);
  }

  /** Nota de voz al soporte (multipart `archivo`). */
  @Post('mensajes/audio')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(ADJUNTO)
  enviarAudio(@User() user: any, @UploadedFile() archivo: Express.Multer.File) {
    return this.service.enviarAdjuntoEmpresa(user.empresaId, user.id, 'audio', archivo);
  }

  @Get('sistema/conversaciones')
  @Roles('ADMIN_SISTEMA')
  listarConversaciones(
    @User() user: any,
    @Query('estado') estado?: 'ABIERTA' | 'CERRADA',
  ) {
    return this.service.listarConversacionesSistema(
      user.sistemaNegocio ?? null,
      estado,
    );
  }

  @Get('sistema/conversaciones/:id')
  @Roles('ADMIN_SISTEMA')
  obtenerConversacion(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.obtenerConversacionSistema(id, user.sistemaNegocio ?? null);
  }

  @Post('sistema/conversaciones/:id/mensajes')
  @Roles('ADMIN_SISTEMA')
  enviarMensajeSistema(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnviarMensajeSoporteDto,
  ) {
    return this.service.enviarMensajeSistema(
      id,
      user.sistemaNegocio ?? null,
      user.id,
      dto.contenido,
    );
  }

  @Post('sistema/conversaciones/:id/imagen')
  @Roles('ADMIN_SISTEMA')
  @UseInterceptors(ADJUNTO)
  enviarImagenSistema(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() archivo: Express.Multer.File,
    @Body() body: { texto?: string },
  ) {
    return this.service.enviarAdjuntoSistema(id, user.sistemaNegocio ?? null, user.id, 'imagen', archivo, body?.texto);
  }

  @Post('sistema/conversaciones/:id/audio')
  @Roles('ADMIN_SISTEMA')
  @UseInterceptors(ADJUNTO)
  enviarAudioSistema(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() archivo: Express.Multer.File,
  ) {
    return this.service.enviarAdjuntoSistema(id, user.sistemaNegocio ?? null, user.id, 'audio', archivo);
  }

  @Patch('sistema/conversaciones/:id/cerrar')
  @Roles('ADMIN_SISTEMA')
  cerrarConversacion(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.cerrarConversacion(id, user.sistemaNegocio ?? null);
  }
}
