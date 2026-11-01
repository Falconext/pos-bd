import { BadRequestException } from '@nestjs/common';
import type { ModoStockTienda, Prisma, PrismaClient } from '@prisma/client';
import {
  cargarStockPorSede,
  type ProductoConStock,
} from '../common/utils/stock-disponible-sede';
import { round3 } from '../common/utils/stock';

/**
 * De qué stock vende la tienda virtual (Empresa.tiendaStockModo).
 *
 *   SEDE    → una sede: `tiendaSedeId` (null o inactiva = la principal). El
 *             comprador no elige nada.
 *   CLIENTE → el comprador elige su sede entre `tiendaSedesIds` (vacío = todas
 *             las activas). El catálogo, la ficha y el carrito muestran el
 *             stock de esa sede y el pedido queda asignado a ella.
 *   TODAS   → la suma de las sedes de `tiendaSedesIds` (vacío = todas). El
 *             pedido queda sin sede hasta que se genera su nota.
 *
 * En cada sede valen las reglas del punto de venta (common/utils/
 * stock-disponible-sede): reservas, provisión, `visibleEnSede` (oculto = no
 * existe ahí) y `vendibleEnSede` (se ve, pero no se puede pedir).
 */
export const MODOS_STOCK_TIENDA: readonly ModoStockTienda[] = [
  'SEDE',
  'CLIENTE',
  'TODAS',
];

export const MENSAJES_STOCK_TIENDA = {
  elegirSede: 'Elige la sede donde quieres comprar.',
  sedeNoHabilitada: 'La sede elegida no está disponible en esta tienda.',
  sedeInvalida: 'La sede elegida no existe o está inactiva.',
} as const;

/** 409 al documentar un pedido desde una sede que no es la suya. */
export function mensajeSedeDistinta(
  sedePedido?: string | null,
  sedeComprobante?: string | null,
): string {
  const delPedido = sedePedido || 'otra sede';
  return `Este pedido es de la sede ${delPedido} y el comprobante salió de ${sedeComprobante || 'otra sede'}. Emítelo desde ${delPedido} o genera la nota desde el pedido.`;
}

export interface SedeTienda {
  id: number;
  nombre: string;
  direccion: string | null;
  ubigeo: string | null;
  esPrincipal: boolean;
}

export interface ConfigStockTienda {
  tiendaStockModo?: ModoStockTienda | null;
  tiendaSedeId?: number | null;
  tiendaSedesIds?: number[] | null;
}

export interface ContextoStockTienda {
  empresaId: number;
  modo: ModoStockTienda;
  /** La empresa no tiene sedes activas: se usa `Producto.stock` como siempre. */
  sinSedes: boolean;
  /** Una sola sede activa: un producto sin fila en ella usa `Producto.stock`. */
  sinFilaUsaStockGlobal: boolean;
  sedesActivas: SedeTienda[];
  /** Las que la tienda ofrece (CLIENTE), suma (TODAS) o usa (SEDE: una). */
  sedesHabilitadas: SedeTienda[];
  /** Sede con la que abre la tienda (null en TODAS). */
  sedeDefaultId: number | null;
  /** Sede de esta consulta (null en TODAS). */
  sede: SedeTienda | null;
  /** Sedes cuyo stock cuenta en esta consulta. */
  sedeIds: number[];
}

/** Lo que la tienda muestra de un producto. */
export interface StockTiendaProducto {
  stock: number;
  /** Se puede pedir en la sede (o en alguna, en TODAS). */
  vendible: boolean;
  /** Existe en la sede (o en alguna, en TODAS). */
  visible: boolean;
}

export interface DisponibleEnSede {
  sedeId: number;
  nombre: string;
  stock: number;
}

const idValido = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Sedes que la tienda puede usar: las de `tiendaSedesIds` que siguen activas, o todas. */
export function sedesHabilitadas(
  config: ConfigStockTienda,
  activas: SedeTienda[],
): SedeTienda[] {
  const ids = new Set((config.tiendaSedesIds ?? []).map(Number));
  const elegidas = activas.filter((s) => ids.has(s.id));
  return elegidas.length ? elegidas : activas;
}

