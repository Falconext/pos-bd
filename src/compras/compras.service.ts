import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KardexService } from '../kardex/kardex.service';
import { ProductoLoteService } from '../producto/producto-lote.service';
import { CajaService } from '../caja/caja.service';
import { CrearCompraDto } from './dto/crear-compra.dto';
import { Prisma } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import { parseFechaSoloDia } from '../common/utils/fecha';

@Injectable()
export class ComprasService {
  constructor(
    private prisma: PrismaService,
    private kardexService: KardexService,
    private productoLoteService: ProductoLoteService,
    private cajaService: CajaService,
  ) {}

  /**
   * Registra en caja el EGRESO por el pago de una compra, SOLO cuando el pago
   * fue en EFECTIVO y hay una caja abierta para ese usuario/sede. Los pagos por
   * banco/transferencia/Yape NO tocan la caja física (ya se reflejan en finanzas).
   * Es best-effort: nunca bloquea ni revierte la compra si algo falla.
   */
  private async registrarEgresoCajaSiEfectivo(params: {
    metodo?: string;
    monto: number;
    empresaId: number;
    usuarioId?: number;
    sedeId?: number;
    compraId: number;
    serie: string;
    numero: string;
  }) {
    const esEfectivo =
      String(params.metodo || '')
        .toUpperCase()
        .trim() === 'EFECTIVO';
    if (!esEfectivo || !(params.monto > 0) || !params.usuarioId) return;
    try {
      const cajaAbierta = await this.cajaService.verificarCajaAbierta(
        params.usuarioId,
        params.empresaId,
        params.sedeId,
      );
      // Sin caja abierta no se registra el egreso (la compra queda igual).
      if (!cajaAbierta) return;
      await this.prisma.movimientoCaja.create({
        data: {
          usuarioId: params.usuarioId,
          empresaId: params.empresaId,
          sedeId: params.sedeId ?? null,
          tipoMovimiento: 'EGRESO',
          monto: this.roundMoney(params.monto),
          categoriaGasto: 'COMPRA',
          descripcionGasto: `Pago de compra ${params.serie}-${params.numero}`,
          metodoPago: 'Efectivo',
          estado: 'ACTIVO',
          compraId: params.compraId,
        },
      });
    } catch (error) {
      console.error(
        'No se pudo registrar el egreso de caja por la compra:',
        error,
      );
    }
  }

  private readonly saldoTolerance = 0.01;

  private roundMoney(value: number) {
    return parseFloat((Number(value) || 0).toFixed(2));
  }

  // Normaliza y deduplica las series/IMEI de una línea (trim + mayúsculas),
  // descartando vacíos. Devuelve [] si no hay series válidas.
  private normalizarNumerosSerie(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const vistos = new Set<string>();
    const result: string[] = [];
    for (const raw of value) {
      const normalized = String(raw ?? '')
        .trim()
        .toUpperCase();
      if (!normalized || vistos.has(normalized)) continue;
      vistos.add(normalized);
      result.push(normalized);
    }
    return result;
  }

  // Calcula la fecha límite de garantía a partir de los meses indicados.
  private calcularGarantiaHasta(garantiaMeses: unknown): Date | null {
    if (garantiaMeses == null || garantiaMeses === '') return null;
    const meses = Number(garantiaMeses);
    if (!Number.isInteger(meses) || meses <= 0) return null;
    const hasta = new Date();
    hasta.setMonth(hasta.getMonth() + meses);
    return hasta;
  }

  private normalizeEstadoPagoBySaldo(total: number, saldo: number) {
    const safeTotal = this.roundMoney(total);
    const safeSaldo = Math.max(0, this.roundMoney(saldo));
    if (safeSaldo <= this.saldoTolerance) return 'COMPLETADO';
    if (safeSaldo < safeTotal - this.saldoTolerance) return 'PAGO_PARCIAL';
    return 'PENDIENTE_PAGO';
  }

  private normalizeCompraForResponse<
    T extends { total: any; saldo: any; estadoPago: any },
  >(compra: T): T {
    const saldo = Math.max(0, this.roundMoney(Number(compra.saldo ?? 0)));
    return {
      ...compra,
      saldo,
      estadoPago: this.normalizeEstadoPagoBySaldo(
        Number(compra.total ?? 0),
        saldo,
      ) as any,
    };
  }

