import type { ConfigDemos } from './demos';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequiresModule } from '../common/decorators/module.decorator';
import { User } from '../common/decorators/user.decorator';
import { EstadoLeadProspecto, TipoLeadDocumento } from '@prisma/client';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Get('config')
  obtenerConfig(@User() user: any) {
    return this.service.obtenerConfig(user.empresaId);
  }

  /** Prospectos que pidieron demo: el banco para llamarlos después. */
  @Get('demos')
  listarDemos(@User() user: any) {
    return this.service.listarDemos(user.empresaId);
  }

  @Patch('config')
  actualizarConfig(
    @User() user: any,
    @Body()
    body: {
      iaVentasActiva?: boolean;
      iaVentasContexto?: string;
      iaVentasSeguimiento?: boolean;
      iaVentasCotizacion?: boolean;
      iaVentasBrochureUrl?: string;
      asesor?: string;
      videoBienvenidaUrl?: string;
      demos?: ConfigDemos | null;
      cobroConLink?: boolean;
    },
  ) {
    return this.service.actualizarConfig(user.empresaId, body);
  }

  /**
   * Sube el video de bienvenida (MP4, máx. 16 MB). Se manda una vez a cada
   * cliente nuevo, tras la primera respuesta del asesor. Para quitarlo:
   * PATCH /leads/config { videoBienvenidaUrl: "" }.
   */
  @Post('video-bienvenida')
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: 16 * 1024 * 1024 } }),
  )
  subirVideoBienvenida(
    @User() user: any,
    @UploadedFile() archivo: Express.Multer.File,
  ) {
    return this.service.subirVideoBienvenida(user.empresaId, archivo);
  }

  // ─── Entrenamiento de la IA (RAG) ──────────────────────────────────────────

  @Get('entrenamiento')
  listarDocumentos(@User() user: any) {
    return this.service.listarDocumentos(user.empresaId);
  }

  @Post('entrenamiento')
  crearDocumento(
    @User() user: any,
    @Body()
    body: {
      tipo: TipoLeadDocumento;
      titulo?: string;
      contenido?: string;
      url?: string;
    },
  ) {
    return this.service.crearDocumento(user.empresaId, body);
  }
  /**
   * Reintenta indexar un documento que quedó en ERROR, sin tener que
   * borrarlo y volver a subirlo.
   */
  @Post('entrenamiento/:id/reindexar')
  reindexarDocumento(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.reindexarDocumento(user.empresaId, id);
  }


  @Delete('entrenamiento/:id')
  eliminarDocumento(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.eliminarDocumento(user.empresaId, id);
  }

  @Get('prospectos')
  listarProspectos(
    @User() user: any,
    @Query('estado') estado?: EstadoLeadProspecto,
    @Query('search') search?: string,
  ) {
    return this.service.listarProspectos(user.empresaId, { estado, search });
  }

  @Get('prospectos/resumen')
  resumen(@User() user: any) {
    return this.service.resumenProspectos(user.empresaId);
  }

  @Get('conversaciones')
  listarConversaciones(@User() user: any) {
    return this.service.listarConversaciones(user.empresaId);
  }

  @Get('conversaciones/:id')
  obtenerConversacion(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.obtenerConversacion(user.empresaId, id);
  }

  /**
   * Responder a mano en la conversación, desde el WhatsApp de la empresa.
   * Tomar el chat pausa la IA automáticamente.
   */
  @Post('conversaciones/:id/mensaje')
  enviarMensajeManual(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { texto: string },
  ) {
    return this.service.enviarMensajeManual(user.empresaId, id, body?.texto);
  }

  /**
   * Mandar una imagen en la conversación desde el panel (multipart: `archivo`
   * y, opcional, `texto` como pie). También toma el chat.
   */
  @Post('conversaciones/:id/imagen')
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  enviarImagenManual(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() archivo: Express.Multer.File,
    @Body() body: { texto?: string },
  ) {
    return this.service.enviarImagenManual(
      user.empresaId,
      id,
      archivo,
      body?.texto,
    );
  }

  /**
   * Mandar una nota de voz desde el panel (multipart: `archivo` y, opcional,
   * `duracion` en segundos). Se convierte a OGG/Opus. También toma el chat.
   */
  @Post('conversaciones/:id/audio')
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: 16 * 1024 * 1024 } }),
  )
  enviarAudioManual(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() archivo: Express.Multer.File,
    @Body() body: { duracion?: string },
  ) {
    return this.service.enviarAudioManual(
      user.empresaId,
      id,
      archivo,
      body?.duracion ? Number(body.duracion) : undefined,
    );
  }

  /**
   * Tomar (o devolver) el chat. Va por conversación y no por prospecto porque
   * los chats de prueba del negocio no tienen prospecto, y eran justo los que
   * se quedaban sin interruptor.
   */
  @Patch('conversaciones/:id/bot')
  pausarConversacion(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { activo: boolean },
  ) {
    return this.service.pausarConversacion(
      user.empresaId,
      id,
      Boolean(body?.activo),
    );
  }

  /**
   * Borra la conversación entera. Es lo que permite volver a probar el mismo
   * flujo desde cero: sin esto, cada prueba arrastra el historial anterior.
   */
  @Delete('conversaciones/:id')
  eliminarConversacion(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.eliminarConversacion(user.empresaId, id);
  }

  @Post('prospectos/:id/convertir')
  convertirACliente(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.convertirACliente(user.empresaId, id);
  }

  @Patch('prospectos/:id/bot')
  setBotActivo(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { activo: boolean },
  ) {
    return this.service.setBotActivo(user.empresaId, id, Boolean(body?.activo));
  }
}
