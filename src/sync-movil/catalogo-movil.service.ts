import { Injectable, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TipoCambioService } from '../tipo-cambio/tipo-cambio.service';
import {
  isJambleProvider,
  resolveBillingProvider,
} from '../common/utils/billing-provider';

/**
 * Snapshot del catálogo que la app móvil guarda en SQLite para vender sin
 * conexión (plan offline-first, Fase 1): productos con lo mínimo para el POS,
 * stock/visibilidad por sede, clientes activos, categorías, sedes y la
 * configuración de la empresa que afecta a la venta.
 *
 * Devuelve una `version` (hash del contenido) para que la app mande
 * `If-None-Match` y reciba 304 cuando nada cambió. Producto/Cliente aún no
 * tienen `actualizadoEn`, así que Fase 1 es snapshot completo (Fase 2: delta).
 */
@Injectable()
export class CatalogoMovilService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tipoCambio: TipoCambioService,
  ) {}

  async construir(empresaId: number, sedeId?: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        offlineHabilitado: true,
        permitirVentaSinStock: true,
        requiereCajaParaEmitir: true,
        ventaObservacionesDefault: true,
        catalogoPorSede: true,
        kitsComoUnaLinea: true,
        paquetesComoUnaLinea: true,
        billingProvider: true,
        usaDemo: true,
        sedes: {
          where: { activo: true },
          select: { id: true, nombre: true, esPrincipal: true, codigo: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!empresa) throw new ForbiddenException('Empresa no encontrada');
    if (!empresa.offlineHabilitado) {
      throw new ForbiddenException(
        'El modo sin conexión no está habilitado para esta empresa.',
      );
    }

    // Visibilidad por sede: mismas reglas que ProductoService.listar.
    const where: any = { empresaId, estado: 'ACTIVO', productoPadreId: null };
    if (sedeId && empresa.catalogoPorSede) {
      where.stocks = { some: { sedeId, visibleEnSede: true } };
    } else if (sedeId) {
      where.NOT = { stocks: { some: { sedeId, visibleEnSede: false } } };
    }

    const [productosRaw, clientesRaw, categorias, tc] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          codigo: true,
          descripcion: true,
          codigoBarras: true,
          precioUnitario: true,
          precioOferta: true,
          ofertaActiva: true,
          fechaInicioOferta: true,
          fechaFinOferta: true,
          moneda: true,
          tipoAfectacionIGV: true,
          igvPorcentaje: true,
          categoriaId: true,
          imagenUrl: true,
          stock: true,
          requiereReceta: true,
          factorConversion: true,
          unidadVenta: true,
          preciosMayorista: true,
          atributosTecnicos: true,
          opcionesAtributos: true,
          unidadMedida: { select: { codigo: true } },
          codigosBarras: {
            select: {
              codigo: true,
              unidadesPorPaquete: true,
              precioPaquete: true,
              alias: true,
              codigoInterno: true,
            },
          },
          stocks: {
            ...(sedeId ? { where: { sedeId } } : {}),
            select: {
              sedeId: true,
              stock: true,
              visibleEnSede: true,
              vendibleEnSede: true,
              precioUnitarioOverride: true,
              precioOfertaOverride: true,
            },
          },
          variantes: {
            where: { estado: 'ACTIVO' },
            select: {
              id: true,
              codigo: true,
              descripcion: true,
              precioUnitario: true,
              precioOferta: true,
              codigoBarras: true,
              valoresAtributos: true,
              imagenUrl: true,
              stock: true,
              stocks: {
                ...(sedeId ? { where: { sedeId } } : {}),
                select: {
                  sedeId: true,
                  stock: true,
                  vendibleEnSede: true,
                  precioUnitarioOverride: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.cliente.findMany({
        where: {
          empresaId,
          estado: 'ACTIVO',
          persona: { in: ['CLIENTE', 'CLIENTE_PROVEEDOR', 'EMPRESA'] },
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          nombre: true,
          nroDoc: true,
          telefono: true,
          email: true,
          direccion: true,
          persona: true,
          tipoDocumento: { select: { codigo: true, descripcion: true } },
        },
      }),
      this.prisma.categoria.findMany({
        where: { empresaId },
        select: { id: true, nombre: true },
        orderBy: { nombre: 'asc' },
      }),
      this.tipoCambio.consultar().catch(() => null),
    ]);

    const n = (v: any) => (v == null ? null : Number(v));
    const useJamble = isJambleProvider(resolveBillingProvider(empresa as any));

    const productos = productosRaw.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      descripcion: p.descripcion,
      codigoBarras: p.codigoBarras,
      precioUnitario: Number(p.precioUnitario),
      precioOferta: n(p.precioOferta),
      ofertaActiva: p.ofertaActiva,
      fechaInicioOferta: p.fechaInicioOferta,
      fechaFinOferta: p.fechaFinOferta,
      moneda: p.moneda,
      tipoAfectacionIgv: p.tipoAfectacionIGV,
      igvPorcentaje: Number(p.igvPorcentaje ?? 18),
      categoriaId: p.categoriaId,
      imagenUrl: p.imagenUrl,
      stockGlobal: Number(p.stock),
      requiereReceta: p.requiereReceta,
      factorConversion: p.factorConversion,
      unidadVenta: p.unidadVenta,
      unidadMedida: p.unidadMedida?.codigo ?? 'NIU',
      esServicio:
        String((p.atributosTecnicos as any)?.tipoProducto || '').toUpperCase() ===
        'SERVICIO',
      preciosMayorista: p.preciosMayorista ?? [],
      opcionesAtributos: p.opcionesAtributos ?? null,
      codigosExtra: p.codigosBarras.map((c) => ({
        codigo: c.codigo,
        unidadesPorPaquete: c.unidadesPorPaquete,
        precioPaquete: n(c.precioPaquete),
        alias: c.alias,
        codigoInterno: c.codigoInterno,
      })),
      variantes: p.variantes.map((v) => ({
        id: v.id,
        codigo: v.codigo,
        descripcion: v.descripcion,
        precioUnitario: Number(v.precioUnitario),
        precioOferta: n(v.precioOferta),
        codigoBarras: v.codigoBarras,
        valoresAtributos: v.valoresAtributos ?? null,
        imagenUrl: v.imagenUrl,
        stockGlobal: Number(v.stock),
        stocks: v.stocks.map((s) => ({
          sedeId: s.sedeId,
          stock: Number(s.stock),
          vendibleEnSede: s.vendibleEnSede,
          precioOverride: n(s.precioUnitarioOverride),
        })),
      })),
      stocks: p.stocks.map((s) => ({
        sedeId: s.sedeId,
        stock: Number(s.stock),
        visibleEnSede: s.visibleEnSede,
        vendibleEnSede: s.vendibleEnSede,
        precioOverride: n(s.precioUnitarioOverride),
        precioOfertaOverride: n(s.precioOfertaOverride),
      })),
    }));

    const clientes = clientesRaw.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      tipoDoc: c.tipoDocumento?.codigo ?? null,
      tipoDocNombre: c.tipoDocumento?.descripcion ?? null,
      nroDoc: c.nroDoc,
      telefono: c.telefono,
      correo: c.email,
      direccion: c.direccion,
      persona: c.persona,
    }));

    const config = {
      permitirVentaSinStock: empresa.permitirVentaSinStock,
      requiereCajaParaEmitir: empresa.requiereCajaParaEmitir,
      ventaObservacionesDefault: empresa.ventaObservacionesDefault ?? '',
      catalogoPorSede: empresa.catalogoPorSede,
      kitsComoUnaLinea: empresa.kitsComoUnaLinea,
      paquetesComoUnaLinea: empresa.paquetesComoUnaLinea,
      // Series que asignará el servidor (solo informativo: el correlativo
      // definitivo lo pone el backend al sincronizar).
      series: {
        NV: 'NV01',
        TICKET: 'T001',
        '03': useJamble ? 'B001' : 'B0A1',
        '01': useJamble ? 'F001' : 'F0A1',
      },
      tipoCambioDia: tc ? { fecha: tc.fecha, compra: tc.compra, venta: tc.venta } : null,
    };

    const cuerpo = {
      empresaId,
      sedeId: sedeId ?? null,
      sedes: empresa.sedes,
      config,
      categorias,
      productos,
      clientes,
    };
    // La versión NO incluye el tipo de cambio (cambia a diario y no justifica
    // rebajar todo el catálogo).
    const version = createHash('sha1')
      .update(JSON.stringify({ ...cuerpo, config: { ...config, tipoCambioDia: null } }))
      .digest('hex');

    return { version, generadoEn: new Date().toISOString(), ...cuerpo };
  }
}
