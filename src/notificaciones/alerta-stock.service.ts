import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  agruparPorSede,
  diaLima,
  formatoCantidad,
  leerCorreos,
  masUrgentes,
  normalizarCelular,
  productosStockBajo,
  textoWhatsApp,
  yaSalioHoy,
  type FilaStockSede,
  type ProductoStockBajo,
} from './alerta-stock';

/** Filas que caben en el cuerpo del correo; el Excel adjunto lleva todas. */
const MAX_FILAS_CORREO = 60;

export interface ConfigAlertaStock {
  correo: boolean;
  whatsapp: boolean;
  /** Lista escrita por el negocio; vacía = correos de los administradores. */
  correos: string;
  celular: string;
  ultimoEnvio: Date | null;
  correosAdministradores: string[];
  /** La empresa tiene su propio número conectado (único remitente posible). */
  whatsappConectado: boolean;
}

export interface ResultadoEnvio {
  productos: number;
  omitido?: string;
  correo: { enviados: string[]; errores: string[] };
  whatsapp: { enviado: boolean; via?: 'texto' | 'plantilla'; error?: string };
}

/**
 * Resumen de stock bajo por correo y WhatsApp (ver alerta-stock.ts).
 *
 * Complementa —no reemplaza— el aviso en la campana del panel de
 * InventarioNotificacionesService: aquel le llega a quien entra al panel; este
 * le llega al dueño aunque no entre.
 */
@Injectable()
export class AlertaStockService {
  private readonly logger = new Logger(AlertaStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly config: ConfigService,
  ) {}

  // ── Configuración ──────────────────────────────────────────────────────────

