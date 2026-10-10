import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  etiquetaDeUsuario,
  nombreDeUsuario,
} from '../common/utils/nombre-usuario.util';
import { S3Service } from '../s3/s3.service';
import { EnvioDespachoService } from './envio-despacho.service';
import { EstadoDespacho } from './dto/envio-despacho.dto';
import {
  RegistrarEvidenciaDto,
  EntregasSinEvidenciaQueryDto,
} from './dto/evidencia-entrega.dto';

/**
 * D3 — la prueba de que el pedido llegó.
 *
 * El reclamo "no me llegó" aparece en todo negocio que reparte, y hasta ahora
 * se resolvía de palabra: el negocio reenvía el pedido y pierde el margen, o
 * discute y pierde al cliente. Con la foto y su hora se resuelve en un
 * mensaje, y la IA puede mandarla sin que nadie busque nada.
 */

/** Hasta cuántas fotos por entrega. Más de esto es acumular, no probar. */
const MAX_POR_ENTREGA = 6;
/** Fotos de celular moderno: 5 MB se queda corto y la subida falla sin más. */
export const MAX_BYTES_EVIDENCIA = 12 * 1024 * 1024;

/** Quién puede anular una evidencia. */
const ROLES_QUE_ANULAN = new Set(['ADMIN_SISTEMA', 'ADMIN_EMPRESA']);

export interface UsuarioQueRegistra {
  id?: number;
  nombre?: string;
  rol?: string;
}

