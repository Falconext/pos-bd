import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ComprobanteService } from '../../comprobante/comprobante.service';
import { EnviarSunatService, SunatPayloadException } from '../../comprobante/enviar-sunat.service';
import { nuevoIdPublico } from '../facturacion/serializador';
import { estadoPublico } from '../facturacion/estado-publico';
import { ErpApiService } from './erp.service';
import { precioDeOferta } from './serializar-producto';
import { ventaSimulada } from './modo-prueba';
import {
  ItemVenta,
  LIMITE_BOLETA_SIN_DOCUMENTO,
  MEDIOS_PAGO,
  TIPOS_DOCUMENTO,
  Venta,
  leerVenta,
  tipoQueCorresponde,
} from './entrada-venta';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** El producto como lo necesita la venta, ya con lo de la sede. */
interface ProductoVenta {
  id: number;
  codigo: string;
  codigoBarras: string | null;
  descripcion: string;
  estado: string;
  precioUnitario: unknown;
  precioOferta: unknown;
  fechaInicioOferta: Date | null;
  fechaFinOferta: Date | null;
  moneda: string;
  tipoAfectacionIGV: string;
  productoPadreId: number | null;
  atributosTecnicos: unknown;
  _count: { variantes: number };
  stocks: { stock: unknown }[];
  codigosBarras: { codigo: string; codigoInterno: string | null; unidadesPorPaquete: number; precioPaquete: unknown; alias: string | null }[];
  lotes: { id: number; lote: string; stockActual: unknown; fechaVencimiento: Date }[];
}

/** Una línea ya resuelta, lista para la emisión. */
interface LineaResuelta {
  producto?: ProductoVenta;
  unidadesPorPaquete: number;
  descripcion: string;
  cantidad: number;
  precio: number;
  loteId?: number;
}

const DOC_PUBLICO: Record<string, string> = { '1': 'dni', '6': 'ruc', '4': 'ce', '7': 'passport' };
const MEDIO_PUBLICO = Object.fromEntries(Object.entries(MEDIOS_PAGO).map(([k, v]) => [v, k]));

/**
 * Ventas desde la web del propio negocio: `POST /v1/erp/sales`.
 *
 * No reimplementa nada fiscal. Arma lo mismo que manda el POS y llama a
 * `ComprobanteService` (boleta/factura) o a `crearInformal` (nota de venta):
 * mismo correlativo, mismo IGV, mismo kardex, misma caja. Lo propio de la API
 * es revisar ANTES de emitir —producto, stock, lote, cliente— para no gastar
 * un correlativo en una venta que no se puede hacer, y explicar qué falta.
 */
