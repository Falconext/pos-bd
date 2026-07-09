import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from './notificaciones.service';
import { num } from '../common/utils/stock';

type ProductoNotificacion = {
  id: number;
  codigo: string;
  descripcion: string;
  stock: number;
  stockMinimo?: number | null;
  sedeId?: number | null;
  sedeNombre?: string | null;
};

type UsuarioDestino = {
  id: number;
  rol: string;
  sedeId: number | null;
  sedesAsignadas: { sedeId: number }[];
};

type GrupoProductosPorSede = {
  sedeId: number | null;
  sedeNombre: string | null;
  productos: ProductoNotificacion[];
};

@Injectable()
export class InventarioNotificacionesService {
  private readonly logger = new Logger(InventarioNotificacionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionesService: NotificacionesService,
  ) {}

  /**
   * Verifica el inventario de todas las empresas y genera notificaciones
   */
  async verificarInventarioTodasEmpresas() {
    this.logger.log('🔍 Verificando inventario de todas las empresas...');

    try {
      const empresas = await this.prisma.empresa.findMany({
        where: { estado: 'ACTIVO' },
        select: { id: true, razonSocial: true },
      });

      for (const empresa of empresas) {
        await this.verificarInventarioEmpresa(empresa.id);
      }

      this.logger.log('✅ Verificación de inventario completada');
    } catch (error) {
      this.logger.error('❌ Error al verificar inventario:', error);
    }
  }

