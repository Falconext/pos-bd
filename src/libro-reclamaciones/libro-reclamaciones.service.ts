import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PdfGeneratorService } from '../comprobante/pdf-generator.service';
import {
  LibroReclamacionesAvisosService,
  ResumenVencimientos,
} from './libro-reclamaciones-avisos.service';
import {
  anioLima,
  calcularFechaLimite,
  diaDeFecha,
  finDelDiaLima,
  umbralPorVencer,
} from './dias-habiles';
import {
  CODIGO_RE,
  EstadoReclamacion,
  FilaReclamacion,
  HojaEntrada,
  Reclamo,
  aReclamo,
  direccionCompleta,
  formatearCodigo,
  generarTokenConstancia,
  hashToken,
  validarHoja,
  validarRespuesta,
  verificarTokenConstancia,
} from './libro-reclamaciones.reglas';
import { excelLibro, htmlConstancia } from './libro-reclamaciones.documentos';

const INCLUIR = {
  respondidoPor: { select: { id: true, nombre: true } },
} as const;

export interface FiltrosListado {
  estado?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

export interface RegistroCreado {
  codigo: string;
  fecha: Date;
  fechaLimite: Date;
  token: string;
}

/** Máximo de filas en una exportación (un libro de 2 años de una MYPE cabe de sobra). */
const MAX_EXPORTACION = 20_000;

@Injectable()
export class LibroReclamacionesService {
  private readonly logger = new Logger(LibroReclamacionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfGeneratorService,
    private readonly avisos: LibroReclamacionesAvisosService,
  ) {}

  // ==================== PÚBLICO ====================