  async obtenerConfig(empresaId: number): Promise<ConfigAlertaStock> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        alertaStockCorreo: true,
        alertaStockWhatsapp: true,
        alertaStockCorreos: true,
        alertaStockCelular: true,
        alertaStockUltimoEnvio: true,
        whatsappProvider: true,
        whatsappPhoneNumberId: true,
        whatsappActivo: true,
      },
    });
    if (!empresa) throw new BadRequestException('Empresa no encontrada');
    return {
      correo: empresa.alertaStockCorreo,
      whatsapp: empresa.alertaStockWhatsapp,
      correos: empresa.alertaStockCorreos ?? '',
      celular: empresa.alertaStockCelular ?? '',
      ultimoEnvio: empresa.alertaStockUltimoEnvio,
      correosAdministradores: await this.correosAdministradores(empresaId),
      whatsappConectado: this.tieneWhatsappPropio(empresa),
    };
  }

  async guardarConfig(
    empresaId: number,
    dto: { correo?: boolean; whatsapp?: boolean; correos?: string | null; celular?: string | null },
  ): Promise<ConfigAlertaStock & { plantilla?: { estado: string; detalle?: string } }> {
    const data: Record<string, unknown> = {};

    if (dto.correos !== undefined) {
      const { validos, invalidos } = leerCorreos(dto.correos);
      if (invalidos.length) {
        throw new BadRequestException(
          `${invalidos.length === 1 ? 'Este correo no es válido' : 'Estos correos no son válidos'}: ${invalidos.join(', ')}`,
        );
      }
      data.alertaStockCorreos = validos.length ? validos.join(', ') : null;
    }
    if (dto.celular !== undefined) {
      const texto = String(dto.celular ?? '').trim();
      if (texto) {
        const celular = normalizarCelular(texto);
        if (!celular) throw new BadRequestException('El celular no es válido. Escribe los 9 dígitos, por ejemplo 987654321.');
        data.alertaStockCelular = celular;
      } else {
        data.alertaStockCelular = null;
      }
    }
    if (dto.correo !== undefined) data.alertaStockCorreo = Boolean(dto.correo);
    if (dto.whatsapp !== undefined) data.alertaStockWhatsapp = Boolean(dto.whatsapp);

    const actual = await this.obtenerConfig(empresaId);
    const whatsappFinal = dto.whatsapp ?? actual.whatsapp;
    const celularFinal =
      data.alertaStockCelular !== undefined ? (data.alertaStockCelular as string | null) : actual.celular || null;
    if (whatsappFinal && dto.whatsapp) {
      if (!actual.whatsappConectado) {
        throw new BadRequestException(
          'Para recibirlo por WhatsApp primero conecta el número de tu negocio (Perfil → Configuración → Conectar mi WhatsApp).',
        );
      }
      if (!celularFinal) {
        throw new BadRequestException('Escribe el celular al que te llegará el aviso.');
      }
    }
    const correoFinal = dto.correo ?? actual.correo;
    const correosFinal = 'alertaStockCorreos' in data ? (data.alertaStockCorreos as string | null) : actual.correos;
    if (correoFinal && !correosFinal && actual.correosAdministradores.length === 0) {
      throw new BadRequestException('Escribe al menos un correo para recibir el resumen.');
    }

    await this.prisma.empresa.update({ where: { id: empresaId }, data });

    // Al encender WhatsApp se da de alta la plantilla en la cuenta del negocio:
    // el dueño casi nunca le escribe a su propio número, así que la ventana de
    // 24h para mandar texto libre suele estar cerrada.
    let plantilla: { estado: string; detalle?: string } | undefined;
    if (dto.whatsapp && !actual.whatsapp) {
      try {
        const r = await this.whatsapp.crearPlantillaAlertaStockEmpresa(empresaId);
        plantilla = r.errores.length
          ? { estado: 'error', detalle: r.errores.join('; ') }
          : { estado: r.creadas.length ? 'creada' : 'existente' };
      } catch (e: any) {
        plantilla = { estado: 'error', detalle: e?.message };
      }
    }
    return { ...(await this.obtenerConfig(empresaId)), ...(plantilla ? { plantilla } : {}) };
  }

  // ── Lista ──────────────────────────────────────────────────────────────────

  /**
   * Productos en su mínimo o por debajo, por sede. Se lee el stock de cada
   * sede (ProductoStock), que es el real: el global de Producto es una suma y
   * escondería una tienda vacía detrás de la otra llena.
   */
  async productosBajoMinimo(empresaId: number): Promise<ProductoStockBajo[]> {
    const filas = await this.prisma.productoStock.findMany({
      where: {
        visibleEnSede: true,
        sede: { activo: true },
        producto: {
          empresaId,
          estado: 'ACTIVO',
          // El padre de variantes suma el stock de sus tallas/colores: se
          // repone por variante, no por el padre.
          variantes: { none: {} },
        },
        OR: [{ stockMinimo: { gt: 0 } }, { producto: { stockMinimo: { gt: 0 } } }],
      },
      select: {
        productoId: true,
        sedeId: true,
        stock: true,
        stockMinimo: true,
        sede: { select: { nombre: true } },
        producto: { select: { codigo: true, descripcion: true, stockMinimo: true } },
      },
    });
    const enCero = filas.filter((f) => Number(f.stock) <= 0);
    const movidos = new Set<string>();
    if (enCero.length) {
      const sedesActivas = await this.prisma.sede.count({ where: { empresaId, activo: true } });
      const movimientos = await this.prisma.movimientoKardex.findMany({
        where: {
          productoId: { in: [...new Set(enCero.map((f) => f.productoId))] },
          // Movimientos viejos sin sede: con una sola sede activa son de ella.
          ...(sedesActivas > 1 ? { sedeId: { in: [...new Set(enCero.map((f) => f.sedeId))] } } : {}),
        },
        distinct: ['productoId', 'sedeId'],
        select: { productoId: true, sedeId: true },
      });
      for (const m of movimientos) {
        if (m.sedeId == null) enCero.filter((f) => f.productoId === m.productoId).forEach((f) => movidos.add(`${f.productoId}-${f.sedeId}`));
        else movidos.add(`${m.productoId}-${m.sedeId}`);
      }
    }
    return productosStockBajo(
      filas.map(
        (f): FilaStockSede => ({
          productoId: f.productoId,
          codigo: f.producto.codigo,
          descripcion: f.producto.descripcion,
          sedeId: f.sedeId,
          sedeNombre: f.sede?.nombre ?? `Sede ${f.sedeId}`,
          stock: Number(f.stock),
          minimoSede: f.stockMinimo,
          minimoProducto: f.producto.stockMinimo,
        }),
      ),
      (productoId, sedeId) => movidos.has(`${productoId}-${sedeId}`),
    );
  }

  // ── Envío ──────────────────────────────────────────────────────────────────

  /** Cron de las 8:00 (SchedulerService): todas las empresas que lo encendieron. */
  async enviarResumenTodas(): Promise<void> {
    const empresas = await this.prisma.empresa.findMany({
      where: { estado: 'ACTIVO', OR: [{ alertaStockCorreo: true }, { alertaStockWhatsapp: true }] },
      select: { id: true },
    });
    for (const e of empresas) {
      try {
        const r = await this.enviarResumen(e.id);
        this.logger.log(
          `Stock bajo empresa ${e.id}: ${r.productos} productos${r.omitido ? ` (omitido: ${r.omitido})` : ''}; correo ${r.correo.enviados.length} ok/${r.correo.errores.length} error; WhatsApp ${r.whatsapp.enviado ? r.whatsapp.via : r.whatsapp.error ?? 'no'}`,
        );
      } catch (err: any) {
        this.logger.error(`Stock bajo empresa ${e.id}: ${err?.message}`);
      }
    }
  }

  /**
   * Manda el resumen de una empresa. Sin `forzar` sale una vez por día y solo
   * si hay algo que reponer; con `forzar` (botón "Enviar ahora") sale siempre,
   * para que el negocio vea cómo le llega.
   */
  async enviarResumen(empresaId: number, opciones: { forzar?: boolean } = {}): Promise<ResultadoEnvio> {
    const ahora = new Date();
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        razonSocial: true,
        nombreComercial: true,
        brand: true,
        alertaStockCorreo: true,
        alertaStockWhatsapp: true,
        alertaStockCorreos: true,
        alertaStockCelular: true,
        alertaStockUltimoEnvio: true,
        whatsappProvider: true,
        whatsappPhoneNumberId: true,
        whatsappActivo: true,
      },
    });
    const resultado: ResultadoEnvio = {
      productos: 0,
      correo: { enviados: [], errores: [] },
      whatsapp: { enviado: false },
    };
    if (!empresa) return { ...resultado, omitido: 'empresa no encontrada' };
    if (!opciones.forzar && !empresa.alertaStockCorreo && !empresa.alertaStockWhatsapp) {
      return { ...resultado, omitido: 'apagado' };
    }
    if (!opciones.forzar && yaSalioHoy(empresa.alertaStockUltimoEnvio, ahora)) {
      return { ...resultado, omitido: 'ya salió hoy' };
    }

    const productos = await this.productosBajoMinimo(empresaId);
    resultado.productos = productos.length;
    if (productos.length === 0 && !opciones.forzar) {
      return { ...resultado, omitido: 'nada por reponer' };
    }

    // Se marca ANTES de enviar: si el servidor reinicia a mitad de camino es
    // mejor perder un resumen que mandarlo dos veces el mismo día. El envío
    // manual ("Enviar ahora") no marca: probarlo a las 7 no debe saltarse el
    // resumen de las 8.
    if (!opciones.forzar) {
      await this.prisma.empresa.update({ where: { id: empresaId }, data: { alertaStockUltimoEnvio: ahora } });
    }

    const negocio = (empresa.nombreComercial || empresa.razonSocial || '').trim() || 'tu negocio';
    const appName = empresa.brand === 'krezka' ? 'Krezka' : 'Falconext';
    const panelUrl = `${this.frontendUrl()}/administrador/kardex`;
    const enviarCorreo = opciones.forzar ? empresa.alertaStockCorreo || !empresa.alertaStockWhatsapp : empresa.alertaStockCorreo;

    if (enviarCorreo) {
      const destinos = leerCorreos(empresa.alertaStockCorreos).validos;
      const correos = destinos.length ? destinos : await this.correosAdministradores(empresaId);
      if (correos.length === 0) resultado.correo.errores.push('sin correos de destino');
      else {
        try {
          await this.enviarCorreo(correos, { negocio, appName, panelUrl, productos, ahora });
          resultado.correo.enviados = correos;
        } catch (e: any) {
          resultado.correo.errores.push(e?.message ?? String(e));
        }
      }
    }

    if (empresa.alertaStockWhatsapp) {
      resultado.whatsapp = await this.enviarWhatsapp(empresaId, empresa, { negocio, panelUrl, productos });
    }
    return resultado;
  }

  private async enviarWhatsapp(
    empresaId: number,
    empresa: { alertaStockCelular: string | null; whatsappProvider: any; whatsappPhoneNumberId: string | null; whatsappActivo: boolean },
    p: { negocio: string; panelUrl: string; productos: ProductoStockBajo[] },
  ): Promise<ResultadoEnvio['whatsapp']> {
    if (!this.tieneWhatsappPropio(empresa)) return { enviado: false, error: 'WhatsApp del negocio no conectado' };
    if (!empresa.alertaStockCelular) return { enviado: false, error: 'sin celular de destino' };
    if (p.productos.length === 0) {
      const r = await this.whatsapp.enviarTexto(
        empresa.alertaStockCelular,
        `📦 *Stock bajo · ${p.negocio}*\n\nHoy no hay productos en su stock mínimo. ✅`,
        empresaId,
      );
      return r.success ? { enviado: true, via: 'texto' } : { enviado: false, error: r.error };
    }
    const texto = await this.whatsapp.enviarTexto(
      empresa.alertaStockCelular,
      textoWhatsApp(p.negocio, p.productos, p.panelUrl),
      empresaId,
    );
    if (texto.success) return { enviado: true, via: 'texto' };
    // Fuera de la ventana de 24h el texto libre no llega: plantilla aprobada.
    const plantilla = await this.whatsapp.enviarPlantilla(
      empresa.alertaStockCelular,
      'alerta_stock_bajo',
      'es',
      [paraPlantilla(p.negocio), String(p.productos.length), paraPlantilla(masUrgentes(p.productos))],
      empresaId,
    );
    return plantilla.success
      ? { enviado: true, via: 'plantilla' }
      : { enviado: false, error: `texto: ${texto.error}; plantilla: ${plantilla.error}` };
  }

  private async enviarCorreo(
    para: string[],
    p: { negocio: string; appName: string; panelUrl: string; productos: ProductoStockBajo[]; ahora: Date },
  ): Promise<void> {
    const resendKey = this.config.get<string>('RESEND_API_KEY') || process.env.RESEND_API_KEY;
    if (!resendKey) throw new Error('el servicio de correo no está configurado en el servidor');
    const fromEmail =
      this.config.get<string>('RESEND_FROM_EMAIL') || process.env.RESEND_FROM_EMAIL || 'notificaciones@falconext.pe';

    const { Resend } = await import('resend');
    const { render } = await import('@react-email/components');
    const { StockBajoEmail } = await import('./emails/StockBajoEmail');

    // El cuerpo lleva las más urgentes; el Excel, todas.
    const visibles = p.productos.slice(0, MAX_FILAS_CORREO);
    const fecha = fechaLarga(p.ahora);
    const html = await render(
      StockBajoEmail({
        negocioNombre: p.negocio,
        appName: p.appName,
        fecha,
        total: p.productos.length,
        agotados: p.productos.filter((x) => x.agotado).length,
        grupos: agruparPorSede(visibles).map((g) => ({
          sedeNombre: g.sedeNombre,
          productos: g.productos.map((x) => ({
            descripcion: x.descripcion,
            codigo: x.codigo,
            stock: formatoCantidad(x.stock),
            minimo: x.minimo,
            faltan: formatoCantidad(x.faltan),
            agotado: x.agotado,
          })),
        })),
        recortado: p.productos.length - visibles.length,
        panelUrl: p.panelUrl,
      }) as any,
    );

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: `${p.negocio} <${fromEmail}>`,
      to: para,
      subject:
        p.productos.length === 0
          ? `Stock al día · ${p.negocio}`
          : `📦 ${p.productos.length} ${p.productos.length === 1 ? 'producto por reponer' : 'productos por reponer'} · ${p.negocio}`,
      html,
      ...(p.productos.length
        ? { attachments: [{ filename: `lista-de-compras-${diaLima(p.ahora)}.xlsx`, content: excelListaCompras(p.productos) }] }
        : {}),
    });
    if (error) throw new Error(String((error as any)?.message ?? error));
  }

  // ── Apoyo ──────────────────────────────────────────────────────────────────

  private async correosAdministradores(empresaId: number): Promise<string[]> {
    const admins = await this.prisma.usuario.findMany({
      where: { empresaId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
      select: { email: true },
      orderBy: { id: 'asc' },
    });
    return leerCorreos(admins.map((a) => a.email).join(',')).validos;
  }

  /**
   * El aviso sale del número del propio negocio: no hay número de plataforma
   * configurado, y uno ajeno tampoco tendría la plantilla aprobada.
   */
  private tieneWhatsappPropio(e: { whatsappProvider: any; whatsappPhoneNumberId: string | null; whatsappActivo: boolean }): boolean {
    return e.whatsappActivo && e.whatsappProvider === 'EMPRESA' && !!e.whatsappPhoneNumberId;
  }

  private frontendUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') || process.env.FRONTEND_URL || 'https://app.falconext.pe').replace(/\/$/, '');
  }
}

/** Excel de la lista de compras: una fila por producto y sede. */
export function excelListaCompras(productos: ProductoStockBajo[]): Buffer {
  const filas = agruparPorSede(productos).flatMap((g) =>
    g.productos.map((p) => ({
      Sede: g.sedeNombre,
      Código: p.codigo ?? '',
      Producto: p.descripcion,
      'Stock actual': p.stock,
      'Stock mínimo': p.minimo,
      'Faltan para el mínimo': p.faltan,
      Estado: p.agotado ? 'Agotado' : 'Stock bajo',
      'Cantidad a pedir': '',
    })),
  );
  const hoja = XLSX.utils.json_to_sheet(filas);
  hoja['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 44 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 16 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Lista de compras');
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Un parámetro de plantilla no admite saltos de línea ni espacios repetidos. */
function paraPlantilla(texto: string): string {
  return texto.replace(/[\n\t]+/g, ' · ').replace(/\s{2,}/g, ' ').trim().slice(0, 900);
}

function fechaLarga(d: Date): string {
  return d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long' });
}