@Injectable()
export class EvidenciaEntregaService {
  private readonly logger = new Logger(EvidenciaEntregaService.name);

  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
    private despachos: EnvioDespachoService,
  ) {}

  /**
   * Sube una o varias fotos y las deja colgadas del despacho.
   *
   * Aquí S3 NO es best-effort: si el archivo no quedó guardado, decir que sí
   * es peor que fallar — el negocio creería tener una prueba que no existe.
   */
  async registrar(
    comprobanteId: number,
    empresaId: number,
    archivos: Express.Multer.File[],
    dto: RegistrarEvidenciaDto,
    usuario: UsuarioQueRegistra,
  ) {
    if (!archivos?.length) {
      throw new BadRequestException('No se adjuntó ninguna foto.');
    }
    if (!this.s3.isEnabled()) {
      throw new BadRequestException(
        'El almacenamiento de archivos no está configurado: la evidencia no se puede guardar.',
      );
    }

    const despacho = await this.despachoDeEmpresa(comprobanteId, empresaId);
    const yaTiene = await this.prisma.evidenciaEntrega.count({
      where: { despachoId: despacho.id, anuladaEn: null },
    });
    if (yaTiene + archivos.length > MAX_POR_ENTREGA) {
      throw new BadRequestException(
        `Esta entrega ya tiene ${yaTiene} evidencia(s); el máximo es ${MAX_POR_ENTREGA}.`,
      );
    }

    // El token no trae el nombre del usuario: se lee de la BD, porque una
    // evidencia que no dice quién la subió sirve a medias.
    const quien = etiquetaDeUsuario(
      usuario.nombre ?? (await nombreDeUsuario(this.prisma, usuario.id)),
      usuario.id,
    );
    const repartidorId = dto.repartidorId ?? despacho.repartidorId ?? null;
    const tomadaEn = dto.tomadaEn ? new Date(dto.tomadaEn) : new Date();
    if (Number.isNaN(tomadaEn.getTime())) {
      throw new BadRequestException('La fecha de la entrega no es válida.');
    }
    // Una entrega no puede estar fechada en el futuro: sería un dato que nadie
    // podría haber tomado todavía.
    if (tomadaEn.getTime() > Date.now() + 60_000) {
      throw new BadRequestException(
        'La fecha de la entrega no puede estar en el futuro.',
      );
    }

    const creadas: { id: number; url: string }[] = [];
    for (const archivo of archivos) {
      const key = this.s3.generateEvidenciaEntregaKey(
        empresaId,
        despacho.id,
        archivo.mimetype,
      );
      const url = await this.s3.uploadImage(
        archivo.buffer,
        key,
        archivo.mimetype,
      );
      const fila = await this.prisma.evidenciaEntrega.create({
        data: {
          despachoId: despacho.id,
          empresaId,
          url,
          tipo: (dto.tipo as never) ?? undefined,
          nota: dto.nota?.trim() || null,
          usuarioId: usuario.id ?? null,
          usuarioNombre: quien,
          repartidorId,
          tomadaEn,
        },
        select: { id: true, url: true },
      });
      creadas.push(fila);
    }

    // Marcar entregado es opcional y explícito: subir la foto y dar por
    // entregado el pedido no son lo mismo (se puede estar documentando un
    // intento fallido o una entrega parcial).
    let despachoActualizado: unknown = null;
    if (dto.marcarEntregado && despacho.estado !== EstadoDespacho.ENTREGADO) {
      // Se delega en update() para que el cambio de estado pase por el mismo
      // camino de siempre: historial, aviso por WhatsApp al cliente y
      // sincronización del pedido de la tienda.
      despachoActualizado = await this.despachos.update(
        comprobanteId,
        empresaId,
        { estado: EstadoDespacho.ENTREGADO } as never,
        usuario.id,
      );
      await this.prisma.envioDespacho.update({
        where: { id: despacho.id },
        data: { entregadoEn: tomadaEn },
      });
    }

    return {
      registradas: creadas.length,
      evidencias: await this.listar(comprobanteId, empresaId),
      ...(despachoActualizado ? { despacho: despachoActualizado } : {}),
    };
  }

  /** Las evidencias vigentes de una entrega, de la más antigua a la más nueva. */
  async listar(comprobanteId: number, empresaId: number) {
    const despacho = await this.despachoDeEmpresa(comprobanteId, empresaId);
    return this.prisma.evidenciaEntrega.findMany({
      where: { despachoId: despacho.id, anuladaEn: null },
      orderBy: { tomadaEn: 'asc' },
      select: {
        id: true,
        url: true,
        tipo: true,
        nota: true,
        tomadaEn: true,
        usuarioNombre: true,
        repartidorId: true,
      },
    });
  }

  /**
   * Anula una evidencia. No la borra: queda la fila con quién la anuló y
   * cuándo. Una prueba que cualquiera puede hacer desaparecer sin rastro no
   * prueba nada, así que esto es solo para administradores.
   */
  async anular(id: number, empresaId: number, usuario: UsuarioQueRegistra) {
    if (!ROLES_QUE_ANULAN.has(usuario.rol ?? '')) {
      throw new ForbiddenException(
        'Solo un administrador puede anular una evidencia de entrega.',
      );
    }
    const evidencia = await this.prisma.evidenciaEntrega.findFirst({
      where: { id, empresaId },
      select: { id: true, anuladaEn: true },
    });
    if (!evidencia) throw new NotFoundException('Evidencia no encontrada.');
    if (evidencia.anuladaEn) return { anulada: true };

    await this.prisma.evidenciaEntrega.update({
      where: { id },
      data: {
        anuladaEn: new Date(),
        anuladaPor: etiquetaDeUsuario(
          usuario.nombre ?? (await nombreDeUsuario(this.prisma, usuario.id)),
          usuario.id,
        ),
      },
    });
    // El archivo en S3 se deja: es el rastro de lo que se anuló.
    return { anulada: true };
  }

  /**
   * Entregas marcadas como ENTREGADO que no tienen ninguna foto.
   *
   * Es el hueco que importa: son exactamente los pedidos donde, si el cliente
   * reclama, el negocio no tiene nada que mostrar.
   */
  async entregasSinEvidencia(
    empresaId: number,
    q: EntregasSinEvidenciaQueryDto,
  ) {
    const rango =
      q.desde || q.hasta
        ? {
            ...(q.desde && { gte: new Date(`${q.desde}T00:00:00-05:00`) }),
            ...(q.hasta && { lte: new Date(`${q.hasta}T23:59:59-05:00`) }),
          }
        : undefined;

    const filas = await this.prisma.envioDespacho.findMany({
      where: {
        comprobante: { empresaId },
        estado: EstadoDespacho.ENTREGADO as never,
        evidencias: { none: { anuladaEn: null } },
        ...(rango ? { OR: [{ entregadoEn: rango }, { creadoEn: rango }] } : {}),
      },
      orderBy: [{ entregadoEn: 'desc' }, { creadoEn: 'desc' }],
      take: 200,
      select: {
        id: true,
        comprobanteId: true,
        entregadoEn: true,
        creadoEn: true,
        transportista: true,
        distrito: true,
        montoCOD: true,
        repartidor: { select: { nombre: true } },
        comprobante: {
          select: {
            serie: true,
            correlativo: true,
            mtoImpVenta: true,
            cliente: { select: { nombre: true, telefono: true } },
          },
        },
      },
    });

    return {
      total: filas.length,
      // El monto en juego: lo que el negocio tendría que discutir sin pruebas.
      montoEnRiesgo: filas.reduce(
        (acc, f) => acc + Number(f.comprobante?.mtoImpVenta ?? 0),
        0,
      ),
      entregas: filas.map((f) => ({
        despachoId: f.id,
        comprobanteId: f.comprobanteId,
        comprobante: f.comprobante
          ? `${f.comprobante.serie}-${f.comprobante.correlativo}`
          : null,
        cliente: f.comprobante?.cliente?.nombre ?? null,
        telefono: f.comprobante?.cliente?.telefono ?? null,
        monto: Number(f.comprobante?.mtoImpVenta ?? 0),
        entregadoEn: f.entregadoEn ?? f.creadoEn,
        repartidor: f.repartidor?.nombre ?? f.transportista ?? null,
        distrito: f.distrito ?? null,
        contraentrega: Number(f.montoCOD ?? 0) > 0,
      })),
    };
  }

  private async despachoDeEmpresa(comprobanteId: number, empresaId: number) {
    const despacho = await this.prisma.envioDespacho.findFirst({
      where: { comprobanteId, comprobante: { empresaId } },
      select: { id: true, estado: true, repartidorId: true },
    });
    if (!despacho) {
      throw new NotFoundException(
        'No existe seguimiento de despacho para este comprobante.',
      );
    }
    return despacho;
  }
}
