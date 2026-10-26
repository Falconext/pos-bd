import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { S3Service } from '../s3/s3.service';
import {
  BotonPlantilla,
  DatosPlantilla,
  EstadoPlantilla,
  erroresDe,
  estadoDesdeMeta,
  motivoRechazo,
  nombreMetaDe,
  normalizarPlantilla,
  payloadAltaMeta,
} from './plantillas-propias';

/** Se pueden editar mientras Meta no las tenga, o si las rechazó. */
const EDITABLES: EstadoPlantilla[] = ['BORRADOR', 'RECHAZADA'];

type FilaPlantilla = Awaited<
  ReturnType<PrismaService['leadPlantilla']['findFirst']>
> &
  object;

/**
 * Plantillas de WhatsApp de la empresa: borrador → revisión de Meta →
 * aprobada (o rechazada, con el motivo).
 *
 * Meta avisa el resultado por webhook (`message_template_status_update`). El
 * webhook es lo rápido; la consulta periódica es la red: si el webhook no
 * está suscrito a ese campo, la plantilla igual pasa a aprobada.
 */
@Injectable()
export class LeadsPlantillasService {
  private readonly logger = new Logger(LeadsPlantillasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    @Optional() private readonly s3?: S3Service,
  ) {}

  listar(empresaId: number) {
    return this.prisma.leadPlantilla.findMany({
      where: { empresaId },
      orderBy: { actualizadoEn: 'desc' },
    });
  }

  async obtener(empresaId: number, id: number) {
    const p = await this.prisma.leadPlantilla.findFirst({
      where: { id, empresaId },
    });
    if (!p) throw new NotFoundException('Plantilla no encontrada');
    return p;
  }

  /** Lo guardado, en la forma que usan las reglas. */
  datosDe(p: FilaPlantilla): DatosPlantilla {
    return normalizarPlantilla({
      titulo: p.titulo,
      categoria: p.categoria,
      cabeceraTipo: p.cabeceraTipo,
      cabeceraTexto: p.cabeceraTexto,
      cabeceraImagenUrl: p.cabeceraImagenUrl,
      cuerpo: p.cuerpo,
      pie: p.pie,
      botones: (p.botonesJson as unknown as BotonPlantilla[]) ?? [],
      ejemplos: (p.ejemplosJson as Record<string, string>) ?? {},
    });
  }

  /** Crea o edita un borrador. No llama a Meta. */
  async guardar(empresaId: number, crudo: unknown, id?: number) {
    const d = normalizarPlantilla(crudo);
    if (!d.titulo)
      throw new BadRequestException('Ponle un nombre a la plantilla.');
    if (!d.cuerpo) throw new BadRequestException('Escribe el mensaje.');

    const data = {
      titulo: d.titulo,
      categoria: d.categoria,
      cabeceraTipo: d.cabeceraTipo,
      cabeceraTexto: d.cabeceraTexto ?? null,
      cabeceraImagenUrl: d.cabeceraImagenUrl ?? null,
      cuerpo: d.cuerpo,
      pie: d.pie ?? null,
      botonesJson: d.botones as never,
      ejemplosJson: d.ejemplos as never,
    };

    if (id) {
      const actual = await this.obtener(empresaId, id);
      if (!EDITABLES.includes(actual.estado as EstadoPlantilla)) {
        throw new BadRequestException(
          'Esta plantilla ya está en Meta y no se puede editar. Duplícala para hacer una versión nueva.',
        );
      }
      // Una rechazada vuelve a borrador con OTRO nombre: Meta no deja
      // reutilizar el rechazado. El viejo se borra de la cuenta para no
      // dejar basura; si falla, no importa (ya está rechazado).
      const yaEstabaEnMeta = actual.estado === 'RECHAZADA';
      if (yaEstabaEnMeta) {
        await this.whatsapp
          .borrarPlantillaPropia(empresaId, actual.nombreMeta)
          .catch(() => undefined);
      }
      return this.prisma.leadPlantilla.update({
        where: { id },
        data: {
          ...data,
          estado: 'BORRADOR',
          motivoRechazo: null,
          ...(yaEstabaEnMeta
            ? {
                nombreMeta: this.nombreNuevo(d.titulo),
                metaId: null,
                enviadaEn: null,
              }
            : {}),
        },
      });
    }
    return this.prisma.leadPlantilla.create({
      data: { ...data, empresaId, nombreMeta: this.nombreNuevo(d.titulo) },
    });
  }

