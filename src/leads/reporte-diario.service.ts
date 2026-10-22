import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { DashboardService } from '../dashboard/dashboard.service';
import {
  DatosReporte,
  PLANTILLA_RESUMEN_DIA,
  armarReporte,
  empresaKrezkaId,
} from './reporte-diario';

interface ConfigReporte {
  activo?: boolean;
  /** Último día (Lima) en que salió: evita mandarlo dos veces. */
  ultimoEnvio?: string;
}

/** "YYYY-MM-DD" en Lima, `dias` antes de `fecha`. */
export function fechaLima(fecha = new Date(), dias = 0): string {
  const d = new Date(fecha.getTime() - dias * 24 * 3600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);
}

/** Celular peruano a 51XXXXXXXXX; lo que no es celular no sirve. */
export function celularParaWhatsapp(v: string | null | undefined): string | null {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('51')) d = d.slice(2);
  return /^9\d{8}$/.test(d) ? `51${d}` : null;
}

/**
 * Reporte diario por WhatsApp al dueño (ver reporte-diario.ts).
 *
 * Sale del número de Krezka y no del de cada negocio: así le llega a todo el
 * que tiene IA de Ventas, haya conectado su WhatsApp o no, y la plantilla se
 * aprueba una sola vez.
 */
@Injectable()
export class ReporteDiarioService {
  private readonly logger = new Logger(ReporteDiarioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly dashboard: DashboardService,
  ) {}

