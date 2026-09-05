import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoLeadProspecto, TipoLeadDocumento } from '@prisma/client';
import { RagVentasService } from './leads-rag.service';
import { ClienteService } from '../cliente/cliente.service';

/**
 * Módulo IA de Ventas / Filtro de Leads (portado de salesfilter-ai).
 * Todo scoped por empresaId. Esta primera fase expone la lectura del CRM
 * (prospectos + conversaciones); el motor de IA y el webhook llegan después.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagVentasService,
    private readonly clientes: ClienteService,
  ) {}

  /**
   * Convierte un prospecto en Cliente de MYPE (el embudo completo, un clic).
   * Reusa ClienteService.crear (sin duplicar). Como un lead normalmente no tiene
   * documento, se crea como "OTRO" con nroDoc placeholder. Idempotente: si ya se
   * convirtió, devuelve el cliente existente.
   */
  async convertirACliente(empresaId: number, prospectoId: number) {
    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { id: prospectoId, empresaId },
      select: {
        id: true,
        nombreProspecto: true,
        telefonoProspecto: true,
        clienteId: true,
      },
    });
    if (!prospecto) throw new NotFoundException('Prospecto no encontrado');

    // Ya convertido → devolver el cliente existente (idempotente).
    if (prospecto.clienteId) {
      const cliente = await this.prisma.cliente.findUnique({
        where: { id: prospecto.clienteId },
      });
      if (cliente) return { cliente, yaExistia: true };
    }

    const cliente = await this.clientes.crear({
      nombre: prospecto.nombreProspecto?.trim() || `Prospecto ${prospecto.telefonoProspecto}`,
      tipoDoc: 'OTRO',
      nroDoc: '00000000', // sin documento: no se deduplica
      telefono: prospecto.telefonoProspecto,
      empresaId,
      ubigeo: '',
      departamento: '',
      provincia: '',
      distrito: '',
    });

    await this.prisma.leadProspecto.update({
      where: { id: prospecto.id },
      data: { clienteId: cliente.id, estado: 'CONVERTIDO' },
    });

    return { cliente, yaExistia: false };
  }

  // ─── Entrenamiento de la IA (RAG) ──────────────────────────────────────────

  private readonly docSelect = {
    id: true,
    tipo: true,
    titulo: true,
    origen: true,
    estado: true,
    error: true,
    creadoEn: true,
    _count: { select: { fragmentos: true } },
  } as const;

  /** Documentos de entrenamiento de la empresa. */
  async listarDocumentos(empresaId: number) {
    return this.prisma.leadDocumento.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
      select: this.docSelect,
    });
  }

  /** Crea un documento (texto o URL), lo indexa (RAG) y devuelve su estado. */
  async crearDocumento(
    empresaId: number,
    dto: { tipo: TipoLeadDocumento; titulo?: string; contenido?: string; url?: string },
  ) {
    let contenido = dto.contenido ?? '';
    let origen: string | null = null;

    if (dto.tipo === 'URL') {
      if (!dto.url) throw new BadRequestException('Falta la URL a entrenar');
      origen = dto.url;
      contenido = await this.extraerTextoUrl(dto.url);
    }
    if (!contenido.trim()) {
      throw new BadRequestException('El documento no tiene contenido para entrenar');
    }

    const doc = await this.prisma.leadDocumento.create({
      data: {
        empresaId,
        tipo: dto.tipo,
        titulo: dto.titulo?.trim() || origen || 'Documento',
        origen,
        contenido,
        estado: 'PENDIENTE',
      },
      select: { id: true },
    });

    await this.rag.indexarDocumento(doc.id, contenido);

    return this.prisma.leadDocumento.findUnique({
      where: { id: doc.id },
      select: this.docSelect,
    });
  }

  /** Elimina un documento y sus fragmentos (cascade). */
  async eliminarDocumento(empresaId: number, id: number) {
    const doc = await this.prisma.leadDocumento.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    await this.prisma.leadDocumento.delete({ where: { id } });
    return { ok: true };
  }

  /** Descarga una URL y extrae su texto plano (strip básico de HTML). */
  private async extraerTextoUrl(url: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new BadRequestException('No se pudo acceder a la URL');
    }
    if (!res.ok) {
      throw new BadRequestException(`La URL respondió ${res.status}`);
    }
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50000);
  }

  /** Lista de prospectos (leads) de la empresa, con filtros básicos. */
  async listarProspectos(
    empresaId: number,
    opts: { estado?: EstadoLeadProspecto; search?: string } = {},
  ) {
    const prospectos = await this.prisma.leadProspecto.findMany({
      where: {
        empresaId,
        ...(opts.estado ? { estado: opts.estado } : {}),
        ...(opts.search
          ? {
              OR: [
                { nombreProspecto: { contains: opts.search, mode: 'insensitive' } },
                { telefonoProspecto: { contains: opts.search } },
              ],
            }
          : {}),
      },
      orderBy: [{ puntaje: 'desc' }, { actualizadoEn: 'desc' }],
      take: 200,
    });

    // Adjunta el código de la cotización (COT que la IA generó desde el chat),
    // si existe, para mostrarla en el panel. cotizacionId es un Int suelto (sin
    // relación Prisma), así que se resuelve con una consulta secundaria.
    const cotizacionIds = prospectos
      .map((p) => p.cotizacionId)
      .filter((id): id is number => id != null);
    const cotizaciones = cotizacionIds.length
      ? await this.prisma.comprobante.findMany({
          where: { id: { in: cotizacionIds }, empresaId },
          select: { id: true, serie: true, correlativo: true },
        })
      : [];
    const codigoPorId = new Map(
      cotizaciones.map((c) => [
        c.id,
        `${c.serie}-${String(c.correlativo).padStart(8, '0')}`,
      ]),
    );

    return prospectos.map((p) => ({
      ...p,
      cotizacion:
        p.cotizacionId && codigoPorId.has(p.cotizacionId)
          ? { id: p.cotizacionId, codigo: codigoPorId.get(p.cotizacionId)! }
          : null,
    }));
  }

  /** Resumen por estado (para las tarjetas del dashboard). */
  async resumenProspectos(empresaId: number) {
    const grupos = await this.prisma.leadProspecto.groupBy({
      by: ['estado'],
      where: { empresaId },
      _count: { _all: true },
    });
    const base: Record<string, number> = {
      FRIO: 0, TIBIO: 0, CALIENTE: 0, CONVERTIDO: 0, PERDIDO: 0,
    };
    for (const g of grupos) base[g.estado] = g._count._all;
    return base;
  }

  /** Lista de conversaciones (chats) de la empresa. */
  async listarConversaciones(empresaId: number) {
    return this.prisma.leadConversacion.findMany({
      where: { empresaId },
      orderBy: { actualizadoEn: 'desc' },
      take: 200,
      include: { prospecto: { select: { puntaje: true, estado: true } } },
    });
  }

  /** Detalle de una conversación con sus mensajes. */
  async obtenerConversacion(empresaId: number, id: number) {
    const conv = await this.prisma.leadConversacion.findFirst({
      where: { id, empresaId },
      include: {
        mensajes: { orderBy: { creadoEn: 'asc' } },
        prospecto: true,
      },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    return conv;
  }

  /** Configuración de la IA de ventas de la empresa (toggle + contexto). */
  async obtenerConfig(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        iaVentasActiva: true,
        iaVentasContexto: true,
        iaVentasSeguimiento: true,
        iaVentasCotizacion: true,
        iaVentasBrochureUrl: true,
      },
    });
    return {
      iaVentasActiva: empresa?.iaVentasActiva ?? false,
      iaVentasContexto: empresa?.iaVentasContexto ?? '',
      iaVentasSeguimiento: empresa?.iaVentasSeguimiento ?? true,
      iaVentasCotizacion: empresa?.iaVentasCotizacion ?? false,
      iaVentasBrochureUrl: empresa?.iaVentasBrochureUrl ?? '',
    };
  }

  /** Actualiza el toggle y/o el contexto de negocio de la IA de ventas. */
  async actualizarConfig(
    empresaId: number,
    data: {
      iaVentasActiva?: boolean;
      iaVentasContexto?: string;
      iaVentasSeguimiento?: boolean;
      iaVentasCotizacion?: boolean;
      iaVentasBrochureUrl?: string;
    },
  ) {
    const empresa = await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        ...(data.iaVentasActiva !== undefined
          ? { iaVentasActiva: data.iaVentasActiva }
          : {}),
        ...(data.iaVentasContexto !== undefined
          ? { iaVentasContexto: data.iaVentasContexto }
          : {}),
        ...(data.iaVentasSeguimiento !== undefined
          ? { iaVentasSeguimiento: data.iaVentasSeguimiento }
          : {}),
        ...(data.iaVentasCotizacion !== undefined
          ? { iaVentasCotizacion: data.iaVentasCotizacion }
          : {}),
        ...(data.iaVentasBrochureUrl !== undefined
          ? { iaVentasBrochureUrl: data.iaVentasBrochureUrl.trim() || null }
          : {}),
      },
      select: {
        iaVentasActiva: true,
        iaVentasContexto: true,
        iaVentasSeguimiento: true,
        iaVentasCotizacion: true,
        iaVentasBrochureUrl: true,
      },
    });
    return {
      iaVentasActiva: empresa.iaVentasActiva,
      iaVentasContexto: empresa.iaVentasContexto ?? '',
      iaVentasSeguimiento: empresa.iaVentasSeguimiento,
      iaVentasCotizacion: empresa.iaVentasCotizacion,
      iaVentasBrochureUrl: empresa.iaVentasBrochureUrl ?? '',
    };
  }

  /** Activa/desactiva el bot para un prospecto (pausar la IA en ese chat). */
  async setBotActivo(empresaId: number, prospectoId: number, activo: boolean) {
    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { id: prospectoId, empresaId },
      select: { id: true },
    });
    if (!prospecto) throw new NotFoundException('Prospecto no encontrado');
    return this.prisma.leadProspecto.update({
      where: { id: prospectoId },
      data: { botActivo: activo },
    });
  }
}