  private async empresaPorSlug(slug: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: String(slug ?? '') },
      select: {
        id: true,
        ruc: true,
        razonSocial: true,
        nombreComercial: true,
        direccion: true,
        distrito: true,
        provincia: true,
        departamento: true,
        logo: true,
      },
    });
    if (!empresa) throw new NotFoundException('Tienda no encontrada');
    return empresa;
  }

  async proveedorPublico(slug: string) {
    const e = await this.empresaPorSlug(slug);
    return {
      proveedor: {
        razonSocial: e.razonSocial,
        ruc: e.ruc,
        direccion: direccionCompleta(e),
        nombreComercial: e.nombreComercial ?? null,
        logo: e.logo ?? null,
      },
    };
  }

  /**
   * Registra la hoja. El correlativo sale de un contador por empresa+año que se
   * incrementa con `INSERT … ON CONFLICT DO UPDATE` dentro de la MISMA
   * transacción que crea la hoja: Postgres bloquea la fila del contador hasta
   * el commit (dos registros simultáneos se forman en fila) y, si la creación
   * falla, el incremento se deshace y el número no se pierde.
   */
  async registrar(
    slug: string,
    entrada: HojaEntrada,
    origen: { ip?: string | null; userAgent?: string | null },
    ahora: Date = new Date(),
  ): Promise<RegistroCreado> {
    const hoja = validarHoja(entrada ?? {});
    const empresa = await this.empresaPorSlug(slug);
    const anio = anioLima(ahora);
    const fechaLimite = calcularFechaLimite(ahora);
    const token = generarTokenConstancia();

    const fila = await this.prisma.$transaction(async (tx) => {
      const [{ ultimo }] = await tx.$queryRaw<{ ultimo: number }[]>`
        INSERT INTO "LibroReclamacionContador" ("empresaId", "anio", "ultimo")
        VALUES (${empresa.id}, ${anio}, 1)
        ON CONFLICT ("empresaId", "anio")
        DO UPDATE SET "ultimo" = "LibroReclamacionContador"."ultimo" + 1
        RETURNING "ultimo"`;
      const correlativo = Number(ultimo);
      return tx.libroReclamacion.create({
        data: {
          empresaId: empresa.id,
          anio,
          correlativo,
          codigo: formatearCodigo(anio, correlativo),
          ...hoja,
          montoReclamado:
            hoja.montoReclamado === null
              ? null
              : new Prisma.Decimal(hoja.montoReclamado.toFixed(2)),
          proveedorRazonSocial: empresa.razonSocial,
          proveedorRuc: empresa.ruc,
          proveedorDireccion: direccionCompleta(empresa),
          proveedorNombreComercial: empresa.nombreComercial ?? null,
          tokenHash: hashToken(token),
          ip: origen.ip ? String(origen.ip).slice(0, 64) : null,
          userAgent: origen.userAgent
            ? String(origen.userAgent).slice(0, 400)
            : null,
          fecha: ahora,
          fechaLimite,
        },
        include: INCLUIR,
      });
    });

    const reclamo = aReclamo(fila as FilaReclamacion, ahora);
    // Los avisos van después del commit y sin esperar: un correo caído no
    // puede impedir que la hoja quede registrada.
    void this.avisos
      .alRegistrar(empresa.id, reclamo, () =>
        this.generarPdf(reclamo, empresa.logo),
      )
      .catch((e) =>
        this.logger.error(
          `Avisos de la hoja ${reclamo.codigo}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );

    return {
      codigo: reclamo.codigo,
      fecha: reclamo.fecha,
      fechaLimite: reclamo.fechaLimite,
      token,
    };
  }

  /** Constancia pública: solo con el token que se entregó al registrar. */
  async constanciaPublica(
    slug: string,
    codigo: string,
    token: unknown,
  ): Promise<{ codigo: string; pdf: Buffer }> {
    const noEncontrada = new NotFoundException(
      'Hoja de reclamación no encontrada',
    );
    if (!CODIGO_RE.test(String(codigo ?? ''))) throw noEncontrada;
    const empresa = await this.empresaPorSlug(slug);
    const fila = await this.prisma.libroReclamacion.findUnique({
      where: { empresaId_codigo: { empresaId: empresa.id, codigo } },
      include: INCLUIR,
    });
    // Mismo 404 si no existe o si el token no coincide: no se puede sondear qué códigos existen.
    if (!fila || !verificarTokenConstancia(token, fila.tokenHash))
      throw noEncontrada;
    const reclamo = aReclamo(fila as FilaReclamacion);
    return {
      codigo: reclamo.codigo,
      pdf: await this.generarPdf(reclamo, empresa.logo),
    };
  }

  // ==================== PANEL ====================

  private whereEstado(
    estado: string | undefined,
    ahora: Date,
  ): Prisma.LibroReclamacionWhereInput {
    switch (estado) {
      case 'PENDIENTE':
        return { estado: 'PENDIENTE', fechaLimite: { gte: ahora } };
      case 'VENCIDO':
        return { estado: 'PENDIENTE', fechaLimite: { lt: ahora } };
      case 'RESPONDIDO':
        return { estado: 'RESPONDIDO' };
      case undefined:
      case '':
        return {};
      default:
        throw new BadRequestException(
          'Estado inválido: usa PENDIENTE, RESPONDIDO o VENCIDO.',
        );
    }
  }

  async listar(
    empresaId: number,
    filtros: FiltrosListado,
    ahora: Date = new Date(),
  ) {
    const page = Math.max(1, Math.floor(Number(filtros.page) || 1));
    const limit = Math.min(
      100,
      Math.max(1, Math.floor(Number(filtros.limit) || 20)),
    );
    const search = String(filtros.search ?? '')
      .trim()
      .slice(0, 100);
    const estado = filtros.estado
      ? String(filtros.estado).toUpperCase()
      : undefined;

    const where: Prisma.LibroReclamacionWhereInput = {
      empresaId,
      ...this.whereEstado(estado, ahora),
      ...(search
        ? {
            OR: [
              { codigo: { contains: search, mode: 'insensitive' } },
              { nombres: { contains: search, mode: 'insensitive' } },
              { numeroDocumento: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { pedidoCodigo: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const umbral = umbralPorVencer(ahora);
    const [filas, total, pendientes, vencidos, porVencer, respondidos] =
      await Promise.all([
        this.prisma.libroReclamacion.findMany({
          where,
          include: INCLUIR,
          orderBy: { fecha: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.libroReclamacion.count({ where }),
        this.prisma.libroReclamacion.count({
          where: {
            empresaId,
            estado: 'PENDIENTE',
            fechaLimite: { gte: ahora },
          },
        }),
        this.prisma.libroReclamacion.count({
          where: { empresaId, estado: 'PENDIENTE', fechaLimite: { lt: ahora } },
        }),
        this.prisma.libroReclamacion.count({
          where: {
            empresaId,
            estado: 'PENDIENTE',
            fechaLimite: { gte: ahora, lte: umbral },
          },
        }),
        this.prisma.libroReclamacion.count({
          where: { empresaId, estado: 'RESPONDIDO' },
        }),
      ]);

    return {
      data: filas.map((f) => aReclamo(f as FilaReclamacion, ahora)),
      total,
      resumen: { pendientes, vencidos, porVencer, respondidos },
    };
  }

  private async fila(empresaId: number, id: number) {
    const fila = await this.prisma.libroReclamacion.findFirst({
      where: { id, empresaId },
      include: INCLUIR,
    });
    if (!fila) throw new NotFoundException('Hoja de reclamación no encontrada');
    return fila as FilaReclamacion;
  }

  async obtener(empresaId: number, id: number): Promise<Reclamo> {
    return aReclamo(await this.fila(empresaId, id));
  }

  /**
   * La respuesta se registra UNA sola vez. El `updateMany` condicionado a que
   * siga pendiente y sin respuesta es atómico: dos usuarios que responden a la
   * vez no se pisan, el segundo recibe 409.
   */
  async responder(
    empresaId: number,
    id: number,
    usuarioId: number,
    valor: unknown,
  ): Promise<Reclamo> {
    const respuesta = validarRespuesta(valor);
    const { count } = await this.prisma.libroReclamacion.updateMany({
      where: { id, empresaId, estado: 'PENDIENTE', respuesta: null },
      data: {
        estado: 'RESPONDIDO',
        respuesta,
        fechaRespuesta: new Date(),
        respondidoPorId: usuarioId,
      },
    });
    if (count === 0) {
      await this.fila(empresaId, id); // 404 si no es de esta empresa
      throw new ConflictException(
        'Esta hoja ya fue respondida; la respuesta no se puede cambiar.',
      );
    }
    const reclamo = aReclamo(await this.fila(empresaId, id));
    void this.avisos
      .alResponder(reclamo)
      .catch((e) =>
        this.logger.error(
          `Aviso de respuesta ${reclamo.codigo}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    return reclamo;
  }

  async constanciaPanel(
    empresaId: number,
    id: number,
  ): Promise<{ codigo: string; pdf: Buffer }> {
    const reclamo = await this.obtener(empresaId, id);
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { logo: true },
    });
    return {
      codigo: reclamo.codigo,
      pdf: await this.generarPdf(reclamo, empresa?.logo),
    };
  }

  /** `desde`/`hasta` en YYYY-MM-DD (días de Lima, ambos inclusive). */
  async exportar(
    empresaId: number,
    desde?: string,
    hasta?: string,
  ): Promise<Buffer> {
    const rango = (valor: string | undefined, campo: string): number | null => {
      if (!valor) return null;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
      if (!m)
        throw new BadRequestException(
          `${campo} debe tener el formato AAAA-MM-DD.`,
        );
      return diaDeFecha(Number(m[1]), Number(m[2]), Number(m[3]));
    };
    const d = rango(desde, 'desde');
    const h = rango(hasta, 'hasta');
    if (d !== null && h !== null && d > h) {
      throw new BadRequestException(
        'La fecha "desde" no puede ser posterior a "hasta".',
      );
    }
    const fecha: Prisma.DateTimeFilter = {};
    if (d !== null) fecha.gte = new Date(finDelDiaLima(d - 1).getTime() + 1);
    if (h !== null) fecha.lte = finDelDiaLima(h);

    const filas = await this.prisma.libroReclamacion.findMany({
      where: { empresaId, ...(d !== null || h !== null ? { fecha } : {}) },
      include: INCLUIR,
      orderBy: [{ anio: 'asc' }, { correlativo: 'asc' }],
      take: MAX_EXPORTACION,
    });
    const ahora = new Date();
    return excelLibro(filas.map((f) => aReclamo(f as FilaReclamacion, ahora)));
  }

  // ==================== AVISO DIARIO ====================

  /** Agrupa por empresa las hojas vencidas y por vencer y avisa a cada dueño. */
  async avisarVencimientos(
    ahora: Date = new Date(),
  ): Promise<ResumenVencimientos[]> {
    const filas = await this.prisma.libroReclamacion.findMany({
      where: {
        estado: 'PENDIENTE',
        fechaLimite: { lte: umbralPorVencer(ahora) },
      },
      select: { empresaId: true, codigo: true, fechaLimite: true },
      orderBy: { fechaLimite: 'asc' },
    });
    const porEmpresa = new Map<number, ResumenVencimientos>();
    for (const f of filas) {
      const r = porEmpresa.get(f.empresaId) ?? {
        empresaId: f.empresaId,
        vencidos: [],
        porVencer: [],
      };
      const estado: EstadoReclamacion =
        f.fechaLimite.getTime() < ahora.getTime() ? 'VENCIDO' : 'PENDIENTE';
      (estado === 'VENCIDO' ? r.vencidos : r.porVencer).push(f.codigo);
      porEmpresa.set(f.empresaId, r);
    }
    const resumenes = [...porEmpresa.values()];
    for (const r of resumenes) {
      await this.avisos.avisarVencimientos(r);
    }
    return resumenes;
  }

  private generarPdf(reclamo: Reclamo, logo?: string | null): Promise<Buffer> {
    return this.pdf.generarPdfDesdeHtml(htmlConstancia(reclamo, logo), '14mm');
  }
}