  private nombreNuevo(titulo: string) {
    return nombreMetaDe(titulo, randomBytes(3).toString('hex'));
  }

  /** Copia editable de una plantilla, para cambiar una que ya está en Meta. */
  async duplicar(empresaId: number, id: number) {
    const p = await this.obtener(empresaId, id);
    const titulo = `${p.titulo} (copia)`.slice(0, 60);
    return this.prisma.leadPlantilla.create({
      data: {
        empresaId,
        titulo,
        nombreMeta: this.nombreNuevo(titulo),
        categoria: p.categoria,
        cabeceraTipo: p.cabeceraTipo,
        cabeceraTexto: p.cabeceraTexto,
        cabeceraImagenUrl: p.cabeceraImagenUrl,
        cuerpo: p.cuerpo,
        pie: p.pie,
        botonesJson: p.botonesJson ?? undefined,
        ejemplosJson: p.ejemplosJson ?? undefined,
      },
    });
  }

  /**
   * La manda a revisión de Meta. Valida antes con las mismas reglas que se
   * ven en el panel: un rechazo de Meta tarda en llegar y no explica nada.
   */
  async enviarARevision(empresaId: number, id: number) {
    const p = await this.obtener(empresaId, id);
    if (!EDITABLES.includes(p.estado as EstadoPlantilla)) {
      throw new BadRequestException('Esta plantilla ya fue enviada a Meta.');
    }
    const d = this.datosDe(p);
    const errores = erroresDe(d);
    if (errores.length) throw new BadRequestException(errores.join(' '));

    // Una rechazada se reenvía tal cual (sin editar) con otro nombre: Meta
    // no deja reutilizar el rechazado.
    const nombreMeta =
      p.estado === 'RECHAZADA' ? this.nombreNuevo(p.titulo) : p.nombreMeta;

    let handle: string | undefined;
    if (d.cabeceraTipo === 'IMAGEN' && d.cabeceraImagenUrl) {
      const img = await axios
        .get<ArrayBuffer>(d.cabeceraImagenUrl, {
          responseType: 'arraybuffer',
          timeout: 20000,
        })
        .catch(() => {
          throw new BadRequestException(
            'No se pudo leer la imagen de la cabecera. Súbela de nuevo.',
          );
        });
      const tipo = String(img.headers['content-type'] ?? 'image/jpeg').split(
        ';',
      )[0];
      handle = await this.whatsapp.subirEjemploDePlantilla(
        empresaId,
        Buffer.from(img.data),
        tipo,
      );
    }

    const res = await this.whatsapp.crearPlantillaPropia(
      empresaId,
      payloadAltaMeta(d, nombreMeta, handle),
    );
    this.logger.log(
      `Plantilla ${nombreMeta} (empresa ${empresaId}) enviada a Meta: ${res.status}${
        res.category && res.category !== d.categoria
          ? `, Meta la pasó a ${res.category}`
          : ''
      }.`,
    );
    return this.prisma.leadPlantilla.update({
      where: { id },
      data: {
        nombreMeta,
        metaId: res.id ?? null,
        estado: estadoDesdeMeta(res.status),
        // Meta puede reclasificarla (una "utilidad" con tono de promo pasa a
        // marketing). Se guarda lo que Meta decidió: es lo que cobra.
        categoria: res.category ?? d.categoria,
        enviadaEn: new Date(),
        motivoRechazo: null,
      },
    });
  }

  /** Vuelve a preguntarle a Meta en qué quedó. */
  async sincronizar(empresaId: number, id: number) {
    const p = await this.obtener(empresaId, id);
    if (p.estado === 'BORRADOR') return p;
    const meta = await this.whatsapp.consultarPlantilla(
      empresaId,
      p.nombreMeta,
    );
    if (!meta) {
      return this.prisma.leadPlantilla.update({
        where: { id },
        data: {
          estado: 'DESACTIVADA',
          motivoRechazo: 'La plantilla ya no existe en tu cuenta de WhatsApp.',
        },
      });
    }
    return this.aplicarEstado(
      p,
      meta.status,
      meta.rejected_reason,
      meta.category,
    );
  }