  async crear(
    empresaId: number,
    usuarioId: number,
    data: CrearCompraDto,
    reqSedeId?: number,
  ) {
    const duplicado = await this.prisma.compra.findFirst({
      where: { empresaId, serie: data.serie, numero: data.numero },
      select: { id: true },
    });
    if (duplicado) {
      throw new BadRequestException(
        `Ya existe una compra registrada con la serie ${data.serie} y número ${data.numero}.`,
      );
    }

    // Series / IMEI: normalizar y validar unicidad ANTES de crear la compra,
    // para no dejar la compra registrada con series a medias.
    const seriesPorLinea = data.detalles.map((item) =>
      this.normalizarNumerosSerie(item.numerosSerie),
    );
    const todasLasSeries = seriesPorLinea.flat();
    if (todasLasSeries.length) {
      // Duplicados dentro del mismo payload
      const vistos = new Set<string>();
      for (const s of todasLasSeries) {
        if (vistos.has(s)) {
          throw new BadRequestException(
            `La serie "${s}" está repetida en la compra.`,
          );
        }
        vistos.add(s);
      }
      // Duplicados contra series ya registradas en la empresa
      const existentes = await this.prisma.productoSerie.findMany({
        where: { empresaId, numeroSerie: { in: todasLasSeries } },
        select: { numeroSerie: true },
      });
      if (existentes.length) {
        throw new BadRequestException(
          `La(s) serie(s) ${existentes
            .map((e) => e.numeroSerie)
            .join(', ')} ya están registradas en el sistema.`,
        );
      }
    }

    let subtotal = 0;
    let totalLineas = 0;

    // Sede/almacén destino del stock:
    // 1) si la compra indica una sede destino explícita, se valida que pertenezca
    //    a la empresa y esté activa (permite comprar hacia cualquier almacén);
    // 2) si no, se usa la sede del token;
    // 3) como respaldo (admin sin sede asignada), la sede principal.
    let sedeId = reqSedeId;
    if (data.sedeId) {
      const destino = await this.prisma.sede.findFirst({
        where: { id: Number(data.sedeId), empresaId, activo: true },
        select: { id: true },
      });
      if (!destino) {
        throw new BadRequestException(
          'La sede/almacén destino no es válida o no pertenece a la empresa.',
        );
      }
      sedeId = destino.id;
    }
    if (!sedeId) {
      const principal = await this.prisma.sede.findFirst({
        where: { empresaId, esPrincipal: true, activo: true },
        select: { id: true },
      });
      if (!principal) {
        throw new BadRequestException(
          'No se pudo determinar la sede. Asigne una sede al usuario o configure una sede principal.',
        );
      }
      sedeId = principal.id;
    }

    // Prepare detail data and calculate totals from items to be safe
    const detallesData: any[] = [];

    for (const item of data.detalles) {
      // costoNeto = precio sin IGV, usado para actualizar costoPromedio en kardex
      // Si incluyeIgv=true el precio ingresado ya trae el IGV embebido → extraerlo
      const precioIngresado = Number(item.precioUnitario);
      const costoNeto = item.incluyeIgv
        ? parseFloat((precioIngresado / 1.18).toFixed(4))
        : precioIngresado;
      const igvItem = parseFloat((costoNeto * 0.18).toFixed(4));
      const sub = costoNeto * Number(item.cantidad);
      const totalLinea = item.incluyeIgv
        ? precioIngresado * Number(item.cantidad)
        : (costoNeto + igvItem) * Number(item.cantidad);

      subtotal += sub;
      totalLineas += totalLinea;

      detallesData.push({
        productoId: item.productoId,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: costoNeto, // siempre neto en DB
        subtotal: sub,
        igv: totalLinea - sub,
        total: totalLinea,
        lote: item.lote,
        fechaVencimiento: item.fechaVencimiento
          ? parseFechaSoloDia(item.fechaVencimiento)
          : null,
      });
    }

    // Calculate final totals
    const subtotalTotal = this.roundMoney(subtotal);
    const total = this.roundMoney(
      data.total !== undefined ? Number(data.total) : totalLineas,
    );
    const igvTotal = this.roundMoney(
      data.igv !== undefined ? Number(data.igv) : total - subtotalTotal,
    );
    const montoPagadoInicial = Math.max(
      0,
      this.roundMoney(Number(data.montoPagadoInicial) || 0),
    );
    const saldoInicial = Math.max(
      0,
      this.roundMoney(total - montoPagadoInicial),
    );
    const estadoPagoInicial = this.normalizeEstadoPagoBySaldo(
      total,
      saldoInicial,
    );

    // Create Purchase Transaction
    const compra = await this.prisma.$transaction(async (tx) => {
      return await tx.compra.create({
        include: { detalles: { orderBy: { id: 'asc' } } },
        data: {
          empresaId,
          proveedorId: data.proveedorId,
          usuarioId,
          tipoDoc: data.tipoDoc || 'FACTURA',
          serie: data.serie,
          numero: data.numero,
          fechaEmision: new Date(data.fechaEmision),
          fechaVencimiento: data.fechaVencimiento
            ? new Date(data.fechaVencimiento)
            : null,
          moneda: data.moneda || 'PEN',
          tipoCambio: data.tipoCambio,
          subtotal: subtotalTotal,
          igv: igvTotal,
          total,
          saldo: saldoInicial,
          estado: 'REGISTRADO',
          estadoPago: estadoPagoInicial as any,
          observaciones: data.observaciones,
          // Save installments
          cuotas: data.cuotas ? JSON.stringify(data.cuotas) : undefined,
          detalles: {
            create: detallesData,
          },
          sedeId: sedeId, // Guardar la sede a nivel de la cabecera de la compra
          pagos:
            montoPagadoInicial > 0
              ? {
                  create: {
                    empresaId,
                    usuarioId,
                    monto: montoPagadoInicial,
                    metodoPago: data.metodoPagoInicial || 'EFECTIVO',
                    // Pago por banco: N° de operación + cuenta bancaria usada.
                    referencia: data.referenciaInicial || undefined,
                    cuentaBancariaId: data.cuentaBancariaIdInicial || undefined,
                    fecha: new Date(),
                  },
                }
              : undefined,
        },
      });
    });

    // Update Inventory (Kardex)
    // We do this outside the transaction because KardexService manages its own logic.
    // In a production system, we might want to wrap this in the transaction or use a saga.
    for (const item of data.detalles) {
      if (item.productoId) {
        try {
          // costoPromedio siempre se actualiza con el precio NETO (sin IGV)
          const costoNetoKardex = item.incluyeIgv
            ? parseFloat((Number(item.precioUnitario) / 1.18).toFixed(4))
            : Number(item.precioUnitario);
          const movimiento = await this.kardexService.registrarMovimiento({
            empresaId,
            productoId: item.productoId,
            tipoMovimiento: 'INGRESO',
            concepto: `COMPRA ${compra.serie}-${compra.numero}`,
            cantidad: Number(item.cantidad),
            costoUnitario: costoNetoKardex,
            compraId: compra.id,
            usuarioId,
            sedeId,
            lote: item.lote,
            fechaVencimiento: item.fechaVencimiento
              ? parseFechaSoloDia(item.fechaVencimiento)
              : undefined,
          });

          // Sincronizar ProductoLote para FEFO (sin double-contar stock global)
          if (item.lote && item.fechaVencimiento) {
            await this.productoLoteService
              .sincronizarLoteDesdeIngreso({
                productoId: item.productoId,
                empresaId,
                lote: item.lote,
                fechaVencimiento: parseFechaSoloDia(item.fechaVencimiento),
                cantidad: Number(item.cantidad),
                costoUnitario: costoNetoKardex,
                movimientoKardexId: movimiento.id,
              })
              .catch((err) => {
                throw new Error(
                  `Error sincronizando lote "${item.lote}" del producto "${item.descripcion ?? item.productoId}": ${err.message}`,
                );
              });
          }
        } catch (error) {
          console.error(
            `Error updating kardex for product ${item.productoId}:`,
            error,
          );
          // Continue with other items, or flag warning?
        }
      }
    }

    // Registrar series / IMEI de la compra como ProductoSerie DISPONIBLE.
    // Se enlazan a la compra y a su línea; las series son opcionales (pueden
    // completarse luego desde Kardex → Series y Garantías).
    if (todasLasSeries.length) {
      const detallesCreados = (compra as any).detalles ?? [];
      const seriesData: Prisma.ProductoSerieCreateManyInput[] = [];
      for (let i = 0; i < data.detalles.length; i++) {
        const series = seriesPorLinea[i];
        if (!series.length) continue;
        const item = data.detalles[i];
        const detalle = detallesCreados[i];
        if (!item.productoId || !detalle) continue;
        const garantiaHasta = this.calcularGarantiaHasta(item.garantiaMeses);
        for (const numeroSerie of series) {
          seriesData.push({
            empresaId,
            productoId: Number(item.productoId),
            sedeId: sedeId ?? null,
            numeroSerie,
            estado: 'DISPONIBLE',
            garantiaMeses:
              item.garantiaMeses != null ? Number(item.garantiaMeses) : null,
            garantiaHasta,
            compraId: compra.id,
            compraDetalleId: detalle.id,
          });
        }
      }
      if (seriesData.length) {
        try {
          await this.prisma.productoSerie.createMany({ data: seriesData });
        } catch (error) {
          console.error('No se pudieron registrar las series de la compra:', error);
        }
      }
    }

    // Guardar/actualizar equivalencias de productos importados desde XML por proveedor.
    // Esto permite autovincular próximas importaciones del mismo proveedor.
    try {
      const proveedor = await this.prisma.cliente.findFirst({
        where: { id: data.proveedorId, empresaId },
        select: { nroDoc: true },
      });
      const proveedorRuc = this.normalizarCodigoXml(proveedor?.nroDoc || '');
      if (proveedorRuc) {
        const vinculables = data.detalles
          .filter((d: any) => d.productoId && d.codigoXml)
          .map((d: any) => ({
            productoId: Number(d.productoId),
            codigoXml: this.normalizarCodigoXml(d.codigoXml),
            descripcion: String(d.descripcion || '').trim() || null,
          }))
          .filter((d: any) => d.codigoXml);

        if (vinculables.length) {
          await this.prisma.$transaction(
            vinculables.map((v: any) =>
              this.prisma.vinculoProductoProveedorXml.upsert({
                where: {
                  empresaId_proveedorRuc_codigoXml: {
                    empresaId,
                    proveedorRuc,
                    codigoXml: v.codigoXml,
                  },
                },
                create: {
                  empresaId,
                  proveedorRuc,
                  codigoXml: v.codigoXml,
                  productoId: v.productoId,
                  descripcionXml: v.descripcion,
                },
                update: {
                  productoId: v.productoId,
                  descripcionXml: v.descripcion,
                },
              }),
            ),
          );
        }
      }
    } catch (error) {
      // No bloquear la compra si falla el guardado de equivalencias.
      console.error(
        'No se pudo guardar equivalencias XML de proveedor:',
        error,
      );
    }

    // Pago inicial en efectivo → egreso de caja (si hay caja abierta).
    // OJO: la caja es la del USUARIO (de donde sale el efectivo = su sede de
    // sesión reqSedeId), no la sede destino del stock. Así, comprar stock para
    // otro almacén descuenta el efectivo de la caja donde realmente se paga.
    if (montoPagadoInicial > 0) {
      await this.registrarEgresoCajaSiEfectivo({
        metodo: data.metodoPagoInicial,
        monto: montoPagadoInicial,
        empresaId,
        usuarioId,
        sedeId: reqSedeId,
        compraId: compra.id,
        serie: compra.serie,
        numero: compra.numero,
      });
    }

    return this.normalizeCompraForResponse(compra);
  }