@Injectable()
export class ErpVentasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: ErpApiService,
    private readonly comprobantes: ComprobanteService,
    private readonly enviarSunat: EnviarSunatService,
  ) {}

  async crear(empresaId: number, body: unknown, prueba = false) {
    await this.erp.asegurarPlan(empresaId);
    const venta = leerVenta(body);
    const tipo = tipoQueCorresponde(venta);

    if (venta.externalId) {
      const previa = await this.prisma.ventaApi.findUnique({
        where: { empresaId_externalId: { empresaId, externalId: venta.externalId } },
        select: { id: true },
      });
      if (previa) {
        throw new ConflictException({
          code: 'duplicate_external_id',
          message: `El pedido ${venta.externalId} ya se registró como la venta ${previa.id}. Consúltala con GET /v1/erp/sales/${previa.id}.`,
          param: 'external_id',
          sale_id: previa.id,
        });
      }
    }

    const sedeId = venta.sedeId ? (await this.erp.sedeDe(empresaId, venta.sedeId))! : await this.erp.sedePrincipal(empresaId);
    const lineas = await this.resolverLineas(empresaId, sedeId, venta.items);

    const total = r2(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0));
    if (tipo === 'receipt' && !venta.cliente?.numero && total > LIMITE_BOLETA_SIN_DOCUMENTO) {
      throw new BadRequestException({
        code: 'customer_required',
        message: `Una boleta de más de S/ ${LIMITE_BOLETA_SIN_DOCUMENTO} (esta es de S/ ${total.toFixed(2)}) tiene que identificar al comprador: manda \`customer\` con su DNI.`,
        param: 'customer',
      });
    }

    if (prueba) {
      // Clave de prueba: todo lo de arriba se revisó de verdad. No se crea
      // el cliente, no se emite, no se mueve stock ni caja.
      const tipoDoc = TIPOS_DOCUMENTO[tipo];
      const sig = await this.comprobantes.siguienteCorrelativo(empresaId, tipoDoc).catch(() => null);
      const docPublico: Record<string, string> = { '1': 'dni', '6': 'ruc', '4': 'ce', '7': 'passport' };
      return ventaSimulada({
        tipo,
        numeroSiguiente: sig ? `${sig.serie}-${sig.correlativo}` : null,
        sedeId,
        externalId: venta.externalId,
        cliente: venta.cliente?.numero
          ? { tipo: docPublico[venta.cliente.tipoDocumento!], numero: venta.cliente.numero, nombre: venta.cliente.nombre }
          : undefined,
        medioPago: MEDIO_PUBLICO[venta.medioPago] ?? null,
        lineas: lineas.map((l) => ({
          productoId: l.producto?.id ?? null,
          sku: l.producto?.codigo ?? null,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          precio: l.precio,
          afectacion: l.producto ? String(l.producto.tipoAfectacionIGV ?? '10') : '10',
        })),
      });
    }

    const clienteId = await this.resolverCliente(empresaId, venta);
    const dto = await this.armarComprobante(tipo, venta, lineas, clienteId);

    const comp: any =
      tipo === 'sales_note'
        ? await this.comprobantes.crearInformal(dto, empresaId, undefined, sedeId)
        : await this.comprobantes.crearFormal(dto, empresaId, TIPOS_DOCUMENTO[tipo] as '01' | '03', undefined, sedeId);

    const id = nuevoIdPublico('sale');
    await this.prisma.ventaApi.create({
      data: { id, empresaId, comprobanteId: comp.id, externalId: venta.externalId ?? null },
    });

    if (tipo !== 'sales_note') this.enviar(comp.id);
    return this.obtener(empresaId, id);
  }

  async obtener(empresaId: number, id: string) {
    await this.erp.asegurarPlan(empresaId);
    const v = await this.prisma.ventaApi.findFirst({ where: { id: String(id), empresaId } });
    if (!v) {
      throw new NotFoundException({ code: 'resource_missing', message: `No existe la venta ${id} en este negocio.`, param: 'id' });
    }
    return this.serializar(v, await this.comprobanteDe(v.comprobanteId));
  }

  /** Lo más reciente primero; se pagina con `starting_after` (el id de la última). */
  async listar(empresaId: number, query: { limit?: string; starting_after?: string; external_id?: string }) {
    await this.erp.asegurarPlan(empresaId);
    const limite = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    let desde: Date | undefined;
    if (query.starting_after) {
      const ancla = await this.prisma.ventaApi.findFirst({ where: { id: query.starting_after, empresaId }, select: { creadoEn: true } });
      if (!ancla) throw new BadRequestException({ code: 'parameter_invalid', message: '`starting_after` no es una venta de este negocio.', param: 'starting_after' });
      desde = ancla.creadoEn;
    }
    const filas = await this.prisma.ventaApi.findMany({
      where: {
        empresaId,
        ...(query.external_id ? { externalId: String(query.external_id) } : {}),
        ...(desde ? { creadoEn: { lt: desde } } : {}),
      },
      orderBy: { creadoEn: 'desc' },
      take: limite + 1,
    });
    const pagina = filas.slice(0, limite);
    const data: ReturnType<ErpVentasService["serializar"]>[] = [];
    for (const v of pagina) data.push(this.serializar(v, await this.comprobanteDe(v.comprobanteId)));
    return { object: 'list', data, has_more: filas.length > limite };
  }

  // ─────────────────────────────────────────────────────────────────────

  /**
   * Encuentra cada producto y revisa que se pueda vender: activo, sin tallas
   * por elegir, con stock (menos lo reservado) y con lote si lo piden. Junta
   * las cantidades del mismo producto: dos líneas de 3 sacan 6.
   */
  private async resolverLineas(empresaId: number, sedeId: number, items: ItemVenta[]): Promise<LineaResuelta[]> {
    const ids = items.map((i) => i.productoId).filter((x): x is number => !!x);
    const skus = items.map((i) => i.sku).filter((x): x is string => !!x);
    const barras = items.map((i) => i.codigoBarras).filter((x): x is string => !!x);
    const productos: ProductoVenta[] = (ids.length || skus.length || barras.length)
      ? ((await this.prisma.producto.findMany({
          where: {
            empresaId,
            estado: { not: 'PLACEHOLDER' as never },
            OR: [
              ...(ids.length ? [{ id: { in: ids } }] : []),
              ...(skus.length ? [{ codigo: { in: skus } }, { codigosBarras: { some: { codigoInterno: { in: skus } } } }] : []),
              ...(barras.length ? [{ codigoBarras: { in: barras } }, { codigosBarras: { some: { codigo: { in: barras } } } }] : []),
            ],
          },
          select: {
            id: true,
            codigo: true,
            codigoBarras: true,
            descripcion: true,
            estado: true,
            precioUnitario: true,
            precioOferta: true,
            fechaInicioOferta: true,
            fechaFinOferta: true,
            moneda: true,
            tipoAfectacionIGV: true,
            productoPadreId: true,
            atributosTecnicos: true,
            _count: { select: { variantes: { where: { estado: 'ACTIVO' as never } } } },
            stocks: { where: { sedeId }, select: { stock: true } },
            codigosBarras: { select: { codigo: true, codigoInterno: true, unidadesPorPaquete: true, precioPaquete: true, alias: true } },
            lotes: { where: { activo: true }, select: { id: true, lote: true, stockActual: true, fechaVencimiento: true } },
          },
        })) as any)
      : [];

    const reservas = await this.erp.reservasDe(empresaId, productos);
    const lineas: LineaResuelta[] = [];
    const pedido = new Map<number, number>(); // unidades base pedidas por producto
    const porLote = new Map<string, number>();

    items.forEach((it, i) => {
      const donde = `items[${i}]`;
      if (!it.productoId && !it.sku && !it.codigoBarras) {
        lineas.push({ descripcion: it.descripcion!, cantidad: it.cantidad, precio: it.precio!, unidadesPorPaquete: 1 });
        return;
      }
      let paquete: ProductoVenta['codigosBarras'][number] | undefined;
      const p = productos.find((x) => {
        if (it.productoId) return x.id === it.productoId;
        if (it.sku) {
          if (x.codigo === it.sku) return true;
          paquete = x.codigosBarras.find((c) => c.codigoInterno === it.sku);
          return !!paquete;
        }
        if (x.codigoBarras === it.codigoBarras) return true;
        paquete = x.codigosBarras.find((c) => c.codigo === it.codigoBarras);
        return !!paquete;
      });
      const cual = it.productoId ? `el producto ${it.productoId}` : it.sku ? `el SKU ${it.sku}` : `el código de barras ${it.codigoBarras}`;
      if (!p) {
        throw new NotFoundException({ code: 'product_not_found', message: `${donde}: no existe ${cual} en este negocio.`, param: donde });
      }
      if (p.estado !== 'ACTIVO') {
        throw new BadRequestException({ code: 'product_inactive', message: `${donde}: ${p.descripcion} está desactivado y no se vende.`, param: donde });
      }
      if (p._count.variantes > 0) {
        throw new BadRequestException({
          code: 'product_has_variants',
          message: `${donde}: ${p.descripcion} tiene tallas o colores. Manda el id de la variante (está en \`variants\` de GET /v1/erp/products/${p.id}).`,
          param: `${donde}.product_id`,
        });
      }
      const unidades = paquete && paquete.unidadesPorPaquete > 1 ? paquete.unidadesPorPaquete : 1;
      let precio = it.precio;
      if (precio === undefined) {
        if (String(p.moneda).toUpperCase() === 'USD') {
          throw new BadRequestException({
            code: 'price_required',
            message: `${donde}: ${p.descripcion} tiene su precio en dólares. Manda \`${donde}.unit_price\` en soles (con IGV).`,
            param: `${donde}.unit_price`,
          });
        }
        if (unidades > 1) {
          precio = paquete!.precioPaquete != null ? Number(paquete!.precioPaquete) : r2(Number(p.precioUnitario) * unidades);
        } else {
          precio = precioDeOferta(p as any) ?? Number(p.precioUnitario);
        }
      }

      const esServicio = String((p.atributosTecnicos as any)?.tipoProducto ?? '').toUpperCase() === 'SERVICIO';
      let loteId: number | undefined;
      if (!esServicio) {
        pedido.set(p.id, r3((pedido.get(p.id) ?? 0) + it.cantidad * unidades));
        if (it.lote) {
          const lote = p.lotes.find((l) => l.lote === it.lote);
          if (!lote) {
            throw new BadRequestException({
              code: 'batch_not_found',
              message: `${donde}: ${p.descripcion} no tiene un lote activo ${it.lote}.${p.lotes.length ? ` Lotes con stock: ${p.lotes.map((l) => l.lote).join(', ')}.` : ''}`,
              param: `${donde}.batch`,
            });
          }
          if (lote.fechaVencimiento < new Date()) {
            throw new BadRequestException({
              code: 'batch_expired',
              message: `${donde}: el lote ${lote.lote} de ${p.descripcion} venció el ${lote.fechaVencimiento.toISOString().slice(0, 10)} y no se vende.`,
              param: `${donde}.batch`,
            });
          }
          loteId = lote.id;
          porLote.set(`${p.id}|${lote.id}`, r3((porLote.get(`${p.id}|${lote.id}`) ?? 0) + it.cantidad * unidades));
        }
      }
      lineas.push({
        producto: p,
        unidadesPorPaquete: unidades,
        descripcion: paquete?.alias || p.descripcion,
        cantidad: it.cantidad,
        precio: r2(precio),
        loteId,
      });
    });

    // Stock, con todas las líneas del mismo producto sumadas.
    const faltan: string[] = [];
    const hoy = new Date();
    for (const [productoId, cantidad] of pedido) {
      const p = productos.find((x) => x.id === productoId)!;
      const enSede = r3(Number(p.stocks[0]?.stock ?? 0));
      const disponible = r3(enSede - (reservas.get(`${productoId}-${sedeId}`) ?? 0));
      if (cantidad > disponible) {
        faltan.push(`${p.descripcion} (piden ${cantidad}, hay ${Math.max(0, disponible)}${disponible !== enSede ? ` libres de ${enSede}` : ''})`);
        continue;
      }
      // Con lotes y sin lote elegido, sale del que vence primero, solo de los vigentes.
      if (p.lotes.length) {
        const sinLote = cantidad - [...porLote].filter(([k]) => k.startsWith(`${productoId}|`)).reduce((s, [, v]) => s + v, 0);
        const vigentes = r3(p.lotes.filter((l) => l.fechaVencimiento >= hoy).reduce((s, l) => s + Number(l.stockActual), 0));
        if (sinLote > 0 && sinLote > vigentes) {
          faltan.push(`${p.descripcion} (sin vencer hay ${vigentes} en sus lotes)`);
        }
      }
    }
    for (const [clave, cantidad] of porLote) {
      const [productoId, loteId] = clave.split('|').map(Number);
      const lote = productos.find((x) => x.id === productoId)!.lotes.find((l) => l.id === loteId)!;
      if (cantidad > Number(lote.stockActual)) {
        faltan.push(`lote ${lote.lote} (piden ${cantidad}, tiene ${r3(Number(lote.stockActual))})`);
      }
    }
    if (faltan.length) {
      throw new ConflictException({
        code: 'insufficient_stock',
        message: `No hay stock suficiente en la sede: ${faltan.join('; ')}. No se emitió nada.`,
        param: 'items',
      });
    }
    return lineas;
  }

  /**
   * Con documento, el cliente se busca por su número dentro del negocio (o se
   * crea): por nombre llenaría la cartera de duplicados. Sin documento, va a
   * CLIENTES VARIOS, que el sistema crea con cada empresa; si alguien lo
   * borró (ZABDI, 2026-10-22) se vuelve a crear igual que al registrarla.
   */
  private async resolverCliente(empresaId: number, venta: Venta): Promise<number> {
    const c = venta.cliente;
    if (c?.numero && c.tipoDocumento) {
      const existente = await this.prisma.cliente.findFirst({
        where: { empresaId, nroDoc: c.numero },
        select: { id: true, email: true, direccion: true, telefono: true, estado: true },
      });
      if (existente) {
        const faltantes: Record<string, string> = {};
        if (c.email && !existente.email) faltantes.email = c.email;
        if (c.direccion && !existente.direccion) faltantes.direccion = c.direccion;
        if (c.telefono && !existente.telefono) faltantes.telefono = c.telefono;
        if (Object.keys(faltantes).length) {
          await this.prisma.cliente.update({ where: { id: existente.id }, data: faltantes });
        }
        return existente.id;
      }
      const tipo = await this.prisma.tipoDocumento.findUnique({ where: { codigo: c.tipoDocumento }, select: { id: true } });
      const creado = await this.prisma.cliente.create({
        data: {
          empresaId,
          nombre: c.nombre!,
          nroDoc: c.numero,
          tipoDocumentoId: tipo?.id ?? null,
          email: c.email ?? null,
          direccion: c.direccion ?? null,
          telefono: c.telefono ?? null,
        },
        select: { id: true },
      });
      return creado.id;
    }
    const varios = await this.prisma.cliente.findFirst({
      where: { empresaId, nombre: 'CLIENTES VARIOS', estado: 'ACTIVO' as never },
      select: { id: true },
    });
    if (varios) return varios.id;
    const creado = await this.prisma.cliente.create({
      data: {
        nombre: 'CLIENTES VARIOS',
        nroDoc: '10000000',
        estado: 'ACTIVO' as never,
        empresa: { connect: { id: empresaId } },
        tipoDocumento: { connect: { codigo: '1' } },
      },
      select: { id: true },
    });
    return creado.id;
  }

  /** Lo mismo que arma el POS al cobrar al contado. */
  private async armarComprobante(tipo: string, venta: Venta, lineas: LineaResuelta[], clienteId: number) {
    const operacion = await this.prisma.tipoOperacion.findUnique({ where: { codigo: '0101' }, select: { id: true } });
    const nombre = venta.cliente?.numero ? venta.cliente.nombre! : venta.cliente?.nombre || 'CLIENTES VARIOS';
    return {
      tipoDoc: TIPOS_DOCUMENTO[tipo as keyof typeof TIPOS_DOCUMENTO],
      tipoOperacionId: operacion?.id,
      fechaEmision: undefined,
      formaPagoTipo: 'Contado',
      formaPagoMoneda: 'PEN',
      tipoMoneda: 'PEN',
      clienteId,
      // El backend solo reemplaza al cliente por CLIENTES VARIOS si el nombre es
      // exactamente ese; con nombre y sin documento se respeta el id resuelto.
      clienteName: venta.cliente?.numero ? nombre : 'CLIENTES VARIOS',
      leyenda: '',
      medioPago: venta.medioPago,
      paymentDetails: { method: venta.medioPago, referencia: venta.referenciaPago },
      observaciones: [venta.notas, venta.externalId ? `Pedido web ${venta.externalId}` : null, !venta.cliente?.numero && venta.cliente?.nombre ? `Cliente: ${venta.cliente.nombre}` : null]
        .filter(Boolean)
        .join(' · ') || undefined,
      detalles: lineas.map((l) =>
        l.producto
          ? {
              productoId: l.producto.id,
              cantidad: l.cantidad,
              nuevoValorUnitario: l.precio,
              ...(l.unidadesPorPaquete > 1 ? { unidadesPorPaquete: l.unidadesPorPaquete, descripcion: l.descripcion } : {}),
              ...(l.loteId ? { loteId: l.loteId } : {}),
            }
          : {
              productoId: null,
              descripcion: l.descripcion,
              cantidad: l.cantidad,
              nuevoValorUnitario: l.precio,
              unidadVenta: 'ZZ',
            },
      ),
    };
  }

  /**
   * A SUNAT sin hacer esperar a la web: puede tardar, y un timeout del lado de
   * la web es justo lo que hace reintentar y duplicar. Queda `pending` y se
   * consulta con GET. Si falla la red, el scheduler lo reintenta solo; si los
   * datos son inválidos, queda marcado con el motivo (no se borra: la web
   * tiene su id y tiene que poder ver qué pasó).
   */
  private enviar(comprobanteId: number) {
    void this.enviarSunat.execute(comprobanteId).catch(async (e) => {
      console.error(`[api-erp] envío a SUNAT falló para el comprobante ${comprobanteId}:`, e?.message);
      try {
        await this.comprobantes.registrarErrorSunat(
          comprobanteId,
          e instanceof SunatPayloadException ? `Datos inválidos para SUNAT: ${e.message}` : e?.message || 'Error al enviar a SUNAT',
        );
      } catch {
        /* el scheduler lo recoge igual */
      }
    });
  }

  private comprobanteDe(id: number) {
    return this.prisma.comprobante.findUnique({
      where: { id },
      include: {
        cliente: { select: { nombre: true, nroDoc: true, tipoDocumento: { select: { codigo: true } } } },
        detalles: { include: { producto: { select: { codigo: true } } } },
      },
    }) as Promise<any>;
  }

  serializar(v: { id: string; externalId: string | null; creadoEn: Date }, c: any) {
    const tipo = (Object.keys(TIPOS_DOCUMENTO) as (keyof typeof TIPOS_DOCUMENTO)[]).find((k) => TIPOS_DOCUMENTO[k] === c.tipoDoc) ?? 'sales_note';
    const status = tipo === 'sales_note' ? (c.estadoEnvioSunat === 'ANULADO' ? 'voided' : 'registered') : estadoPublico(c);
    const conDoc = c.cliente && c.cliente.nroDoc && c.cliente.nombre !== 'CLIENTES VARIOS';
    return {
      object: 'sale',
      livemode: true,
      id: v.id,
      external_id: v.externalId,
      document_type: tipo,
      number: `${c.serie}-${c.correlativo}`,
      status,
      sunat_message: tipo !== 'sales_note' && ['FALLIDO_ENVIO', 'RECHAZADO'].includes(c.estadoEnvioSunat) ? c.sunatErrorMsg ?? null : null,
      issued_at: c.fechaEmision,
      location_id: c.sedeId,
      customer: conDoc
        ? { document_type: DOC_PUBLICO[c.cliente.tipoDocumento?.codigo] ?? null, document_number: c.cliente.nroDoc, name: c.cliente.nombre }
        : null,
      items: (c.detalles ?? []).map((d: any) => ({
        product_id: d.productoId ?? null,
        sku: d.producto?.codigo ?? null,
        description: d.descripcion,
        quantity: Number(d.cantidad),
        unit_price: r2(Number(d.mtoPrecioUnitario ?? 0)),
        total: r2(Number(d.mtoValorVenta ?? 0) + Number(d.igv ?? 0)),
      })),
      subtotal: r2(Number(c.mtoOperGravadas ?? 0) + Number(c.mtoOperExoneradas ?? 0) + Number(c.mtoOperInafectas ?? 0)),
      igv: r2(Number(c.mtoIGV ?? 0)),
      total: r2(Number(c.mtoImpVenta ?? 0)),
      currency: 'PEN',
      payment: { method: MEDIO_PUBLICO[String(c.medioPago ?? '').toUpperCase()] ?? null },
      pdf_url: c.s3PdfUrl ?? null,
      created_at: v.creadoEn,
    };
  }
}