  private async configDe(empresaId: number): Promise<ConfigReporte> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true },
    });
    return ((e?.iaVentasConfigJson as Record<string, unknown>)?.reporteDiario ?? {}) as ConfigReporte;
  }

  private async guardarConfig(empresaId: number, cambios: ConfigReporte) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true },
    });
    const json = { ...((e?.iaVentasConfigJson as Record<string, unknown>) ?? {}) };
    json.reporteDiario = { ...((json.reporteDiario as ConfigReporte) ?? {}), ...cambios };
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { iaVentasConfigJson: json as never },
    });
  }

  /** Quiénes lo reciben: los administradores con un celular válido. */
  async destinatarios(empresaId: number) {
    const admins = await this.prisma.usuario.findMany({
      where: { empresaId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' as never },
      select: { nombre: true, celular: true },
    });
    const vistos = new Set<string>();
    return admins.flatMap((a) => {
      const numero = celularParaWhatsapp(a.celular);
      if (!numero || vistos.has(numero)) return [];
      vistos.add(numero);
      return [{ nombre: a.nombre, numero }];
    });
  }

  /** Lo que ve el panel. */
  async estado(empresaId: number) {
    const [config, destinatarios] = await Promise.all([
      this.configDe(empresaId),
      this.destinatarios(empresaId),
    ]);
    return {
      activo: config.activo === true,
      hora: '21:00',
      ultimoEnvio: config.ultimoEnvio ?? null,
      destinatarios: destinatarios.map((d) => ({
        nombre: d.nombre,
        numero: `${d.numero.slice(2, 5)} ${d.numero.slice(5, 8)} ${d.numero.slice(8)}`,
      })),
    };
  }

  async activar(empresaId: number, activo: boolean) {
    if (activo && (await this.destinatarios(empresaId)).length === 0) {
      throw new BadRequestException(
        'Ningún administrador tiene un celular válido. Agrégalo en Usuarios para recibir el reporte.',
      );
    }
    await this.guardarConfig(empresaId, { activo });
    // La plantilla vive en la cuenta de Krezka. Crearla es idempotente; se
    // pide al activar para que esté aprobada cuando salga el primero.
    if (activo) {
      this.whatsapp
        .crearPlantillaResumenDia(empresaKrezkaId())
        .catch((e) => this.logger.warn(`Plantilla ${PLANTILLA_RESUMEN_DIA}: ${e?.message}`));
    }
    return this.estado(empresaId);
  }

  /** Los números del día de una empresa. */
  async datos(empresaId: number, fecha: string): Promise<DatosReporte> {
    const ayer = fechaLima(new Date(`${fecha}T12:00:00-05:00`), 1);
    const desde = new Date(`${fecha}T00:00:00-05:00`);
    const hasta = new Date(`${fecha}T23:59:59.999-05:00`);
    const enElDia = { gte: desde, lte: hasta };

    const [empresa, hoy, deAyer, ventas, top, conversacionesNuevas, pedidos, pausadas, porDespachar] =
      await Promise.all([
        this.prisma.empresa.findUnique({
          where: { id: empresaId },
          select: { nombreComercial: true, razonSocial: true },
        }),
        this.dashboard.headerResumen(empresaId, fecha, fecha),
        this.dashboard.headerResumen(empresaId, ayer, ayer),
        this.dashboard.cantidadVentas(empresaId, fecha, fecha),
        this.dashboard.topProductos(empresaId, fecha, fecha, 3),
        this.prisma.leadConversacion.count({
          where: { empresaId, creadoEn: enElDia, prospecto: { isNot: null } },
        }),
        this.prisma.leadPedidoBorrador.findMany({
          where: { empresaId, comprobanteId: { not: null }, registradoEn: enElDia },
          select: { comprobanteId: true },
        }),
        // Chats donde la IA está callada (alguien los tomó o se derivaron).
        this.prisma.leadConversacion.findMany({
          where: { empresaId, botActivo: false, estado: { not: 'CERRADA' }, prospecto: { isNot: null } },
          select: { id: true },
          take: 200,
        }),
        this.prisma.envioDespacho.count({
          where: { estado: 'PREPARANDO', comprobante: { empresaId, estadoEnvioSunat: { not: 'ANULADO' as never } } },
        }),
      ]);

    const idsPedidos = pedidos.map((p) => p.comprobanteId as number);
    const comprobantes = idsPedidos.length
      ? await this.prisma.comprobante.findMany({
          where: { id: { in: idsPedidos }, empresaId },
          select: { mtoImpVenta: true, estadoPago: true, estadoEnvioSunat: true },
        })
      : [];
    const vigentes = comprobantes.filter(
      (c) => String(c.estadoPago) !== 'ANULADO' && String(c.estadoEnvioSunat) !== 'ANULADO',
    );

    // Esperan a una persona: la IA está callada y lo último lo escribió el cliente.
    let esperandoPersona = 0;
    for (const c of pausadas) {
      const ultimo = await this.prisma.leadMensaje.findFirst({
        where: { conversacionId: c.id },
        orderBy: { id: 'desc' },
        select: { rol: true },
      });
      if (ultimo?.rol === 'USUARIO') esperandoPersona++;
    }

    return {
      negocio: empresa?.nombreComercial?.trim() || empresa?.razonSocial || 'tu negocio',
      fecha,
      vendido: Number(hoy.totalIngresos ?? 0),
      ventas,
      vendidoAyer: Number(deAyer.totalIngresos ?? 0),
      top: (top ?? []).map((t: any) => ({
        descripcion: String(t.producto?.descripcion ?? 'Producto'),
        cantidad: Number(t.cantidad ?? 0),
      })),
      chat: {
        conversacionesNuevas,
        pedidos: vigentes.length,
        vendidoPorChat: vigentes.reduce((a, c) => a + Number(c.mtoImpVenta ?? 0), 0),
        esperandoPersona,
      },
      porDespachar,
    };
  }

  /**
   * Manda el reporte de una empresa a sus administradores. Texto libre si el
   * dueño le escribió a Krezka en las últimas 24 h; si no, la plantilla.
   */
  async enviar(
    empresaId: number,
    fecha = fechaLima(),
  ): Promise<{ enviados: number; fallidos: number; motivo?: string; error?: string }> {
    const destinatarios = await this.destinatarios(empresaId);
    if (!destinatarios.length) return { enviados: 0, fallidos: 0, motivo: 'sin celulares válidos' };
    const { texto, parametros } = armarReporte(await this.datos(empresaId, fecha));
    const krezka = empresaKrezkaId();

    let enviados = 0;
    let fallidos = 0;
    let error: string | undefined;
    for (const d of destinatarios) {
      const r = await this.whatsapp.enviarTexto(d.numero, texto, krezka).catch((e) => ({
        success: false,
        error: e?.message,
      }));
      if (r.success) {
        enviados++;
        continue;
      }
      const p = await this.whatsapp
        .enviarPlantilla(d.numero, PLANTILLA_RESUMEN_DIA, 'es', parametros, krezka)
        .catch((e) => ({ success: false, error: e?.message }));
      if (p.success) enviados++;
      else {
        fallidos++;
        error = p.error;
        this.logger.warn(
          `Reporte diario (empresa ${empresaId}) a ${d.numero}: falló el texto (${r.error}) y la plantilla (${p.error}).`,
        );
      }
    }
    return { enviados, fallidos, ...(error ? { error } : {}) };
  }

  /** "Mándame uno ahora": el de hoy hasta este momento, para verlo. */
  async probar(empresaId: number) {
    const r = await this.enviar(empresaId);
    if (r.enviados === 0) {
      throw new BadRequestException(
        r.motivo === 'sin celulares válidos'
          ? 'Ningún administrador tiene un celular válido.'
          : `WhatsApp no aceptó el mensaje${r.error ? ` (${r.error})` : ''}. Si lo acabas de activar, la plantilla puede estar todavía en revisión de Meta: prueba en unos minutos.`,
      );
    }
    return r;
  }

  /**
   * Las 9 p. m. de Lima. Se marca el día ANTES de mandar: si el proceso se
   * reinicia a mitad o corren dos instancias, el dueño no recibe dos reportes.
   * Perder uno es mejor que mandar dos.
   */
  @Cron('0 21 * * *', { name: 'leads-reporte-diario', timeZone: 'America/Lima' })
  async enviarATodos(): Promise<void> {
    const hoy = fechaLima();
    const empresas = await this.prisma.empresa.findMany({
      where: {
        estado: 'ACTIVO' as never,
        plan: { modulosAsignados: { some: { modulo: { codigo: 'leads' } } } },
      },
      select: { id: true, iaVentasConfigJson: true },
    });
    for (const e of empresas) {
      const cfg = ((e.iaVentasConfigJson as Record<string, unknown>)?.reporteDiario ?? {}) as ConfigReporte;
      if (cfg.activo !== true || cfg.ultimoEnvio === hoy) continue;
      try {
        await this.guardarConfig(e.id, { ultimoEnvio: hoy });
        const r = await this.enviar(e.id, hoy);
        this.logger.log(`Reporte diario empresa ${e.id}: ${r.enviados} enviados, ${r.fallidos} fallidos.`);
      } catch (err: any) {
        this.logger.warn(`Reporte diario empresa ${e.id}: ${err?.message}`);
      }
    }
  }
}