/** `tiendaSedeId` si está entre las candidatas; si no, la principal; si no, la primera. */
function sedePreferida(
  config: ConfigStockTienda,
  candidatas: SedeTienda[],
): SedeTienda | null {
  return (
    candidatas.find((s) => s.id === config.tiendaSedeId) ??
    candidatas.find((s) => s.esPrincipal) ??
    candidatas[0] ??
    null
  );
}

/**
 * Contexto de stock de una consulta. `sedePedida` (el `?sede=` o el `sedeId`
 * del body) solo cuenta en CLIENTE. En lecturas (`estricto` false) una sede
 * inválida cae a la sede por defecto: un enlace viejo no debe romper la tienda.
 * En el pedido (`estricto`) es un 400.
 */
export function resolverContextoStock(
  empresaId: number,
  config: ConfigStockTienda,
  activas: SedeTienda[],
  sedePedida?: unknown,
  opciones: { estricto?: boolean } = {},
): ContextoStockTienda {
  const modo: ModoStockTienda = MODOS_STOCK_TIENDA.includes(
    config.tiendaStockModo as ModoStockTienda,
  )
    ? (config.tiendaStockModo as ModoStockTienda)
    : 'SEDE';
  const base = {
    empresaId,
    modo,
    sedesActivas: activas,
    sinFilaUsaStockGlobal: activas.length <= 1,
  };
  if (!activas.length) {
    return {
      ...base,
      sinSedes: true,
      sedesHabilitadas: [],
      sedeDefaultId: null,
      sede: null,
      sedeIds: [],
    };
  }
  if (modo === 'SEDE') {
    const sede = sedePreferida(config, activas) as SedeTienda;
    return {
      ...base,
      sinSedes: false,
      sedesHabilitadas: [sede],
      sedeDefaultId: sede.id,
      sede,
      sedeIds: [sede.id],
    };
  }
  const habilitadas = sedesHabilitadas(config, activas);
  if (modo === 'TODAS') {
    return {
      ...base,
      sinSedes: false,
      sedesHabilitadas: habilitadas,
      sedeDefaultId: null,
      sede: null,
      sedeIds: habilitadas.map((s) => s.id),
    };
  }
  const porDefecto = sedePreferida(config, habilitadas) as SedeTienda;
  let sede = porDefecto;
  const crudo = sedePedida;
  const pedida = idValido(crudo);
  if (pedida != null) {
    const encontrada = habilitadas.find((s) => s.id === pedida);
    if (encontrada) sede = encontrada;
    else if (opciones.estricto) {
      throw new BadRequestException(MENSAJES_STOCK_TIENDA.sedeNoHabilitada);
    }
  } else if (opciones.estricto) {
    if (crudo != null && crudo !== '') {
      throw new BadRequestException(MENSAJES_STOCK_TIENDA.sedeNoHabilitada);
    }
    if (habilitadas.length > 1) {
      throw new BadRequestException(MENSAJES_STOCK_TIENDA.elegirSede);
    }
  }
  return {
    ...base,
    sinSedes: false,
    sedesHabilitadas: habilitadas,
    sedeDefaultId: porDefecto.id,
    sede,
    sedeIds: [sede.id],
  };
}