  /**
   * Verifica el inventario de una empresa específica
   */
  async verificarInventarioEmpresa(empresaId: number) {
    try {
      const productosAgotados: ProductoNotificacion[] = [];
      const productosCriticos: ProductoNotificacion[] = [];
      const agotadosMap = new Map<string, boolean>();
      const criticosMap = new Map<string, boolean>();

      const pushAgotado = (key: string, producto: ProductoNotificacion) => {
        if (agotadosMap.has(key)) return;
        agotadosMap.set(key, true);
        productosAgotados.push(producto);
      };

      const pushCritico = (key: string, producto: ProductoNotificacion) => {
        if (criticosMap.has(key)) return;
        criticosMap.set(key, true);
        productosCriticos.push(producto);
      };

      // 1. Productos con stock global en 0 (compatibilidad legacy)
      const productosAgotadosGlobal = await this.prisma.producto.findMany({
        where: {
          empresaId,
          estado: 'ACTIVO',
          stock: 0,
        },
        select: {
          id: true,
          codigo: true,
          descripcion: true,
          stock: true,
          stockMinimo: true,
        },
      });
      for (const p of productosAgotadosGlobal) {
        pushAgotado(`global-${p.id}`, {
          id: p.id,
          codigo: p.codigo,
          descripcion: p.descripcion,
          stock: num(p.stock),
          stockMinimo: p.stockMinimo ?? 0,
          sedeId: null,
          sedeNombre: null,
        });
      }

      // 2. Productos con stock global bajo (<= mínimo)
      const productosBajoStockGlobal = await this.prisma.producto.findMany({
        where: {
          empresaId,
          estado: 'ACTIVO',
          stock: { gt: 0 },
          stockMinimo: { gt: 0 },
        },
        select: {
          id: true,
          codigo: true,
          descripcion: true,
          stock: true,
          stockMinimo: true,
        },
      });
      for (const p of productosBajoStockGlobal) {
        const minimo = p.stockMinimo ?? 0;
        if (minimo > 0 && num(p.stock) <= minimo) {
          pushCritico(`global-${p.id}`, {
            id: p.id,
            codigo: p.codigo,
            descripcion: p.descripcion,
            stock: num(p.stock),
            stockMinimo: minimo,
            sedeId: null,
            sedeNombre: null,
          });
        }
      }

      // 3. Productos por sede con stock en 0
      const productosAgotadosPorSede = await this.prisma.productoStock.findMany(
        {
          where: {
            stock: 0,
            producto: { empresaId, estado: 'ACTIVO' },
          },
          select: {
            productoId: true,
            sedeId: true,
            stock: true,
            stockMinimo: true,
            sede: { select: { nombre: true } },
            producto: {
              select: {
                codigo: true,
                descripcion: true,
                stockMinimo: true,
              },
            },
          },
        },
      );

      for (const p of productosAgotadosPorSede) {
        const key = `sede-${p.productoId}-${p.sedeId}`;
        const descripcion = `${p.producto.descripcion}${p.sede?.nombre ? ` [Sede: ${p.sede.nombre}]` : ''}`;
        pushAgotado(key, {
          id: p.productoId,
          codigo: p.producto.codigo,
          descripcion,
          stock: num(p.stock),
          stockMinimo: p.stockMinimo ?? p.producto.stockMinimo ?? 0,
          sedeId: p.sedeId,
          sedeNombre: p.sede?.nombre || null,
        });
      }

      // 4. Productos por sede con stock bajo (<= mínimo de la sede)
      const productosBajoStockPorSede =
        await this.prisma.productoStock.findMany({
          where: {
            stock: { gt: 0 },
            stockMinimo: { gt: 0 },
            producto: { empresaId, estado: 'ACTIVO' },
          },
          select: {
            productoId: true,
            sedeId: true,
            stock: true,
            stockMinimo: true,
            sede: { select: { nombre: true } },
            producto: {
              select: {
                codigo: true,
                descripcion: true,
              },
            },
          },
        });

      for (const p of productosBajoStockPorSede) {
        const minimo = p.stockMinimo ?? 0;
        if (minimo === 0 || num(p.stock) > minimo) continue;
        const key = `sede-${p.productoId}-${p.sedeId}`;
        const descripcion = `${p.producto.descripcion}${p.sede?.nombre ? ` [Sede: ${p.sede.nombre}]` : ''}`;
        pushCritico(key, {
          id: p.productoId,
          codigo: p.producto.codigo,
          descripcion,
          stock: num(p.stock),
          stockMinimo: minimo,
          sedeId: p.sedeId,
          sedeNombre: p.sede?.nombre || null,
        });
      }

      const admins = await this.obtenerUsuariosDestino(empresaId);

      // 5. Generar notificaciones si hay productos críticos
      if (productosAgotados.length > 0) {
        await this.notificarProductosAgotados(
          empresaId,
          productosAgotados,
          admins,
        );
      }

      if (productosCriticos.length > 0) {
        await this.notificarProductosBajoStock(
          empresaId,
          productosCriticos,
          admins,
        );
      }

      this.logger.log(
        `📊 Empresa ${empresaId}: ${productosAgotados.length} agotados, ${productosCriticos.length} bajo stock`,
      );

      return {
        productosAgotados: productosAgotados.length,
        productosBajoStock: productosCriticos.length,
      };
    } catch (error) {
      this.logger.error(
        `❌ Error al verificar inventario de empresa ${empresaId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Notifica productos agotados
   */
  private async notificarProductosAgotados(
    empresaId: number,
    productos: ProductoNotificacion[],
    adminsCache?: UsuarioDestino[],
  ) {
    if (productos.length === 0) return;

    const admins =
      adminsCache ?? (await this.obtenerUsuariosDestino(empresaId));
    if (admins.length === 0) return;

    const grupos = this.agruparProductosPorSede(productos);

    for (const grupo of grupos) {
      const destinatarios = this.filtrarUsuariosPorSede(admins, grupo.sedeId);
      if (destinatarios.length === 0) continue;

      const sedeLabel = grupo.sedeNombre
        ? ` en la sede ${grupo.sedeNombre}`
        : '';
      const titulo = grupo.sedeNombre
        ? `⚠️ ${grupo.sedeNombre} · Productos Agotados`
        : '⚠️ Productos Agotados';

      let mensaje = '';
      if (grupo.productos.length === 1) {
        mensaje = `El producto "${grupo.productos[0].descripcion}" (${grupo.productos[0].codigo}) está AGOTADO${sedeLabel}.`;
      } else if (grupo.productos.length <= 5) {
        const lista = grupo.productos
          .map((p) => `• ${p.descripcion} (${p.codigo})`)
          .join('\n');
        mensaje = `${grupo.productos.length} productos están AGOTADOS${sedeLabel}:\n${lista}`;
      } else {
        const lista = grupo.productos
          .slice(0, 5)
          .map((p) => `• ${p.descripcion} (${p.codigo})`)
          .join('\n');
        mensaje = `${grupo.productos.length} productos están AGOTADOS${sedeLabel}:\n${lista}\n... y ${grupo.productos.length - 5} más. Revisa tu inventario.`;
      }

      for (const admin of destinatarios) {
        const notificacion = await this.prisma.notificacion.create({
          data: {
            usuarioId: admin.id,
            empresaId,
            tipo: 'CRITICAL',
            titulo,
            mensaje,
            leida: false,
          },
        });

        this.notificacionesService.emitirNotificacionEnTiempoReal(
          admin.id,
          notificacion,
        );
      }
    }
  }

  /**
   * Notifica productos con stock bajo

   */
  private async notificarProductosBajoStock(
    empresaId: number,
    productos: ProductoNotificacion[],
    adminsCache?: UsuarioDestino[],
  ) {
    if (productos.length === 0) return;

    const admins =
      adminsCache ?? (await this.obtenerUsuariosDestino(empresaId));
    if (admins.length === 0) return;

    const grupos = this.agruparProductosPorSede(productos);

    for (const grupo of grupos) {
      const destinatarios = this.filtrarUsuariosPorSede(admins, grupo.sedeId);
      if (destinatarios.length === 0) continue;

      const sedeLabel = grupo.sedeNombre
        ? ` en la sede ${grupo.sedeNombre}`
        : '';
      const titulo = grupo.sedeNombre
        ? `📦 ${grupo.sedeNombre} · Stock Bajo`
        : '📦 Stock Bajo';

      let mensaje = '';
      if (grupo.productos.length === 1) {
        const p = grupo.productos[0];
        mensaje = `El producto "${p.descripcion}" tiene stock bajo${sedeLabel} (${p.stock} unidades, mínimo: ${p.stockMinimo}).`;
      } else if (grupo.productos.length <= 5) {
        const lista = grupo.productos
          .map(
            (p) =>
              `• ${p.descripcion} (${p.codigo}): ${p.stock} unidades (mín: ${p.stockMinimo})`,
          )
          .join('\n');
        mensaje = `${grupo.productos.length} productos tienen stock bajo${sedeLabel}:\n${lista}`;
      } else {
        const lista = grupo.productos
          .slice(0, 5)
          .map(
            (p) =>
              `• ${p.descripcion} (${p.codigo}): ${p.stock} unidades (mín: ${p.stockMinimo})`,
          )
          .join('\n');
        mensaje = `${grupo.productos.length} productos tienen stock bajo${sedeLabel}:\n${lista}\n... y ${grupo.productos.length - 5} más. Considera reabastecer.`;
      }

      for (const admin of destinatarios) {
        const notificacion = await this.prisma.notificacion.create({
          data: {
            usuarioId: admin.id,
            empresaId,
            tipo: 'WARNING',
            titulo,
            mensaje,
            leida: false,
          },
        });

        this.notificacionesService.emitirNotificacionEnTiempoReal(
          admin.id,
          notificacion,
        );
      }
    }
  }

  /**
   * Verifica un producto específico después de una venta.
   * Cuando se proporciona sedeId comprueba el stock de esa sede (multi-sede).
   * Como fallback lee el campo global Producto.stock para compatibilidad.
   */
  async verificarProductoDespuesVenta(
    productoId: number,
    empresaId: number,
    sedeId?: number,
  ) {
    try {
      const producto = await this.prisma.producto.findUnique({
        where: { id: productoId },
        select: {
          id: true,
          codigo: true,
          descripcion: true,
          stock: true,
          stockMinimo: true,
        },
      });

      if (!producto) return;

      let stockActual: number = num(producto.stock);
      let stockMinimo: number = producto.stockMinimo ?? 0;
      let sedeSuffix = '';
      let sedeNombre: string | null = null;

      // Si tenemos sedeId, preferir el stock específico de la sede
      if (sedeId) {
        const productoStock = await this.prisma.productoStock.findUnique({
          where: { productoId_sedeId: { productoId, sedeId } },
          select: {
            stock: true,
            stockMinimo: true,
            sede: { select: { nombre: true } },
          },
        });
        if (productoStock) {
          stockActual = num(productoStock.stock);
          stockMinimo = productoStock.stockMinimo ?? 0;
          sedeNombre = productoStock.sede?.nombre || null;
          sedeSuffix = sedeNombre ? ` [Sede: ${sedeNombre}]` : '';
        }
      }

      const productoConStock: ProductoNotificacion = {
        ...producto,
        stock: stockActual,
        stockMinimo,
        descripcion: `${producto.descripcion}${sedeSuffix}`,
        sedeId: sedeId ?? null,
        sedeNombre,
      };

      if (stockActual <= 0) {
        await this.notificarProductosAgotados(empresaId, [productoConStock]);
        return;
      }

      if (stockMinimo > 0 && stockActual <= stockMinimo) {
        await this.notificarProductosBajoStock(empresaId, [productoConStock]);
      }
    } catch (error) {
      this.logger.error(`❌ Error al verificar producto ${productoId}:`, error);
    }
  }

  private async obtenerUsuariosDestino(
    empresaId: number,
  ): Promise<UsuarioDestino[]> {
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        empresaId,
        rol: { in: ['ADMIN_EMPRESA', 'USUARIO_EMPRESA'] },
        estado: 'ACTIVO',
      },
      select: {
        id: true,
        rol: true,
        sedeId: true,
        sedesAsignadas: { select: { sedeId: true } },
      },
    });

    return usuarios.map((u) => ({
      id: u.id,
      rol: u.rol,
      sedeId: u.sedeId ?? null,
      sedesAsignadas: u.sedesAsignadas || [],
    }));
  }

  private agruparProductosPorSede(
    productos: ProductoNotificacion[],
  ): GrupoProductosPorSede[] {
    const grupos = new Map<string, GrupoProductosPorSede>();

    for (const producto of productos) {
      const key = producto.sedeId ? `sede-${producto.sedeId}` : 'global';
      if (!grupos.has(key)) {
        grupos.set(key, {
          sedeId: producto.sedeId ?? null,
          sedeNombre: producto.sedeNombre ?? null,
          productos: [],
        });
      }
      grupos.get(key)!.productos.push(producto);
    }

    return Array.from(grupos.values());
  }

  private filtrarUsuariosPorSede(
    admins: UsuarioDestino[],
    sedeId: number | null,
  ): UsuarioDestino[] {
    if (!sedeId) {
      return admins;
    }

    return admins.filter((admin) => {
      if (admin.rol === 'ADMIN_EMPRESA') {
        // Admin empresa ve todas las sedes
        return true;
      }
      if (admin.sedeId === sedeId) {
        return true;
      }
      return admin.sedesAsignadas?.some((s) => s.sedeId === sedeId);
    });
  }

  /**
   * Job diario: alerta a admins de empresas farmacéuticas sobre lotes
   * que vencen en los próximos 7 días o ya vencieron con stock disponible.
   */
  async alertarLotesVencimientoProximo(): Promise<{ total: number }> {
    const hoy = new Date();
    const en7dias = new Date(hoy.getTime() + 7 * 24 * 60 * 60 * 1000);

    const rubrosRegulados = [
      'farmacia',
      'botica',
      'medicament',
      'drogueria',
      'droguería',
    ];

    // Obtener empresas con rubros farmacéuticos
    const empresas = await this.prisma.empresa.findMany({
      where: {
        rubro: {
          OR: rubrosRegulados.map((r) => ({
            nombre: { contains: r, mode: 'insensitive' as any },
          })),
        },
      },
      select: { id: true },
    });

    if (empresas.length === 0) return { total: 0 };

    const empresaIds = empresas.map((e) => e.id);

    // Lotes próximos a vencer o ya vencidos con stock
    const lotesAlerta = await this.prisma.productoLote.findMany({
      where: {
        producto: { empresaId: { in: empresaIds } },
        activo: true,
        stockActual: { gt: 0 },
        fechaVencimiento: { lte: en7dias },
      },
      include: {
        producto: {
          select: { descripcion: true, empresaId: true },
        },
      },
    });

    if (lotesAlerta.length === 0) return { total: 0 };

    // Agrupar por empresa
    const porEmpresa = new Map<number, typeof lotesAlerta>();
    for (const lote of lotesAlerta) {
      const eid = lote.producto.empresaId as number;
      if (!porEmpresa.has(eid)) porEmpresa.set(eid, []);
      porEmpresa.get(eid)!.push(lote);
    }

    let total = 0;
    for (const [empresaId, lotes] of porEmpresa.entries()) {
      // Notificar a admins de la empresa
      const admins = await this.prisma.usuario.findMany({
        where: { empresaId, rol: { in: ['ADMIN_EMPRESA', 'USUARIO_EMPRESA'] } },
        select: { id: true },
        take: 5,
      });

      const vencidos = lotes.filter((l) => l.fechaVencimiento < hoy);
      const porVencer = lotes.filter((l) => l.fechaVencimiento >= hoy);

      let mensaje = '';
      if (vencidos.length > 0) {
        mensaje += `${vencidos.length} lote(s) VENCIDO(S) con stock disponible. `;
      }
      if (porVencer.length > 0) {
        mensaje += `${porVencer.length} lote(s) vencen en menos de 7 días.`;
      }

      for (const admin of admins) {
        try {
          await this.notificacionesService.crearNotificacion({
            usuarioId: admin.id,
            empresaId,
            tipo: vencidos.length > 0 ? 'CRITICAL' : 'WARNING',
            titulo: '⚠️ Alerta de vencimiento de lotes',
            mensaje: mensaje.trim(),
          });
          total++;
        } catch {
          // No bloquear el job si falla una notificación individual
        }
      }
    }

    return { total };
  }
}
