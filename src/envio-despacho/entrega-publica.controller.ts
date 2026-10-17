/**
 * La pantalla del repartidor, abierta con un enlace y sin cuenta.
 *
 * Es público a propósito: el motorizado no tiene usuario en el sistema y no
 * debería tenerlo —para marcar una entrega habría que darle acceso al módulo
 * de Ventas, donde vería todas las ventas del día con sus montos—. El enlace
 * es la credencial, y abre UN despacho: el suyo.
 *
 * Qué se cuida acá:
 *
 *  - Token opaco de 32 bytes, que vence al día siguiente de entregar.
 *  - Token inválido y enlace vencido devuelven el MISMO 404, para no
 *    confirmarle a nadie que un token existió.
 *  - El `empresaId` sale del token, nunca del request: si viniera de afuera,
 *    el enlace de un negocio serviría para marcar el pedido de otro.
 *  - Solo tres operaciones: ver, marcar y subir foto. Cobrar, reprogramar o
 *    devolver son decisiones del negocio y se hacen desde el panel.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { EnvioDespachoService } from './envio-despacho.service';
import { EvidenciaEntregaService } from './evidencia-entrega.service';
import { evidenciaUploadOptions } from '../common/utils/multer.config';

@Controller('entrega')
export class EntregaPublicaController {
  constructor(
    private readonly despacho: EnvioDespachoService,
    private readonly evidencias: EvidenciaEntregaService,
  ) {}

  /** Lo que el repartidor necesita para entregar, y nada más. */
  @Get(':token')
  async ver(@Param('token') token: string) {
    const entrega = await this.despacho.entregaPorToken(token);
    if (!entrega) throw new NotFoundException('Este enlace ya no está activo.');
    return entrega;
  }

  /** "Salí con el paquete" / "lo entregué". */
  @Patch(':token/estado')
  async marcar(
    @Param('token') token: string,
    @Body() body: { estado?: string },
  ) {
    const estado = String(body?.estado ?? '').toUpperCase();
    const res = await this.despacho.marcarPorToken(token, estado);
    if (!res) throw new NotFoundException('Este enlace ya no está activo.');
    return res;
  }

  /**
   * La foto de la entrega.
   *
   * Llegan ya reducidas a JPEG por el navegador: se suben desde la calle con
   * datos móviles.
   */
  @Post(':token/evidencias')
  @UseInterceptors(FilesInterceptor('fotos', 6, evidenciaUploadOptions))
  async subirFotos(
    @Param('token') token: string,
    @UploadedFiles() fotos: Express.Multer.File[],
    @Body() dto: { nota?: string },
  ) {
    const destino = await this.despacho.comprobanteDeToken(token);
    if (!destino) throw new NotFoundException('Este enlace ya no está activo.');
    if (!fotos?.length) {
      throw new BadRequestException('No se adjuntó ninguna foto.');
    }
    return this.evidencias.registrar(
      destino.comprobanteId,
      destino.empresaId,
      fotos,
      dto as never,
      // Queda firmado como el repartidor: no hay usuario detrás del enlace y
      // atribuírselo a alguien de oficina sería mentir en el rastro.
      { id: null as never, nombre: 'Repartidor (enlace)', rol: 'REPARTIDOR' },
    );
  }
}