  private async aplicarEstado(
    p: FilaPlantilla,
    status: string,
    reason?: string | null,
    categoria?: string | null,
  ) {
    const estado = estadoDesdeMeta(status);
    if (estado === p.estado && !categoria) return p;
    return this.prisma.leadPlantilla.update({
      where: { id: p.id },
      data: {
        estado,
        motivoRechazo:
          estado === 'RECHAZADA'
            ? (motivoRechazo(reason) ?? 'Meta la rechazó.')
            : null,
        ...(estado !== 'PENDIENTE' && estado !== p.estado
          ? { revisadaEn: new Date() }
          : {}),
        ...(categoria ? { categoria } : {}),
      },
    });
  }

  /**
   * Webhook `message_template_status_update`. `wabaId` es el id de la cuenta
   * (entry.id): con él se sabe de qué empresa es, porque el nombre de la
   * plantilla solo es único dentro de su cuenta.
   */
  async aplicarWebhook(
    wabaId: string,
    value: {
      event?: string;
      message_template_id?: string | number;
      message_template_name?: string;
      reason?: string;
    },
  ) {
    const empresas = await this.prisma.empresa.findMany({
      where: { whatsappBusinessId: String(wabaId) },
      select: { id: true },
    });
    if (!empresas.length || !value?.event) return { actualizadas: 0 };
    const p = await this.prisma.leadPlantilla.findFirst({
      where: {
        empresaId: { in: empresas.map((e) => e.id) },
        OR: [
          ...(value.message_template_id
            ? [{ metaId: String(value.message_template_id) }]
            : []),
          ...(value.message_template_name
            ? [{ nombreMeta: value.message_template_name }]
            : []),
        ],
      },
    });
    // Las plantillas fijas del sistema (recompra_25, aviso_equipo…) también
    // llegan acá y no tienen fila: no es un error.
    if (!p) return { actualizadas: 0 };
    await this.aplicarEstado(p, value.event, value.reason);
    this.logger.log(
      `Plantilla ${p.nombreMeta} (empresa ${p.empresaId}): ${value.event}.`,
    );
    return { actualizadas: 1 };
  }

  /** Red de seguridad del webhook: cada 15 min, las que siguen en revisión. */
  @Cron('*/15 * * * *', { name: 'leads-plantillas-pendientes' })
  async revisarPendientes() {
    const pendientes = await this.prisma.leadPlantilla.findMany({
      where: { estado: 'PENDIENTE' },
      select: { id: true, empresaId: true },
      take: 100,
    });
    for (const p of pendientes) {
      await this.sincronizar(p.empresaId, p.id).catch((e) =>
        this.logger.warn(
          `No se pudo sincronizar la plantilla ${p.id}: ${e?.message}`,
        ),
      );
    }
  }

  async eliminar(empresaId: number, id: number) {
    const p = await this.obtener(empresaId, id);
    if (await this.enUso(id)) {
      throw new BadRequestException(
        'Hay un envío programado o en curso con esta plantilla. Cancélalo antes de borrarla.',
      );
    }
    if (p.estado !== 'BORRADOR') {
      await this.whatsapp.borrarPlantillaPropia(empresaId, p.nombreMeta);
    }
    await this.prisma.leadPlantilla.delete({ where: { id } });
    return { eliminada: true };
  }

  /** ¿Algún envío pendiente la usa? Se completa con los envíos masivos. */
  protected async enUso(_id: number): Promise<boolean> {
    return false;
  }

  /** Imagen para la cabecera (JPG/PNG, máx. 5 MB: el límite de Meta). */
  async subirImagen(
    empresaId: number,
    archivo: { buffer: Buffer; mimetype: string; size: number },
  ) {
    if (!archivo?.buffer?.length)
      throw new BadRequestException('Falta la imagen.');
    if (!['image/jpeg', 'image/png'].includes(archivo.mimetype)) {
      throw new BadRequestException('La imagen tiene que ser JPG o PNG.');
    }
    if (archivo.size > 5 * 1024 * 1024) {
      throw new BadRequestException('La imagen puede pesar hasta 5 MB.');
    }
    if (!this.s3)
      throw new BadRequestException('El almacenamiento no está disponible.');
    const ext = archivo.mimetype === 'image/png' ? 'png' : 'jpg';
    const url = await this.s3.uploadPDF(
      archivo.buffer,
      `ia-ventas/empresa-${empresaId}/plantillas/${Date.now()}.${ext}`,
      archivo.mimetype,
    );
    return { url };
  }
}