/** Stock de la tienda para un producto según el modo. */
export function stockTiendaDe(
  ctx: ContextoStockTienda,
  p: ProductoConStock | undefined,
  sedeIds: number[] = ctx.sedeIds,
): StockTiendaProducto {
  if (!p) return { stock: 0, vendible: false, visible: false };
  if (ctx.sinSedes)
    return { stock: p.stockGlobal, vendible: true, visible: true };
  const enSedes = sedeIds
    .map((id) => p.porSede.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const visible = enSedes.some((s) => s.visible);
  const vendible = enSedes.some((s) => s.vendible);
  // Un servicio no lleva stock: se muestra lo de siempre y no se valida.
  if (p.esServicio) return { stock: p.stockGlobal, vendible, visible };
  const stock = round3(
    enSedes.reduce((acc, s) => acc + (s.vendible ? s.disponible : 0), 0),
  );
  return { stock, vendible, visible };
}

/** CLIENTE: otras sedes habilitadas donde sí hay (para "Disponible en …"). */
export function disponibleEnOtrasSedes(
  ctx: ContextoStockTienda,
  p: ProductoConStock | undefined,
): DisponibleEnSede[] {
  if (!p || ctx.modo !== 'CLIENTE' || !ctx.sede || p.esServicio) return [];
  return ctx.sedesHabilitadas
    .filter((s) => s.id !== ctx.sede?.id)
    .map((s) => ({ sede: s, en: p.porSede.get(s.id) }))
    .filter(({ en }) => !!en && en.vendible && en.disponible > 0)
    .map(({ sede, en }) => ({
      sedeId: sede.id,
      nombre: sede.nombre,
      stock: round3(en!.disponible),
    }));
}

/**
 * Cuántos combos arma la tienda: el mínimo entre los componentes de
 * stock ÷ cantidad por combo. No vendible si algún componente no lo es.
 */
export function stockDeCombo(
  ctx: ContextoStockTienda,
  items: Array<{ productoId: number; cantidad: number }>,
  mapa: Map<number, ProductoConStock>,
): StockTiendaProducto {
  if (!items.length) return { stock: 0, vendible: false, visible: false };
  let stock = Infinity;
  let vendible = true;
  let visible = true;
  for (const it of items) {
    const st = stockTiendaDe(ctx, mapa.get(it.productoId));
    vendible = vendible && st.vendible;
    visible = visible && st.visible;
    stock = Math.min(
      stock,
      Math.floor(st.stock / Math.max(1, Number(it.cantidad) || 1)),
    );
  }
  return {
    stock: Number.isFinite(stock) ? Math.max(0, stock) : 0,
    vendible,
    visible,
  };
}

type PrismaTienda = Pick<
  PrismaClient,
  'sede' | 'producto' | 'productoStock' | 'reserva' | 'ubigeo'
>;

interface ConStock {
  id: number;
  stock?: unknown;
  variantes?: Array<{ id: number; stock?: unknown }> | null;
}

export type ProductoTienda<T> = T & {
  stock: number;
  vendible: boolean;
  disponibleEn?: DisponibleEnSede[];
};

/** Acceso a datos del stock de la tienda (lo usa TiendaService). */
export class StockTienda {
  constructor(private readonly prisma: PrismaTienda) {}

  sedesActivas(empresaId: number): Promise<SedeTienda[]> {
    return this.prisma.sede.findMany({
      where: { empresaId, activo: true },
      select: {
        id: true,
        nombre: true,
        direccion: true,
        ubigeo: true,
        esPrincipal: true,
      },
      orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }, { id: 'asc' }],
    });
  }

  async contexto(
    empresa: ConfigStockTienda & { id: number },
    sedePedida?: unknown,
    opciones: { estricto?: boolean } = {},
  ): Promise<ContextoStockTienda> {
    const activas = await this.sedesActivas(empresa.id);
    return resolverContextoStock(
      empresa.id,
      empresa,
      activas,
      sedePedida,
      opciones,
    );
  }

  /**
   * Qué productos existen en la tienda según el stock. Listado, filtros
   * (categorías, marcas, precios) y relacionados usan ESTE mismo filtro, así
   * un filtro nunca ofrece algo que el listado no muestra:
   *   - se ocultan los que tienen `visibleEnSede=false` en la sede (en TODAS,
   *     los ocultos en todas las sedes);
   *   - se ocultan los de stock negativo en la sede (en TODAS, suma negativa),
   *     como ya hacía la tienda con `Producto.stock`;
   *   - los agotados SÍ se listan (la plantilla los pinta "Agotado", o los
   *     deja pedir si la tienda vende sin stock).
   */
  async filtroCatalogo(
    ctx: ContextoStockTienda,
  ): Promise<Prisma.ProductoWhereInput> {
    if (ctx.sinSedes) return { stock: { gte: 0 } };
    const condiciones: Prisma.ProductoWhereInput[] = [];
    if (ctx.sedeIds.length === 1) {
      condiciones.push({
        NOT: {
          stocks: { some: { sedeId: ctx.sedeIds[0], visibleEnSede: false } },
        },
      });
    } else {
      condiciones.push({
        NOT: {
          AND: ctx.sedeIds.map((sedeId) => ({
            stocks: { some: { sedeId, visibleEnSede: false } },
          })),
        },
      });
    }
    if (ctx.sinFilaUsaStockGlobal) {
      // Una sola sede: su stock es el de siempre (con datos viejos sin fila).
      condiciones.push({ stock: { gte: 0 } });
    } else {
      const negativos = await this.prisma.productoStock.groupBy({
        by: ['productoId'],
        where: {
          sedeId: { in: ctx.sedeIds },
          producto: { empresaId: ctx.empresaId },
        },
        _sum: { stock: true },
        having: { stock: { _sum: { lt: 0 } } },
      });
      const ids = (negativos ?? []).map((n) => n.productoId);
      if (ids.length) condiciones.push({ id: { notIn: ids } });
    }
    return { AND: condiciones };
  }

  /** Stock por sede de los productos. `todasHabilitadas` para "Disponible en …". */
  cargar(
    ctx: ContextoStockTienda,
    productoIds: number[],
    opciones: { todasHabilitadas?: boolean } = {},
  ): Promise<Map<number, ProductoConStock>> {
    const sedeIds = opciones.todasHabilitadas
      ? [...new Set([...ctx.sedeIds, ...ctx.sedesHabilitadas.map((s) => s.id)])]
      : ctx.sedeIds;
    return cargarStockPorSede(this.prisma, {
      empresaId: ctx.empresaId,
      productoIds,
      sedeIds,
      sinFilaUsaStockGlobal: ctx.sinFilaUsaStockGlobal,
    });
  }

  /** Ids de los productos y de sus variantes (las variantes son Productos). */
  static idsConVariantes(productos: ConStock[]): number[] {
    return productos.flatMap((p) => [
      p.id,
      ...(Array.isArray(p.variantes) ? p.variantes.map((v) => v.id) : []),
    ]);
  }

  /**
   * Reemplaza `stock` (y `variantes[].stock`) por el de la tienda y agrega
   * `vendible`. Las plantillas siguen leyendo `stock` sin enterarse del modo.
   * `conDisponibleEn` (ficha) agrega `disponibleEn`: las otras sedes
   * habilitadas con stock en CLIENTE, vacío en los otros modos.
   */
  async aplicar<T extends ConStock>(
    ctx: ContextoStockTienda,
    productos: T[],
    opciones: { conDisponibleEn?: boolean } = {},
  ): Promise<Array<ProductoTienda<T>>> {
    const conOtras =
      opciones.conDisponibleEn === true && ctx.modo === 'CLIENTE';
    const mapa = await this.cargar(
      ctx,
      StockTienda.idsConVariantes(productos),
      {
        todasHabilitadas: conOtras,
      },
    );
    return StockTienda.aplicarConMapa(ctx, productos, mapa, opciones);
  }

  /** Igual que `aplicar`, con el stock ya cargado (`cargar`). */
  static aplicarConMapa<T extends ConStock>(
    ctx: ContextoStockTienda,
    productos: T[],
    mapa: Map<number, ProductoConStock>,
    opciones: { conDisponibleEn?: boolean } = {},
  ): Array<ProductoTienda<T>> {
    const decorar = <V extends { id: number }>(v: V) => {
      const s = stockTiendaDe(ctx, mapa.get(v.id));
      return {
        ...v,
        stock: s.stock,
        vendible: s.vendible,
        ...(opciones.conDisponibleEn
          ? { disponibleEn: disponibleEnOtrasSedes(ctx, mapa.get(v.id)) }
          : {}),
      };
    };
    return productos.map((p) => ({
      ...decorar(p),
      ...(Array.isArray(p.variantes)
        ? { variantes: p.variantes.map(decorar) }
        : {}),
    }));
  }

  /** Sedes para la tienda pública, con distrito/provincia del ubigeo. */
  async sedesPublicas(ctx: ContextoStockTienda) {
    const codigos = [
      ...new Set(
        ctx.sedesHabilitadas
          .map((s) => s.ubigeo)
          .filter((u): u is string => !!u),
      ),
    ];
    const ubigeos = codigos.length
      ? await this.prisma.ubigeo.findMany({
          where: { codigo: { in: codigos } },
          select: {
            codigo: true,
            distrito: true,
            provincia: true,
            departamento: true,
          },
        })
      : [];
    const porCodigo = new Map(ubigeos.map((u) => [u.codigo, u]));
    return ctx.sedesHabilitadas.map((s) => {
      const u = s.ubigeo ? porCodigo.get(s.ubigeo) : undefined;
      return {
        id: s.id,
        nombre: s.nombre,
        direccion: s.direccion,
        distrito: u?.distrito ?? null,
        provincia: u?.provincia ?? null,
        departamento: u?.departamento ?? null,
        esPrincipal: s.esPrincipal,
      };
    });
  }
}
