import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContratoVehicularDto } from './dto/create-contrato.dto';
import { UpdateContratoVehicularDto } from './dto/update-contrato.dto';
import { PdfGeneratorService } from '../comprobante/pdf-generator.service';
import { buildContratoHtml } from './contrato-pdf-html';

/** Suma N meses a una fecha sin dependencia externa */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

@Injectable()
export class ContratoVehicularService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfGenerator: PdfGeneratorService,
  ) {}

  private readonly INCLUDE_BASE = {
    vehiculo: {
      select: {
        id: true,
        placa: true,
        marca: true,
        modelo: true,
        color: true,
        cliente: {
          select: { id: true, nombre: true, telefono: true, email: true },
        },
      },
    },
    unidades: {
      orderBy: { id: 'asc' as const },
      include: {
        vehiculo: {
          select: {
            id: true,
            placa: true,
            marca: true,
            modelo: true,
            color: true,
            anio: true,
          },
        },
      },
    },
    producto: { select: { id: true, descripcion: true, precioUnitario: true } },
  };

  async findAll(
    empresaId: number,
    params: {
      estado?: string;
      search?: string;
      page?: number;
      limit?: number;
      soloProximosVencer?: boolean;
    },
  ) {
    const { estado, search, page = 1, limit = 30, soloProximosVencer } = params;
    const skip = (page - 1) * limit;

    const where: any = { empresaId };

    if (estado && estado !== 'TODOS') {
      where.estado = estado;
    }

    if (soloProximosVencer) {
      const en30dias = new Date();
      en30dias.setDate(en30dias.getDate() + 30);
      where.fechaFin = { lte: en30dias };
      where.estado = { not: 'CANCELADO' };
    }

    if (search) {
      where.OR = [
        {
          vehiculo: {
            OR: [
              {
                placa: { contains: search.toUpperCase(), mode: 'insensitive' },
              },
              { marca: { contains: search, mode: 'insensitive' } },
              {
                cliente: { nombre: { contains: search, mode: 'insensitive' } },
              },
            ],
          },
        },
        // También busca por placa de cualquier vehículo del contrato.
        {
          unidades: {
            some: {
              vehiculo: {
                placa: { contains: search.toUpperCase(), mode: 'insensitive' },
              },
            },
          },
        },
      ];
    }

    const [total, contratos] = await Promise.all([
      this.prisma.contratoVehicular.count({ where }),
      this.prisma.contratoVehicular.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaFin: 'asc' },
        include: this.INCLUDE_BASE,
      }),
    ]);

    return {
      data: contratos,
      paginacion: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findAlertas(empresaId: number) {
    const en30dias = new Date();
    en30dias.setDate(en30dias.getDate() + 30);

    return this.prisma.contratoVehicular.findMany({
      where: {
        empresaId,
        estado: { in: ['VIGENTE', 'POR_VENCER'] },
        fechaFin: { lte: en30dias },
      },
      orderBy: { fechaFin: 'asc' },
      include: this.INCLUDE_BASE,
    });
  }

  async create(empresaId: number, dto: CreateContratoVehicularDto) {
    // Normaliza la entrada a una lista de { vehiculoId, montoAnual }.
    // Soporta la forma nueva (`vehiculos[]`) y la antigua (`vehiculoId`).
    const items = (
      dto.vehiculos?.length
        ? dto.vehiculos
        : dto.vehiculoId != null
          ? [{ vehiculoId: dto.vehiculoId, montoAnual: dto.montoAnual }]
          : []
    ).map((v) => ({
      vehiculoId: Number(v.vehiculoId),
      montoAnual: v.montoAnual != null ? Number(v.montoAnual) : null,
    }));

    if (!items.length)
      throw new NotFoundException('Debes seleccionar al menos un vehículo');

    // Deduplica por si se repite un vehículo en la lista.
    const vistos = new Set<number>();
    const unidades = items.filter((v) => {
      if (vistos.has(v.vehiculoId)) return false;
      vistos.add(v.vehiculoId);
      return true;
    });
    const ids = unidades.map((v) => v.vehiculoId);

    // Todos los vehículos deben pertenecer a la empresa.
    const vehiculos = await this.prisma.vehiculo.findMany({
      where: { id: { in: ids }, empresaId },
      select: { id: true, placa: true },
    });
    if (vehiculos.length !== ids.length) {
      const encontrados = new Set(vehiculos.map((v) => v.id));
      const faltan = ids.filter((id) => !encontrados.has(id));
      throw new NotFoundException(
        `Vehículo(s) no encontrado(s): ${faltan.join(', ')}`,
      );
    }

    // Ningún vehículo puede estar en otro contrato activo (como principal o
    // como unidad de un contrato multi-vehículo).
    const activos = await this.prisma.contratoVehicular.findMany({
      where: {
        empresaId,
        estado: { in: ['VIGENTE', 'POR_VENCER'] },
        OR: [
          { vehiculoId: { in: ids } },
          { unidades: { some: { vehiculoId: { in: ids } } } },
        ],
      },
      include: {
        vehiculo: { select: { id: true, placa: true } },
        unidades: { select: { vehiculoId: true } },
      },
    });
    if (activos.length) {
      const ocupados = new Set<number>();
      for (const c of activos) {
        ocupados.add(c.vehiculoId);
        for (const u of c.unidades) ocupados.add(u.vehiculoId);
      }
      const placas = vehiculos
        .filter((v) => ocupados.has(v.id))
        .map((v) => v.placa);
      throw new ConflictException(
        `Ya existe un contrato activo para: ${placas.join(', ')}. Renuévalo o cancélalo antes de crear otro.`,
      );
    }

    const fechaInicio = new Date(dto.fechaInicio);
    const duracion = dto.duracionMeses ?? 12;
    const fechaFin = addMonths(fechaInicio, duracion);

    // Calcular estado inicial
    const hoy = new Date();
    const diasRestantes = Math.ceil(
      (fechaFin.getTime() - hoy.getTime()) / 86400000,
    );
    const estado =
      diasRestantes < 0
        ? 'VENCIDO'
        : diasRestantes <= 30
          ? 'POR_VENCER'
          : 'VIGENTE';

    // Monto total del contrato = suma de montos por unidad (si se especificaron),
    // con respaldo en el `montoAnual` global enviado.
    const sumaUnidades = unidades.reduce(
      (acc, v) => acc + (v.montoAnual ?? 0),
      0,
    );
    const montoTotal =
      sumaUnidades > 0 ? sumaUnidades : (dto.montoAnual ?? null);

    const contrato = await this.prisma.contratoVehicular.create({
      data: {
        empresaId,
        vehiculoId: unidades[0].vehiculoId, // principal = primero
        productoId: dto.productoId,
        fechaInicio,
        fechaFin,
        estado,
        montoAnual: montoTotal,
        observaciones: dto.observaciones,
        unidades: {
          create: unidades.map((v) => ({
            vehiculoId: v.vehiculoId,
            montoAnual: v.montoAnual,
          })),
        },
      },
      include: this.INCLUDE_BASE,
    });

    // Notifica al propietario que su contrato fue generado. No bloquea la
    // respuesta: si falla el envío, el contrato ya quedó creado igualmente.
    this.enviarEmailContratoGenerado(empresaId, contrato).catch(() => {
      /* silencioso: el correo es best-effort */
    });

    return contrato;
  }

  /**
   * Envía el correo de "contrato generado" al propietario (cliente) y también,
   * con copia, al correo de la empresa (usuario administrador). Best-effort.
   */
  private async enviarEmailContratoGenerado(
    empresaId: number,
    contrato: any,
  ): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;

    const cliente = contrato?.vehiculo?.cliente;
    const clienteEmail: string | undefined = cliente?.email?.trim() || undefined;

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        razonSocial: true,
        nombreComercial: true,
        brand: true,
        ruc: true,
        direccion: true,
      },
    });
    // Correo del negocio = correo del usuario administrador de la empresa.
    const admin = await this.prisma.usuario.findFirst({
      where: { empresaId, rol: 'ADMIN_EMPRESA' },
      select: { email: true },
      orderBy: { id: 'asc' },
    });
    const empresaEmail: string | undefined = admin?.email?.trim() || undefined;

    // Si no hay ningún destinatario válido, no se envía nada.
    if (!clienteEmail && !empresaEmail) return;

    const negocioNombre =
      empresa?.nombreComercial || empresa?.razonSocial || undefined;
    const appName = empresa?.brand === 'krezka' ? 'Krezka' : 'Falconext';

    const fmtFecha = (d: Date) =>
      new Intl.DateTimeFormat('es-PE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(d));
    const montoAnual =
      contrato.montoAnual != null
        ? `S/ ${Number(contrato.montoAnual).toFixed(2)}`
        : undefined;

    // Lista de vehículos del contrato (desde las unidades; respaldo al principal).
    const fmtMonto = (m: any) =>
      m != null ? `S/ ${Number(m).toFixed(2)}` : undefined;
    const vehiculos: {
      placa: string;
      desc?: string;
      monto?: string;
    }[] =
      Array.isArray(contrato.unidades) && contrato.unidades.length
        ? contrato.unidades.map((u: any) => ({
            placa: u.vehiculo?.placa || '',
            desc:
              `${u.vehiculo?.marca ?? ''} ${u.vehiculo?.modelo ?? ''}`.trim() ||
              undefined,
            monto: fmtMonto(u.montoAnual),
          }))
        : [
            {
              placa: contrato.vehiculo?.placa || '',
              desc:
                `${contrato.vehiculo?.marca ?? ''} ${contrato.vehiculo?.modelo ?? ''}`.trim() ||
                undefined,
              monto: montoAnual,
            },
          ];

    const { Resend } = await import('resend');
    const { render } = await import('@react-email/components');
    const { ContratoGeneradoEmail } = await import(
      './emails/ContratoGeneradoEmail'
    );

    const html = await render(
      ContratoGeneradoEmail({
        destinatarioNombre: cliente?.nombre || 'Estimado cliente',
        vehiculos,
        servicio: contrato.producto?.descripcion || undefined,
        fechaInicio: fmtFecha(contrato.fechaInicio),
        fechaVencimiento: fmtFecha(contrato.fechaFin),
        montoAnual,
        observaciones: contrato.observaciones || undefined,
        negocioNombre,
        appName,
      }) as any,
    );

    const fromEmail =
      process.env.RESEND_FROM_EMAIL ||
      process.env.MAIL_FROM ||
      'noreply@falconext.pe';
    // Destinatario principal = cliente; si no tiene correo, va directo a la
    // empresa. La empresa recibe copia (cc) cuando el principal es el cliente.
    const to = clienteEmail ? [clienteEmail] : [empresaEmail as string];
    const cc =
      clienteEmail && empresaEmail && empresaEmail !== clienteEmail
        ? [empresaEmail]
        : undefined;

    // Genera el PDF del contrato para adjuntarlo. Best-effort: si falla, el
    // correo se envía igualmente sin adjunto.
    let attachments:
      | { filename: string; content: Buffer; contentType: string }[]
      | undefined;
    try {
      const estadoLabels: Record<string, string> = {
        VIGENTE: 'Vigente',
        POR_VENCER: 'Por vencer',
        VENCIDO: 'Vencido',
        CANCELADO: 'Cancelado',
      };
      const pdfVehiculos =
        Array.isArray(contrato.unidades) && contrato.unidades.length
          ? contrato.unidades.map((u: any) => ({
              placa: u.vehiculo?.placa || '',
              marca: u.vehiculo?.marca,
              modelo: u.vehiculo?.modelo,
              color: u.vehiculo?.color,
              anio: u.vehiculo?.anio,
              montoAnual: u.montoAnual != null ? Number(u.montoAnual) : null,
            }))
          : [
              {
                placa: contrato.vehiculo?.placa || '',
                marca: contrato.vehiculo?.marca,
                modelo: contrato.vehiculo?.modelo,
                color: contrato.vehiculo?.color,
                anio: null,
                montoAnual:
                  contrato.montoAnual != null
                    ? Number(contrato.montoAnual)
                    : null,
              },
            ];
      const pdfHtml = buildContratoHtml({
        numero: contrato.id,
        estado: estadoLabels[contrato.estado] || contrato.estado,
        servicio: contrato.producto?.descripcion || undefined,
        fechaInicio: contrato.fechaInicio,
        fechaFin: contrato.fechaFin,
        montoTotalAnual:
          contrato.montoAnual != null ? Number(contrato.montoAnual) : null,
        observaciones: contrato.observaciones || undefined,
        cliente,
        vehiculos: pdfVehiculos,
        empresa: {
          razonSocial: empresa?.razonSocial,
          nombreComercial: empresa?.nombreComercial,
          ruc: empresa?.ruc,
          direccion: empresa?.direccion,
        },
      });
      const pdfBuffer = await this.pdfGenerator.generarPdfDesdeHtml(pdfHtml);
      attachments = [
        {
          filename: `Contrato-${contrato.id}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ];
    } catch {
      /* silencioso: se envía el correo sin PDF adjunto */
    }

    const resend = new Resend(resendKey);
    await resend.emails.send({
      from: `${negocioNombre || appName} <${fromEmail}>`,
      to,
      cc,
      subject:
        vehiculos.length > 1
          ? `📄 Contrato generado — ${vehiculos.length} vehículos`
          : `📄 Contrato generado — Vehículo ${vehiculos[0]?.placa || ''}`,
      html,
      attachments,
    });
  }

  // Edición manual del contrato (por ejemplo, para corregir una renovación hecha por error).
  async update(
    id: number,
    empresaId: number,
    dto: UpdateContratoVehicularDto,
  ) {
    const contrato = await this.prisma.contratoVehicular.findFirst({
      where: { id, empresaId },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const data: any = {};
    if (dto.productoId !== undefined) data.productoId = dto.productoId;
    if (dto.montoAnual !== undefined) data.montoAnual = dto.montoAnual;
    if (dto.observaciones !== undefined) data.observaciones = dto.observaciones;

    // Si cambian la fecha de inicio o la duración, recalculamos fecha fin y estado.
    if (dto.fechaInicio !== undefined || dto.duracionMeses !== undefined) {
      const fechaInicio = dto.fechaInicio
        ? new Date(dto.fechaInicio)
        : contrato.fechaInicio;
      const duracion = dto.duracionMeses ?? 12;
      const fechaFin = addMonths(fechaInicio, duracion);
      data.fechaInicio = fechaInicio;
      data.fechaFin = fechaFin;

      // No revivimos un contrato cancelado; el resto se recalcula por fecha.
      if (contrato.estado !== 'CANCELADO') {
        const dias = Math.ceil(
          (fechaFin.getTime() - new Date().getTime()) / 86400000,
        );
        data.estado =
          dias < 0 ? 'VENCIDO' : dias <= 30 ? 'POR_VENCER' : 'VIGENTE';
      }
    }

    return this.prisma.contratoVehicular.update({
      where: { id },
      data,
      include: this.INCLUDE_BASE,
    });
  }

  async remove(id: number, empresaId: number) {
    const contrato = await this.prisma.contratoVehicular.findFirst({
      where: { id, empresaId },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    return this.prisma.contratoVehicular.delete({ where: { id } });
  }

  async renovar(id: number, empresaId: number, meses = 12) {
    const contrato = await this.prisma.contratoVehicular.findFirst({
      where: { id, empresaId },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    if (contrato.estado === 'CANCELADO')
      throw new ConflictException(
        'No se puede renovar un contrato cancelado. Crea uno nuevo.',
      );

    // La nueva fecha de inicio es la fecha fin del contrato actual (o hoy si ya venció)
    const base =
      contrato.fechaFin > new Date() ? contrato.fechaFin : new Date();
    const nuevaFechaFin = addMonths(base, meses > 0 ? meses : 12);

    return this.prisma.contratoVehicular.update({
      where: { id },
      data: {
        fechaInicio: base,
        fechaFin: nuevaFechaFin,
        estado: 'VIGENTE',
      },
      include: this.INCLUDE_BASE,
    });
  }

  async cancelar(id: number, empresaId: number) {
    const contrato = await this.prisma.contratoVehicular.findFirst({
      where: { id, empresaId },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    if (contrato.estado === 'CANCELADO')
      throw new ConflictException('El contrato ya está cancelado.');

    return this.prisma.contratoVehicular.update({
      where: { id },
      data: { estado: 'CANCELADO' },
      include: this.INCLUDE_BASE,
    });
  }

  /**
   * Llamado por el scheduler diariamente.
   * Marca como VENCIDO los contratos pasados, POR_VENCER los próximos 30 días.
   */
  async actualizarEstados() {
    const hoy = new Date();
    const en30dias = new Date();
    en30dias.setDate(en30dias.getDate() + 30);

    // Marcar VENCIDOS
    const vencidos = await this.prisma.contratoVehicular.updateMany({
      where: {
        fechaFin: { lt: hoy },
        estado: { in: ['VIGENTE', 'POR_VENCER'] },
      },
      data: { estado: 'VENCIDO' },
    });

    // Marcar POR_VENCER
    const porVencer = await this.prisma.contratoVehicular.updateMany({
      where: {
        fechaFin: { gte: hoy, lte: en30dias },
        estado: 'VIGENTE',
      },
      data: { estado: 'POR_VENCER' },
    });

    return { vencidos: vencidos.count, porVencer: porVencer.count };
  }
}