  async listar(empresaId: number, query: any, sedeId?: number) {
    const {
      page = 1,
      limit = 10,
      search,
      estadoPago,
      fechaInicio,
      fechaFin,
    } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const estadoPagoFiltro =
      estadoPago === 'PAGADO'
        ? 'COMPLETADO'
        : estadoPago === 'PARCIAL'
          ? 'PAGO_PARCIAL'
          : estadoPago === 'PENDIENTE'
            ? 'PENDIENTE_PAGO'
            : estadoPago;

    // Principal sede: include legacy records with sedeId=null (created before JWT sedeId fix)
    let sedeFilter: any = {};
    if (sedeId) {
      const esPrincipal = await this.prisma.sede.findFirst({
        where: { empresaId, id: sedeId, esPrincipal: true },
        select: { id: true },
      });
      if (esPrincipal) {
        sedeFilter = { AND: [{ OR: [{ sedeId }, { sedeId: null }] }] };
      } else {
        sedeFilter = { sedeId };
      }
    }

    const where: Prisma.CompraWhereInput = {
      empresaId,
      ...sedeFilter,
      ...(estadoPagoFiltro ? { estadoPago: estadoPagoFiltro } : {}),
      ...(fechaInicio
        ? {
            fechaEmision: {
              gte: new Date(fechaInicio),
              ...(fechaFin ? { lte: new Date(fechaFin + 'T23:59:59') } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { serie: { contains: search, mode: 'insensitive' } },
              { numero: { contains: search, mode: 'insensitive' } },
              {
                proveedor: {
                  nombre: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    await this.prisma.compra.updateMany({
      where: {
        empresaId,
        ...sedeFilter,
        saldo: { lte: new Prisma.Decimal(this.saldoTolerance) },
        estadoPago: { in: ['PENDIENTE_PAGO', 'PAGO_PARCIAL'] as any },
      },
      data: {
        saldo: 0,
        estadoPago: 'COMPLETADO' as any,
      },
    });

    const [data, total] = await Promise.all([
      this.prisma.compra.findMany({
        where,
        skip,
        take: Number(limit),
        include: { proveedor: true },
        orderBy: { fechaEmision: 'desc' },
      }),
      this.prisma.compra.count({ where }),
    ]);

    return {
      data: data.map((compra) => this.normalizeCompraForResponse(compra)),
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  async obtenerPorId(empresaId: number, id: number, _sedeId?: number) {
    // Aislar por empresa (no por sede activa): una compra puede tener como
    // sede destino un almacén distinto al de la sesión del usuario, y la lista
    // ya muestra compras de todas las sedes. Filtrar por sedeId aquí rompía el
    // detalle de compras hechas para otra sede ("Compra no encontrada").
    const compra = await this.prisma.compra.findFirst({
      where: { id, empresaId },
      include: {
        proveedor: true,
        detalles: {
          include: {
            producto: true,
          },
        },
        pagos: true,
        usuario: true,
        sede: { select: { id: true, nombre: true, tipo: true } },
      },
    });

    if (!compra) throw new NotFoundException('Compra no encontrada');
    return this.normalizeCompraForResponse(compra);
  }

  async registrarPago(
    empresaId: number,
    usuarioId: number,
    compraId: number,
    data: any,
    sedeId?: number,
  ) {
    // Aislar por empresa (no por sede activa): la compra puede ser de otra sede
    // destino; el pago se registra igual y su egreso de caja usa la sede del
    // usuario (sedeId) más abajo.
    const compra = await this.prisma.compra.findFirst({
      where: { id: compraId, empresaId },
    });

    if (!compra) throw new NotFoundException('Compra no encontrada');

    const monto = Number(data.monto);
    if (monto <= 0)
      throw new BadRequestException('El monto debe ser mayor a 0');
    if (monto > Number(compra.saldo) + 0.1)
      throw new BadRequestException('El monto excede el saldo pendiente');

    const nuevoSaldo = Math.max(
      0,
      this.roundMoney(Number(compra.saldo) - monto),
    );
    const nuevoEstadoPago = this.normalizeEstadoPagoBySaldo(
      Number(compra.total),
      nuevoSaldo,
    );

    // Transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create Pago
      const pago = await tx.pagoCompra.create({
        data: {
          empresaId,
          usuarioId,
          compraId,
          monto,
          metodoPago: data.medioPago || 'EFECTIVO', // Frontend sends 'medioPago', backend uses 'metodoPago'
          referencia: data.referencia,
        },
      });

      // Update Compra
      const compraUpdated = await tx.compra.update({
        where: { id: compraId },
        data: {
          saldo: nuevoSaldo,
          estadoPago: nuevoEstadoPago,
        },
      });

      const normalized = this.normalizeCompraForResponse(compraUpdated);
      return {
        pago,
        nuevoSaldo: Number(normalized.saldo),
        nuevoEstado: normalized.estadoPago,
      };
    });

    // Abono en efectivo → egreso de caja (si hay caja abierta).
    await this.registrarEgresoCajaSiEfectivo({
      metodo: data.medioPago,
      monto,
      empresaId,
      usuarioId,
      sedeId,
      compraId,
      serie: compra.serie,
      numero: compra.numero,
    });

    return { success: true, ...result };
  }

  async parseXmlSunat(empresaId: number, buffer: Buffer) {
    const sniff = buffer
      .toString('ascii', 0, Math.min(buffer.length, 300))
      .toLowerCase();
    const isLatin1 =
      sniff.includes('encoding="iso-8859-1"') ||
      sniff.includes("encoding='iso-8859-1'");
    const xmlText = isLatin1
      ? buffer.toString('latin1')
      : buffer.toString('utf-8');

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      parseTagValue: true,
      parseAttributeValue: false,
      isArray: (tagName: string) =>
        [
          'InvoiceLine',
          'CreditNoteLine',
          'DebitNoteLine',
          'TaxTotal',
          'TaxSubtotal',
        ].includes(tagName),
    });

    let parsed: any;
    try {
      parsed = parser.parse(xmlText);
    } catch {
      throw new BadRequestException('El archivo no es un XML válido');
    }

    const doc = parsed.Invoice ?? parsed.CreditNote ?? parsed.DebitNote;
    if (!doc) {
      throw new BadRequestException(
        'El XML no corresponde a una Factura, Boleta o Nota de Crédito/Débito SUNAT',
      );
    }

    // Helpers para extraer valor de tags con o sin atributos
    const tv = (v: any): string => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && '#text' in v) return String(v['#text']);
      return String(v);
    };
    const tn = (v: any): number => parseFloat(tv(v)) || 0;

    // Cabecera
    const docId = tv(doc.ID);
    const dashIdx = docId.lastIndexOf('-');
    const serie = dashIdx > 0 ? docId.substring(0, dashIdx) : docId;
    const numero = dashIdx > 0 ? docId.substring(dashIdx + 1) : '';

    const typeCode = tv(doc.InvoiceTypeCode ?? doc.ResponseCode ?? '01');
    const tipoDocMap: Record<string, string> = {
      '01': 'FACTURA',
      '03': 'BOLETA',
      '07': 'NOTA_CREDITO',
      '08': 'NOTA_DEBITO',
    };
    const tipoDoc = tipoDocMap[typeCode] ?? 'FACTURA';

    const fechaEmision = tv(doc.IssueDate);
    const moneda = tv(doc.DocumentCurrencyCode) || 'PEN';

    // Proveedor desde el XML
    const supplierParty = doc.AccountingSupplierParty?.Party ?? {};
    const proveedorRuc = tv(supplierParty.PartyIdentification?.ID).trim();
    const proveedorRucNorm = this.normalizarCodigoXml(proveedorRuc);
    const proveedorNombreXml = tv(
      supplierParty.PartyLegalEntity?.RegistrationName ??
        supplierParty.PartyName?.Name ??
        '',
    ).trim();

    // Buscar proveedor en DB por RUC
    let proveedorId: number | null = null;
    let proveedorNombre: string = proveedorNombreXml;
    if (proveedorRuc) {
      const found = await this.prisma.cliente.findFirst({
        where: { empresaId, nroDoc: proveedorRuc, estado: 'ACTIVO' },
        select: { id: true, nombre: true },
      });
      if (found) {
        proveedorId = found.id;
        proveedorNombre = found.nombre;
      }
    }

    // Totales
    const legalTotal = doc.LegalMonetaryTotal ?? {};
    const subtotal = tn(legalTotal.LineExtensionAmount);
    const total = tn(legalTotal.PayableAmount ?? legalTotal.TaxInclusiveAmount);
    const taxTotals: any[] = doc.TaxTotal ?? [];
    const igv = taxTotals.reduce(
      (sum: number, t: any) => sum + tn(t.TaxAmount),
      0,
    );

    // Líneas de detalle
    const lines: any[] =
      doc.InvoiceLine ?? doc.CreditNoteLine ?? doc.DebitNoteLine ?? [];

    const items = await Promise.all(
      lines.map(async (line: any) => {
        const descripcion = tv(line.Item?.Description)
          .replace(/\s+/g, ' ')
          .trim();
        const codigo = tv(
          line.Item?.SellersItemIdentification?.ID ?? '',
        ).trim();
        const cantidad = tn(line.InvoicedQuantity);
        const unidad = tv(line.InvoicedQuantity?.['@_unitCode'] ?? 'NIU');

        let precioUnitario = tn(line.Price?.PriceAmount);
        if (!precioUnitario && cantidad > 0) {
          precioUnitario = tn(line.LineExtensionAmount) / cantidad;
        }

        const freeOfCharge =
          String(line.FreeOfChargeIndicator ?? '').toLowerCase() === 'true';
        const subtotalLinea = freeOfCharge ? 0 : tn(line.LineExtensionAmount);
        const lineaTaxTotals: any[] = line.TaxTotal ?? [];
        const igvLinea = lineaTaxTotals.reduce(
          (s: number, t: any) => s + tn(t.TaxAmount),
          0,
        );
        const descripcionUpper = descripcion.toUpperCase();
        const esBonificacion =
          freeOfCharge ||
          descripcionUpper.includes('BONIFICACION') ||
          descripcionUpper.includes('BONIFICACIÓN');

        // Intentar vincular producto por código
        let productoId: number | null = null;
        let productoDescripcion: string | null = null;
        if (codigo && empresaId) {
          const prod = await this.prisma.producto.findFirst({
            where: { empresaId, codigo, estado: 'ACTIVO' },
            select: { id: true, descripcion: true },
          });
          if (prod) {
            productoId = prod.id;
            productoDescripcion = prod.descripcion;
          } else if (proveedorRucNorm) {
            try {
              const vinculo =
                await this.prisma.vinculoProductoProveedorXml.findUnique({
                  where: {
                    empresaId_proveedorRuc_codigoXml: {
                      empresaId,
                      proveedorRuc: proveedorRucNorm,
                      codigoXml: this.normalizarCodigoXml(codigo),
                    },
                  },
                  select: {
                    productoId: true,
                    producto: { select: { descripcion: true, estado: true } },
                  },
                });
              if (vinculo?.producto && vinculo.producto.estado === 'ACTIVO') {
                productoId = vinculo.productoId;
                productoDescripcion = vinculo.producto.descripcion;
              }
            } catch (error) {
              // Si aún no se aplicó la migración de vínculos XML, continuar sin bloquear importación.
              console.warn(
                'Vínculo XML proveedor-producto no disponible aún:',
                error?.message || error,
              );
            }
          }
        }

        return {
          descripcion,
          codigo,
          cantidad,
          unidad,
          precioUnitario: parseFloat(
            (esBonificacion ? 0 : precioUnitario).toFixed(4),
          ),
          subtotal: parseFloat(subtotalLinea.toFixed(2)),
          igv: parseFloat((esBonificacion ? 0 : igvLinea).toFixed(2)),
          esBonificacion,
          freeOfCharge,
          productoId,
          productoDescripcion,
        };
      }),
    );

    return {
      tipoDoc,
      serie,
      numero,
      fechaEmision,
      moneda,
      proveedorRuc,
      proveedorNombre,
      proveedorId,
      subtotal: parseFloat(subtotal.toFixed(2)),
      igv: parseFloat(igv.toFixed(2)),
      total: parseFloat(total.toFixed(2)),
      items,
    };
  }

  private normalizarCodigoXml(valor: string): string {
    return String(valor || '')
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  async getHistorialPagos(
    empresaId: number,
    compraId: number,
    sedeId?: number,
  ) {
    const compra = await this.prisma.compra.findFirst({
      where: { id: compraId, empresaId, ...(sedeId ? { sedeId } : {}) },
    });
    if (!compra) return { success: true, data: [], totalPagado: 0 }; // Filtrar pagos si no es su sede

    const pagos = await this.prisma.pagoCompra.findMany({
      where: { compraId, empresaId },
      orderBy: { fecha: 'desc' },
    });

    const totalPagado = pagos.reduce(
      (acc, curr) => acc + Number(curr.monto),
      0,
    );

    return { success: true, data: pagos, totalPagado };
  }
}
