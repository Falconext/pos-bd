import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KardexService } from '../kardex/kardex.service';
import { ProductoLoteService } from '../producto/producto-lote.service';
import { CajaService } from '../caja/caja.service';
import { GeminiService } from '../gemini/gemini.service';
import { S3Service } from '../s3/s3.service';
import { CrearCompraDto } from './dto/crear-compra.dto';
import { Prisma } from '@prisma/client';
import { TipoCambioService } from '../tipo-cambio/tipo-cambio.service';
import { XMLParser } from 'fast-xml-parser';
import { parseFechaSoloDia } from '../common/utils/fecha';

@Injectable()
export class ComprasService {
  constructor(
    private prisma: PrismaService,
    private kardexService: KardexService,
    private productoLoteService: ProductoLoteService,
    private cajaService: CajaService,
    private geminiService: GeminiService,
    private s3Service: S3Service,
    private tipoCambioService: TipoCambioService,
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

  /**
   * Moneda del documento y tipo de cambio con el que se convierte a soles.
   * Regla del sistema: la moneda base es el sol y el costo es histórico — todo
   * lo que entra al kardex/costo promedio va en soles al TC de la compra, y ese
   * TC queda guardado en la compra para que los reportes sean reproducibles.
   * PEN → tc 1. USD → exige un TC > 0 (no se adivina: es dato de la factura).
   */
  private resolverMonedaYTipoCambio(data: {
    moneda?: string | null;
    tipoCambio?: number | null;
  }): { moneda: 'PEN' | 'USD'; tipoCambio: number } {
    const moneda = String(data.moneda ?? 'PEN').trim().toUpperCase();
    if (moneda !== 'PEN' && moneda !== 'USD') {
      throw new BadRequestException(
        `Moneda "${data.moneda}" no soportada. Usa PEN (soles) o USD (dólares).`,
      );
    }
    if (moneda === 'PEN') return { moneda, tipoCambio: 1 };
    const tc = Number(data.tipoCambio);
    if (!Number.isFinite(tc) || tc <= 0) {
      throw new BadRequestException(
        'Indica el tipo de cambio (S/ por US$) para registrar una compra en dólares.',
      );
    }
    // TC 1 en dólares = "no se convirtió": casi siempre es un dato faltante.
    if (tc < 1.5 || tc > 20) {
      throw new BadRequestException(
        `El tipo de cambio ${tc} no parece válido (se esperan soles por dólar, p. ej. 3.75).`,
      );
    }
    return { moneda, tipoCambio: Math.round(tc * 10000) / 10000 };
  }

  /** Factor moneda del documento → soles, a partir de una compra guardada. */
  private factorASoles(compra: {
    moneda?: string | null;
    tipoCambio?: any;
  }): number {
    if (String(compra.moneda ?? 'PEN').toUpperCase() !== 'USD') return 1;
    const tc = Number(compra.tipoCambio);
    return Number.isFinite(tc) && tc > 0 ? tc : 1;
  }

  /**
   * Valoriza un pago en soles. `monto` va en la moneda de la compra; para USD
   * usa el TC del día del pago (o el de la compra si no se indica) y calcula la
   * diferencia de cambio frente al TC con el que se contabilizó la compra.
   */
  private valorizarPago(
    compra: { moneda?: string | null; tipoCambio?: any },
    monto: number,
    tipoCambioPago?: number | null,
  ): {
    moneda: 'PEN' | 'USD';
    tipoCambio: number;
    montoSoles: number;
    diferenciaCambio: number;
  } {
    const esUsd = String(compra.moneda ?? 'PEN').toUpperCase() === 'USD';
    if (!esUsd) {
      return {
        moneda: 'PEN',
        tipoCambio: 1,
        montoSoles: this.roundMoney(monto),
        diferenciaCambio: 0,
      };
    }
    const tcCompra = this.factorASoles(compra);
    let tc = Number(tipoCambioPago);
    if (!Number.isFinite(tc) || tc <= 0) tc = tcCompra;
    if (tc < 1.5 || tc > 20) {
      throw new BadRequestException(
        `El tipo de cambio del pago (${tc}) no parece válido (soles por dólar, p. ej. 3.75).`,
      );
    }
    tc = Math.round(tc * 10000) / 10000;
    return {
      moneda: 'USD',
      tipoCambio: tc,
      montoSoles: this.roundMoney(monto * tc),
      diferenciaCambio: this.roundMoney((tc - tcCompra) * monto),
    };
  }

  /**
   * Pago de un documento en SOLES desde una cuenta bancaria en DÓLARES: el pago
   * se guarda en soles, pero necesita un TC para que el ledger de la cuenta lo
   * muestre en US$. Usa el TC enviado o, si no, el TC venta SUNAT del día.
   * Devuelve 1 si no aplica (misma moneda) o si no se pudo obtener.
   */
  private async tipoCambioParaCuenta(
    cuentaBancariaId: number | null | undefined,
    monedaDoc: 'PEN' | 'USD',
    tcEnviado?: number | null,
  ): Promise<number> {
    if (!cuentaBancariaId || monedaDoc !== 'PEN') return 1;
    const cuenta = await this.prisma.cuentaBancaria.findUnique({
      where: { id: Number(cuentaBancariaId) },
      select: { moneda: true },
    });
    if (String(cuenta?.moneda ?? 'PEN').toUpperCase() !== 'USD') return 1;
    const tc = Number(tcEnviado);
    if (Number.isFinite(tc) && tc >= 1.5 && tc <= 20) return tc;
    try {
      const sunat = await this.tipoCambioService.consultar();
      return sunat?.venta > 0 ? sunat.venta : 1;
    } catch {
      return 1;
    }
  }

  /** Costo unitario en soles (4 decimales) para kardex/costo promedio. */
  private costoEnSoles(costoMonedaDoc: number, factor: number): number {
    return parseFloat((Number(costoMonedaDoc) * factor).toFixed(4));
  }

  private roundMoney(value: number) {
    return parseFloat((Number(value) || 0).toFixed(2));
  }

  /**
   * Monto para columnas Decimal. Prisma manda los `number` como float y
   * Postgres los guarda con residuo (94.400000000000010); como texto con los
   * decimales justos se guarda exacto.
   */
  private dec(value: number, decimales = 2): string {
    return (Number(value) || 0).toFixed(decimales);
  }

  /**
   * Afectación IGV de los productos de la compra. Solo los gravados (Catálogo
   * 07 código 10-17) llevan el 18%: exonerados (20), inafectos (30) y
   * exportación (40) —medicinas de farmacia, productos agrícolas, etc.— entran
   * sin IGV. Ítems sin producto o sin afectación registrada se tratan como
   * gravados (comportamiento histórico).
   */
  async afectacionGravadaPorProducto(
    empresaId: number,
    detalles: Array<{ productoId?: number | null }>,
  ): Promise<Map<number, boolean>> {
    const ids = [
      ...new Set(
        (detalles || [])
          .map((d) => Number(d.productoId))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    const gravado = new Map<number, boolean>();
    if (!ids.length) return gravado;
    const productos = await this.prisma.producto.findMany({
      where: { id: { in: ids }, empresaId },
      select: { id: true, tipoAfectacionIGV: true },
    });
    for (const p of productos) {
      gravado.set(p.id, this.esAfectacionGravada(p.tipoAfectacionIGV));
    }
    return gravado;
  }

  private esAfectacionGravada(tipoAfectacionIGV?: string | null): boolean {
    const cod = String(tipoAfectacionIGV ?? '10').trim();
    return cod === '' || cod.startsWith('1');
  }

  /**
   * Montos de una línea de compra según su afectación. `precioUnitario` es el
   * tecleado: con `incluyeIgv` trae el IGV embebido (solo aplica a gravados).
   * Devuelve neto unitario, IGV unitario y totales de la línea (moneda doc).
   */
  private montosLinea(
    item: { precioUnitario: number | string; cantidad: number | string; incluyeIgv?: boolean },
    gravado: boolean,
  ) {
    const precioIngresado = Number(item.precioUnitario) || 0;
    const cantidad = Number(item.cantidad) || 0;
    const costoNeto =
      gravado && item.incluyeIgv
        ? parseFloat((precioIngresado / 1.18).toFixed(4))
        : precioIngresado;
    const igvItem = gravado ? parseFloat((costoNeto * 0.18).toFixed(4)) : 0;
    const sub = costoNeto * cantidad;
    const totalLinea = !gravado
      ? sub
      : item.incluyeIgv
        ? precioIngresado * cantidad
        : (costoNeto + igvItem) * cantidad;
    return { costoNeto, igvItem, sub, totalLinea };
  }

  /**
   * Total de la cabecera: el que manda el cliente (el de la factura) solo si
   * coincide con la suma de líneas salvo redondeo; si difiere (cliente viejo
   * que aplicó IGV a un exonerado, etc.) manda la suma de líneas.
   */
  private totalCabecera(totalCliente: unknown, totalLineas: number): number {
    const calculado = this.roundMoney(totalLineas);
    if (totalCliente === undefined || totalCliente === null) return calculado;
    const enviado = this.roundMoney(Number(totalCliente));
    return Math.abs(enviado - calculado) <= 0.05 ? enviado : calculado;
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

  /**
   * Una compra queda PENDIENTE_APROBACION (maker-checker) solo si la empresa
   * activó requiereAprobacionCompras Y quien la registra es USUARIO_EMPRESA.
   * En ese estado NO ingresa stock, NO crea series y NO acepta pagos: todo se
   * difiere hasta que un ADMIN_EMPRESA la apruebe.
   */
  private async requiereAprobacionCompra(
    empresaId: number,
    usuarioRol?: string,
  ): Promise<boolean> {
    if (String(usuarioRol || '').toUpperCase() !== 'USUARIO_EMPRESA')
      return false;
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { requiereAprobacionCompras: true },
    });
    return Boolean(empresa?.requiereAprobacionCompras);
  }

  async crear(
    empresaId: number,
    usuarioId: number,
    data: CrearCompraDto,
    reqSedeId?: number,
    usuarioRol?: string,
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

    // Distribución por sede: las líneas pueden entrar a una sede distinta a la
    // de la cabecera (misma factura repartida entre almacenes).
    await this.validarSedesDeLineas(empresaId, data.detalles);

    // Moneda del documento: los montos (detalle, subtotal, total, saldo) se
    // guardan en la moneda de la factura; al kardex entra el costo en soles.
    const { moneda, tipoCambio } = this.resolverMonedaYTipoCambio(data);
    const factorSoles = moneda === 'USD' ? tipoCambio : 1;

    // Prepare detail data and calculate totals from items to be safe
    const detallesData: any[] = [];

    // IGV por línea según la afectación del producto (exonerados/inafectos
    // sin IGV). Ítems sin producto conocido → gravados.
    const gravadoPorProducto = await this.afectacionGravadaPorProducto(
      empresaId,
      data.detalles,
    );
    for (const item of data.detalles) {
      // costoNeto = precio sin IGV, usado para actualizar costoPromedio en kardex
      // Si incluyeIgv=true el precio ingresado ya trae el IGV embebido → extraerlo
      const gravado =
        gravadoPorProducto.get(Number(item.productoId)) ?? true;
      const { costoNeto, sub, totalLinea } = this.montosLinea(item, gravado);

      subtotal += sub;
      totalLineas += totalLinea;

      detallesData.push({
        productoId: item.productoId,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: this.dec(costoNeto, 4), // siempre neto en DB
        subtotal: this.dec(sub),
        igv: this.dec(totalLinea - sub),
        total: this.dec(totalLinea),
        lote: item.lote,
        fechaVencimiento: item.fechaVencimiento
          ? parseFechaSoloDia(item.fechaVencimiento)
          : null,
        // Distribución por sede: null = entra a la sede de la cabecera.
        sedeId:
          item.sedeId != null && Number(item.sedeId) !== sedeId
            ? Number(item.sedeId)
            : null,
      });
    }

    // Calculate final totals. El IGV sale de las líneas (neto vs total): un
    // `igv` mandado por el cliente ya no se toma, así un cliente desactualizado
    // no puede grabar IGV sobre productos exonerados.
    const subtotalTotal = this.roundMoney(subtotal);
    const total = this.totalCabecera(data.total, totalLineas);
    const igvTotal = this.roundMoney(total - subtotalTotal);
    // Maker-checker: compra de vendedor con aprobación activada queda
    // PENDIENTE_APROBACION — sin stock, sin pagos (ni el inicial), sin series.
    const esPendiente = await this.requiereAprobacionCompra(
      empresaId,
      usuarioRol,
    );

    // El pago inicial nunca supera el total (un cliente que calculó el total
    // con IGV sobre exonerados mandaría de más).
    const montoPagadoInicial = esPendiente
      ? 0
      : Math.min(
          total,
          Math.max(0, this.roundMoney(Number(data.montoPagadoInicial) || 0)),
        );
    const saldoInicial = Math.max(
      0,
      this.roundMoney(total - montoPagadoInicial),
    );
    const estadoPagoInicial = this.normalizeEstadoPagoBySaldo(
      total,
      saldoInicial,
    );
    // Pago inicial de un documento en soles desde cuenta en dólares: TC del día
    // para que la cuenta lo vea en US$ (en el resto de casos queda el de la compra).
    const tcPagoInicial =
      montoPagadoInicial > 0 && moneda === 'PEN' && data.cuentaBancariaIdInicial
        ? await this.tipoCambioParaCuenta(
            data.cuentaBancariaIdInicial,
            'PEN',
            undefined,
          )
        : tipoCambio;

    // Create Purchase Transaction
    const compra = await this.prisma.$transaction(async (tx) => {
      return await tx.compra.create({
        include: { detalles: { orderBy: { id: 'asc' } }, proveedor: true },
        data: {
          empresaId,
          proveedorId: data.proveedorId,
          usuarioId,
          tipoDoc: data.tipoDoc || 'FACTURA',
          serie: data.serie,
          numero: data.numero,
          fechaEmision: parseFechaSoloDia(data.fechaEmision),
          fechaVencimiento: data.fechaVencimiento
            ? parseFechaSoloDia(data.fechaVencimiento)
            : null,
          moneda,
          tipoCambio: this.dec(tipoCambio, 4),
          subtotal: this.dec(subtotalTotal),
          igv: this.dec(igvTotal),
          total: this.dec(total),
          saldo: this.dec(saldoInicial),
          estado: esPendiente ? 'PENDIENTE_APROBACION' : 'REGISTRADO',
          // Los números de serie viajan en JSON y se materializan al aprobar.
          ...(esPendiente && todasLasSeries.length
            ? { seriesPendientes: seriesPorLinea as any }
            : {}),
          estadoPago: estadoPagoInicial as any,
          observaciones: data.observaciones,
          fotoUrl: data.fotoUrl || null,
          // Consumo propio: explícito desde el formulario o inferido cuando
          // ninguna línea apunta a un producto del catálogo (ítems libres).
          esGasto:
            typeof data.esGasto === 'boolean'
              ? data.esGasto
              : data.detalles.length > 0 &&
                data.detalles.every((d) => !d.productoId),
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
                    monto: this.dec(montoPagadoInicial),
                    // El pago inicial va al mismo TC de la compra: sin diferencia de cambio.
                    moneda,
                    tipoCambio: this.dec(tcPagoInicial, 4),
                    montoSoles: this.dec(montoPagadoInicial * factorSoles),
                    diferenciaCambio: '0.00',
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
    // Los fallos al actualizar stock NO se tragan en silencio: se recogen aquí y
    // se devuelven como aviso, para que el usuario sepa que la compra se guardó
    // pero el stock de algún ítem no subió (y pueda corregirlo).
    const stockWarnings: string[] = [];
    // Compra pendiente de aprobación: el stock/series recién se aplican al
    // aprobar (aprobarCompra). data.detalles queda intacto en DetalleCompra.
    for (const item of esPendiente ? [] : data.detalles) {
      if (item.productoId) {
        try {
          // costoPromedio siempre se actualiza con el precio NETO (sin IGV) y
          // EN SOLES: una compra en dólares entra al TC de la factura.
          const costoNetoKardex = this.costoEnSoles(
            this.montosLinea(
              item,
              gravadoPorProducto.get(Number(item.productoId)) ?? true,
            ).costoNeto,
            factorSoles,
          );
          const movimiento = await this.kardexService.registrarMovimiento({
            empresaId,
            productoId: item.productoId,
            tipoMovimiento: 'INGRESO',
            concepto: `COMPRA ${compra.serie}-${compra.numero}`,
            cantidad: Number(item.cantidad),
            costoUnitario: costoNetoKardex,
            compraId: compra.id,
            usuarioId,
            // Distribución por sede: la línea entra a su propia sede si la trae.
            sedeId: item.sedeId != null ? Number(item.sedeId) : sedeId,
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
          // No se traga en silencio: se registra un aviso que viaja en la respuesta.
          const nombreItem = item.descripcion ?? `producto ${item.productoId}`;
          stockWarnings.push(
            `No se pudo actualizar el stock de "${nombreItem}": ${
              (error as any)?.message ?? 'error desconocido'
            }. La compra se guardó; revisa/ajusta el stock manualmente.`,
          );
        }
      }
    }

    // Registrar series / IMEI de la compra como ProductoSerie DISPONIBLE.
    // Se enlazan a la compra y a su línea; las series son opcionales (pueden
    // completarse luego desde Kardex → Series y Garantías).
    if (!esPendiente && todasLasSeries.length) {
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
            sedeId:
              item.sedeId != null ? Number(item.sedeId) : (sedeId ?? null),
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
        // La caja es en soles: una compra en dólares pagada en efectivo sale al TC.
        monto: this.roundMoney(montoPagadoInicial * factorSoles),
        empresaId,
        usuarioId,
        sedeId: reqSedeId,
        compraId: compra.id,
        serie: compra.serie,
        numero: compra.numero,
      });
    }

    const respuesta = this.normalizeCompraForResponse(compra);
    return {
      ...(stockWarnings.length
        ? { ...respuesta, stockWarnings }
        : respuesta),
      ...(esPendiente
        ? {
            mensajeAprobacion:
              'Compra registrada. Queda pendiente de aprobación del administrador: el stock ingresará al aprobarse.',
          }
        : {}),
    };
  }

  /**
   * Aprueba una compra PENDIENTE_APROBACION: recién aquí ingresa el stock
   * (kardex + lotes FEFO) y se materializan las series/IMEI guardadas.
   */
  async aprobarCompra(empresaId: number, adminId: number, id: number) {
    const compra = await this.prisma.compra.findFirst({
      where: { id, empresaId, estado: 'PENDIENTE_APROBACION' as any },
      include: { detalles: { orderBy: { id: 'asc' } } },
    });
    if (!compra) {
      throw new NotFoundException(
        'La compra no existe, no pertenece a tu empresa o no está pendiente de aprobación.',
      );
    }

    // Igual criterio que crear(): sede guardada en la compra, con respaldo en
    // la sede principal si la compra vieja no la tuviera.
    const sedeId = await this.resolverSedeDestino(
      empresaId,
      compra.sedeId ?? undefined,
    );
    const stockWarnings: string[] = [];
    // El detalle está en la moneda de la factura; al kardex va en soles.
    const factorSoles = this.factorASoles(compra);
    for (const detalle of compra.detalles) {
      if (!detalle.productoId) continue;
      try {
        // precioUnitario en DetalleCompra ya está guardado NETO (sin IGV).
        const costoSoles = this.costoEnSoles(
          Number(detalle.precioUnitario),
          factorSoles,
        );
        const movimiento = await this.kardexService.registrarMovimiento({
          empresaId,
          productoId: detalle.productoId,
          tipoMovimiento: 'INGRESO',
          concepto: `COMPRA ${compra.serie}-${compra.numero}`,
          cantidad: Number(detalle.cantidad),
          costoUnitario: costoSoles,
          compraId: compra.id,
          usuarioId: adminId,
          // Distribución por sede: cada línea entra a su sede (o a la de la cabecera).
          sedeId: detalle.sedeId ?? sedeId,
          lote: detalle.lote ?? undefined,
          fechaVencimiento: detalle.fechaVencimiento ?? undefined,
        });
        if (detalle.lote && detalle.fechaVencimiento) {
          await this.productoLoteService.sincronizarLoteDesdeIngreso({
            productoId: detalle.productoId,
            empresaId,
            lote: detalle.lote,
            fechaVencimiento: detalle.fechaVencimiento,
            cantidad: Number(detalle.cantidad),
            costoUnitario: costoSoles,
            movimientoKardexId: movimiento.id,
          });
        }
      } catch (error) {
        stockWarnings.push(
          `No se pudo ingresar el stock de "${detalle.descripcion ?? detalle.productoId}": ${
            (error as any)?.message ?? 'error desconocido'
          }. Revisa/ajusta el stock manualmente.`,
        );
      }
    }

    // Materializar series/IMEI guardadas al crear la compra pendiente.
    const seriesPorLinea = Array.isArray(compra.seriesPendientes)
      ? (compra.seriesPendientes as any as string[][])
      : [];
    if (seriesPorLinea.some((s) => Array.isArray(s) && s.length)) {
      const seriesData: Prisma.ProductoSerieCreateManyInput[] = [];
      for (let i = 0; i < compra.detalles.length; i++) {
        const series = seriesPorLinea[i] || [];
        const detalle = compra.detalles[i];
        if (!series.length || !detalle?.productoId) continue;
        for (const numeroSerie of series) {
          seriesData.push({
            empresaId,
            productoId: detalle.productoId,
            sedeId: detalle.sedeId ?? sedeId ?? null,
            numeroSerie,
            estado: 'DISPONIBLE',
            compraId: compra.id,
            compraDetalleId: detalle.id,
          });
        }
      }
      if (seriesData.length) {
        try {
          await this.prisma.productoSerie.createMany({
            data: seriesData,
            skipDuplicates: true,
          });
        } catch (error) {
          stockWarnings.push(
            'No se pudieron registrar todas las series/IMEI de la compra; regístralas manualmente en Kardex → Series.',
          );
        }
      }
    }

    const actualizada = await this.prisma.compra.update({
      where: { id },
      data: {
        estado: 'REGISTRADO' as any,
        aprobadoPorUsuarioId: adminId,
        seriesPendientes: Prisma.DbNull,
      },
      include: { detalles: { orderBy: { id: 'asc' } }, proveedor: true },
    });

    return {
      success: true,
      message: 'Compra aprobada: el stock ya ingresó al inventario.',
      data: this.normalizeCompraForResponse(actualizada),
      ...(stockWarnings.length ? { stockWarnings } : {}),
    };
  }

  /** Rechaza una compra PENDIENTE_APROBACION (terminal, nunca aplicó efectos). */
  async rechazarCompra(empresaId: number, adminId: number, id: number) {
    const compra = await this.prisma.compra.findFirst({
      where: { id, empresaId, estado: 'PENDIENTE_APROBACION' as any },
      select: { id: true },
    });
    if (!compra) {
      throw new NotFoundException(
        'La compra no existe, no pertenece a tu empresa o no está pendiente de aprobación.',
      );
    }
    const actualizada = await this.prisma.compra.update({
      where: { id },
      data: {
        estado: 'RECHAZADA' as any,
        aprobadoPorUsuarioId: adminId,
        saldo: 0,
        seriesPendientes: Prisma.DbNull,
      },
    });
    return {
      success: true,
      message: 'Compra rechazada.',
      data: actualizada,
    };
  }

  // Resuelve la sede/almacén destino del stock: prioriza la sede indicada en el
  // payload (validada contra la empresa), luego un fallback (sesión), y por
  // último la sede principal. Igual criterio que `crear`.
  private async resolverSedeDestino(
    empresaId: number,
    dataSedeId?: number,
    fallbackSedeId?: number,
  ): Promise<number> {
    let sedeId = fallbackSedeId;
    if (dataSedeId) {
      const destino = await this.prisma.sede.findFirst({
        where: { id: Number(dataSedeId), empresaId, activo: true },
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
    return sedeId;
  }

  // Impide anular/editar una compra cuando alguna de sus series/IMEI ya no está
  // DISPONIBLE (fue vendida o asignada). Revertir el ingreso en ese caso dejaría
  // inconsistencias graves, así que se bloquea con un mensaje claro.
  private async assertSinSeriesUsadas(compraId: number, empresaId: number) {
    const usadas = await this.prisma.productoSerie.count({
      where: {
        compraId,
        empresaId,
        estado: { not: 'DISPONIBLE' as any },
      },
    });
    if (usadas > 0) {
      throw new BadRequestException(
        'No se puede modificar/anular esta compra: tiene series/IMEI que ya fueron vendidas o asignadas. Revierte esas ventas primero.',
      );
    }
  }

  /**
   * Distribución por sede: valida que las sedes indicadas en las líneas
   * pertenezcan a la empresa y estén activas.
   */
  private async validarSedesDeLineas(
    empresaId: number,
    detalles: { sedeId?: number | null }[],
  ): Promise<void> {
    const ids = [
      ...new Set(
        detalles
          .map((d) => (d.sedeId != null ? Number(d.sedeId) : null))
          .filter((x): x is number => x != null && Number.isFinite(x)),
      ),
    ];
    if (!ids.length) return;
    const sedes = await this.prisma.sede.findMany({
      where: { id: { in: ids }, empresaId, activo: true },
      select: { id: true },
    });
    const validas = new Set(sedes.map((x) => x.id));
    const invalidas = ids.filter((x) => !validas.has(x));
    if (invalidas.length) {
      throw new BadRequestException(
        `Sede destino de línea no válida o inactiva (id ${invalidas.join(', ')}).`,
      );
    }
  }

  // Revierte el inventario ingresado por una compra: por cada detalle con
  // producto registra un movimiento de kardex compensatorio (SALIDA) que baja el
  // stock, y descuenta el lote FEFO correspondiente. Best-effort: los fallos no
  // bloquean, se acumulan como avisos.
  private async revertirInventarioCompra(
    compra: {
      id: number;
      serie: string;
      numero: string;
      sedeId: number | null;
      moneda?: string | null;
      tipoCambio?: any;
      detalles: {
        productoId: number | null;
        cantidad: any;
        precioUnitario: any;
        lote: string | null;
        fechaVencimiento: Date | null;
        descripcion: string | null;
        sedeId?: number | null;
      }[];
    },
    empresaId: number,
    usuarioId: number,
    conceptoPrefix: string,
  ): Promise<string[]> {
    const warnings: string[] = [];
    const sedeId =
      compra.sedeId ??
      (await this.resolverSedeDestino(empresaId, undefined, undefined));
    // La salida compensatoria se valoriza en soles, igual que entró.
    const factorSoles = this.factorASoles(compra);

    for (const det of compra.detalles) {
      if (!det.productoId) continue;
      const cantidad = Number(det.cantidad) || 0;
      if (cantidad <= 0) continue;
      const nombreItem = det.descripcion ?? `producto ${det.productoId}`;
      try {
        const movimiento = await this.kardexService.registrarMovimiento({
          empresaId,
          productoId: det.productoId,
          tipoMovimiento: 'SALIDA',
          concepto: `${conceptoPrefix} ${compra.serie}-${compra.numero}`,
          cantidad,
          costoUnitario: this.costoEnSoles(
            Number(det.precioUnitario) || 0,
            factorSoles,
          ),
          compraId: compra.id,
          usuarioId,
          // Se revierte en la misma sede a la que entró la línea.
          sedeId: det.sedeId ?? sedeId,
        });

        // Revertir el lote FEFO ingresado por esta línea (si aplicaba).
        if (det.lote && det.fechaVencimiento) {
          const lote = await this.prisma.productoLote.findUnique({
            where: {
              productoId_lote: { productoId: det.productoId, lote: det.lote },
            },
            select: { id: true },
          });
          if (lote) {
            await this.productoLoteService.descontarStockLote(
              det.productoId,
              cantidad,
              movimiento.id,
              lote.id,
            );
          }
        }
      } catch (error) {
        console.error(
          `Error revirtiendo stock del producto ${det.productoId} (compra ${compra.id}):`,
          error,
        );
        warnings.push(
          `No se pudo revertir el stock de "${nombreItem}": ${
            (error as any)?.message ?? 'error desconocido'
          }. Revisa/ajusta el stock manualmente.`,
        );
      }
    }
    return warnings;
  }

  // Anulación lógica de una compra: revierte el inventario, libera las series
  // DISPONIBLE, marca estado=ANULADO y deja saldo en 0. No borra el registro ni
  // los pagos (auditoría). Las compras ANULADO se excluyen del listado.
  async anular(
    empresaId: number,
    usuarioId: number,
    id: number,
    _sedeId?: number,
  ) {
    const compra = await this.prisma.compra.findFirst({
      where: { id, empresaId },
      include: { detalles: { orderBy: { id: 'asc' } } },
    });
    if (!compra) throw new NotFoundException('Compra no encontrada');
    if (compra.estado === ('ANULADO' as any)) {
      throw new BadRequestException('La compra ya está anulada.');
    }

    // Pendiente/rechazada: nunca aplicó stock ni series — anular es solo
    // marcar el estado, sin movimientos compensatorios.
    if (
      compra.estado === ('PENDIENTE_APROBACION' as any) ||
      compra.estado === ('RECHAZADA' as any)
    ) {
      await this.prisma.compra.update({
        where: { id },
        data: { estado: 'ANULADO' as any, saldo: 0 },
      });
      return { success: true, message: 'Compra anulada.' };
    }

    await this.assertSinSeriesUsadas(id, empresaId);

    // Con abonos registrados no se anula "por encima": el dinero ya salió (caja,
    // banco) y quedaría un pago huérfano en el flujo de caja. Primero se anulan
    // los abonos desde el historial (que devuelven saldo y revierten caja).
    const pagosVigentes = await this.prisma.pagoCompra.findMany({
      where: { compraId: id, empresaId },
      select: { monto: true },
    });
    if (pagosVigentes.length) {
      const simbolo = String(compra.moneda).toUpperCase() === 'USD' ? '$' : 'S/';
      const totalPagos = pagosVigentes.reduce(
        (acc, p) => acc + Number(p.monto),
        0,
      );
      throw new BadRequestException(
        `La compra tiene ${pagosVigentes.length} abono(s) por ${simbolo} ${totalPagos.toFixed(2)}. Anula primero los abonos desde el historial de pagos y luego anula la compra.`,
      );
    }

    const stockWarnings = await this.revertirInventarioCompra(
      compra as any,
      empresaId,
      usuarioId,
      'ANULACION COMPRA',
    );

    // Liberar (borrar) las series DISPONIBLE registradas por esta compra: el
    // ingreso ya no existe. Best-effort.
    try {
      await this.prisma.productoSerie.deleteMany({
        where: { compraId: id, empresaId, estado: 'DISPONIBLE' as any },
      });
    } catch (error) {
      console.error('No se pudieron liberar las series de la compra:', error);
    }

    await this.prisma.compra.update({
      where: { id },
      data: { estado: 'ANULADO' as any, saldo: 0 },
    });

    return {
      success: true,
      message: 'Compra anulada y stock revertido correctamente.',
      ...(stockWarnings.length ? { stockWarnings } : {}),
    };
  }

  // Edición completa de una compra: revierte los efectos de inventario previos y
  // re-aplica los nuevos a partir del payload (mismos cálculos que `crear`). No
  // toca los pagos ya registrados; sí recalcula el saldo según el nuevo total.
  async actualizar(
    empresaId: number,
    usuarioId: number,
    id: number,
    data: CrearCompraDto,
    reqSedeId?: number,
  ) {
    const existente = await this.prisma.compra.findFirst({
      where: { id, empresaId },
      include: {
        detalles: { orderBy: { id: 'asc' } },
        pagos: {
          select: { id: true, monto: true, tipoCambio: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!existente) throw new NotFoundException('Compra no encontrada');
    if (existente.estado === ('ANULADO' as any)) {
      throw new BadRequestException('No se puede editar una compra anulada.');
    }
    // La edición revierte y re-aplica stock — una compra pendiente/rechazada
    // nunca aplicó stock, así que editarla corrompería el kardex. Anúlala y
    // créala de nuevo, o espera la decisión del administrador.
    if (
      existente.estado === ('PENDIENTE_APROBACION' as any) ||
      existente.estado === ('RECHAZADA' as any)
    ) {
      throw new BadRequestException(
        'No se puede editar una compra pendiente de aprobación o rechazada. Anúlala y regístrala de nuevo.',
      );
    }
    await this.assertSinSeriesUsadas(id, empresaId);

    // Duplicado serie+numero excluyendo la propia compra.
    const duplicado = await this.prisma.compra.findFirst({
      where: {
        empresaId,
        serie: data.serie,
        numero: data.numero,
        id: { not: id },
      },
      select: { id: true },
    });
    if (duplicado) {
      throw new BadRequestException(
        `Ya existe otra compra registrada con la serie ${data.serie} y número ${data.numero}.`,
      );
    }

    // Series / IMEI: validar unicidad ANTES de tocar nada, excluyendo las de
    // esta misma compra (que se reemplazan).
    const seriesPorLinea = data.detalles.map((item) =>
      this.normalizarNumerosSerie(item.numerosSerie),
    );
    const todasLasSeries = seriesPorLinea.flat();
    if (todasLasSeries.length) {
      const vistos = new Set<string>();
      for (const s of todasLasSeries) {
        if (vistos.has(s)) {
          throw new BadRequestException(
            `La serie "${s}" está repetida en la compra.`,
          );
        }
        vistos.add(s);
      }
      const existentes = await this.prisma.productoSerie.findMany({
        where: {
          empresaId,
          numeroSerie: { in: todasLasSeries },
          compraId: { not: id },
        },
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

    const sedeId = await this.resolverSedeDestino(
      empresaId,
      data.sedeId,
      existente.sedeId ?? reqSedeId,
    );
    // Distribución por sede: validar ANTES de revertir nada.
    await this.validarSedesDeLineas(empresaId, data.detalles);
    // Moneda/TC de la versión nueva. El TC guardado solo sirve de respaldo si
    // la compra YA era en dólares; al pasar de soles a dólares hay que indicarlo
    // (el tc=1 de una compra en soles no es un tipo de cambio).
    const monedaNueva = String(data.moneda || existente.moneda).toUpperCase();
    const existenteEraUsd = String(existente.moneda).toUpperCase() === 'USD';
    const { moneda, tipoCambio } = this.resolverMonedaYTipoCambio({
      moneda: monedaNueva,
      tipoCambio:
        data.tipoCambio != null
          ? data.tipoCambio
          : existenteEraUsd && existente.tipoCambio != null
            ? Number(existente.tipoCambio)
            : undefined,
    });
    const factorSoles = moneda === 'USD' ? tipoCambio : 1;
    // Con pagos registrados la moneda no se cambia: los abonos y el saldo están
    // en la moneda original y mezclarlos dejaría el saldo sin sentido.
    if (
      existente.pagos.length &&
      moneda !== String(existente.moneda ?? 'PEN').toUpperCase()
    ) {
      throw new BadRequestException(
        'No se puede cambiar la moneda de una compra que ya tiene pagos registrados. Anula los pagos primero o registra una nueva compra.',
      );
    }
    const tcAnterior = this.factorASoles(existente);

    // 1) Revertir el inventario de la versión anterior.
    const warningsRevertir = await this.revertirInventarioCompra(
      existente as any,
      empresaId,
      usuarioId,
      'AJUSTE EDICION COMPRA',
    );
    // Liberar las series previas (se re-crearán las nuevas del payload).
    try {
      await this.prisma.productoSerie.deleteMany({
        where: { compraId: id, empresaId, estado: 'DISPONIBLE' as any },
      });
    } catch (error) {
      console.error('No se pudieron liberar las series previas:', error);
    }

    // 2) Recalcular detalles y totales (idéntico criterio que `crear`).
    let subtotal = 0;
    let totalLineas = 0;
    const detallesData: any[] = [];
    const gravadoPorProducto = await this.afectacionGravadaPorProducto(
      empresaId,
      data.detalles,
    );
    for (const item of data.detalles) {
      const gravado =
        gravadoPorProducto.get(Number(item.productoId)) ?? true;
      const { costoNeto, sub, totalLinea } = this.montosLinea(item, gravado);
      subtotal += sub;
      totalLineas += totalLinea;
      detallesData.push({
        productoId: item.productoId,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: this.dec(costoNeto, 4),
        subtotal: this.dec(sub),
        igv: this.dec(totalLinea - sub),
        total: this.dec(totalLinea),
        lote: item.lote,
        fechaVencimiento: item.fechaVencimiento
          ? parseFechaSoloDia(item.fechaVencimiento)
          : null,
        // Distribución por sede: null = entra a la sede de la cabecera.
        sedeId:
          item.sedeId != null && Number(item.sedeId) !== sedeId
            ? Number(item.sedeId)
            : null,
      });
    }
    const subtotalTotal = this.roundMoney(subtotal);
    const total = this.totalCabecera(data.total, totalLineas);
    const igvTotal = this.roundMoney(total - subtotalTotal);
    // Saldo recalculado con los pagos YA registrados (no se tocan).
    const totalPagado = existente.pagos.reduce(
      (acc, p) => acc + Number(p.monto),
      0,
    );
    const nuevoSaldo = Math.max(0, this.roundMoney(total - totalPagado));
    const nuevoEstadoPago = this.normalizeEstadoPagoBySaldo(total, nuevoSaldo);

    // Pago inicial a corregir: el primer pago registrado (el que muestra el
    // modal de edición). Permite cambiar el N° de operación / método / cuenta
    // de una compra ya inscrita sin tener que anularla y volver a crearla.
    const pagoInicial = existente.pagos[0];
    const debeActualizarPagoInicial =
      !!pagoInicial &&
      (data.referenciaInicial !== undefined ||
        data.metodoPagoInicial !== undefined ||
        data.cuentaBancariaIdInicial !== undefined);

    // 3) Reemplazar cabecera + detalles en una transacción.
    const compra = await this.prisma.$transaction(async (tx) => {
      await tx.detalleCompra.deleteMany({ where: { compraId: id } });
      // Cambió el TC de una compra en dólares: los pagos hechos "al TC de la
      // compra" se revalorizan al nuevo TC (sin diferencia de cambio) y los
      // demás recalculan su diferencia frente al nuevo TC contable.
      if (moneda === 'USD' && existente.pagos.length && tipoCambio !== tcAnterior) {
        for (const p of existente.pagos) {
          const tcPago = Number(p.tipoCambio) || tcAnterior;
          const alTcCompra = Math.abs(tcPago - tcAnterior) < 0.00005;
          const tcNuevoPago = alTcCompra ? tipoCambio : tcPago;
          await tx.pagoCompra.update({
            where: { id: p.id },
            data: {
              moneda: 'USD',
              tipoCambio: this.dec(tcNuevoPago, 4),
              montoSoles: this.dec(Number(p.monto) * tcNuevoPago),
              diferenciaCambio: this.dec(
                (tcNuevoPago - tipoCambio) * Number(p.monto),
              ),
            },
          });
        }
      }
      if (debeActualizarPagoInicial) {
        await tx.pagoCompra.update({
          where: { id: pagoInicial.id },
          data: {
            referencia: data.referenciaInicial || null,
            ...(data.metodoPagoInicial
              ? { metodoPago: data.metodoPagoInicial }
              : {}),
            cuentaBancariaId:
              data.metodoPagoInicial === 'TRANSFERENCIA'
                ? data.cuentaBancariaIdInicial || null
                : null,
          },
        });
      }
      return tx.compra.update({
        where: { id },
        include: { detalles: { orderBy: { id: 'asc' } } },
        data: {
          proveedorId: data.proveedorId,
          tipoDoc: data.tipoDoc || existente.tipoDoc,
          serie: data.serie,
          numero: data.numero,
          fechaEmision: parseFechaSoloDia(data.fechaEmision),
          fechaVencimiento: data.fechaVencimiento
            ? parseFechaSoloDia(data.fechaVencimiento)
            : null,
          moneda,
          tipoCambio: this.dec(tipoCambio, 4),
          subtotal: this.dec(subtotalTotal),
          igv: this.dec(igvTotal),
          total: this.dec(total),
          saldo: this.dec(nuevoSaldo),
          estadoPago: nuevoEstadoPago as any,
          observaciones: data.observaciones,
          // Solo se sobreescribe la foto si el payload trae una nueva (al re-leer
          // por IA en edición); si no viene, se conserva la existente.
          ...(data.fotoUrl !== undefined ? { fotoUrl: data.fotoUrl || null } : {}),
          esGasto:
            typeof data.esGasto === 'boolean'
              ? data.esGasto
              : data.detalles.length > 0 &&
                data.detalles.every((d) => !d.productoId),
          cuotas: data.cuotas ? JSON.stringify(data.cuotas) : undefined,
          sedeId,
          detalles: { create: detallesData },
        },
      });
    });

    // 4) Re-aplicar el inventario nuevo (INGRESO + lotes FEFO).
    const warningsAplicar: string[] = [];
    for (const item of data.detalles) {
      if (!item.productoId) continue;
      try {
        // Neto (sin IGV) y en soles al TC de la compra editada.
        const costoNetoKardex = this.costoEnSoles(
          this.montosLinea(
            item,
            gravadoPorProducto.get(Number(item.productoId)) ?? true,
          ).costoNeto,
          factorSoles,
        );
        const movimiento = await this.kardexService.registrarMovimiento({
          empresaId,
          productoId: item.productoId,
          tipoMovimiento: 'INGRESO',
          concepto: `COMPRA ${compra.serie}-${compra.numero}`,
          cantidad: Number(item.cantidad),
          costoUnitario: costoNetoKardex,
          compraId: compra.id,
          usuarioId,
          // Distribución por sede: la línea entra a su propia sede si la trae.
          sedeId: item.sedeId != null ? Number(item.sedeId) : sedeId,
          lote: item.lote,
          fechaVencimiento: item.fechaVencimiento
            ? parseFechaSoloDia(item.fechaVencimiento)
            : undefined,
        });
        if (item.lote && item.fechaVencimiento) {
          await this.productoLoteService.sincronizarLoteDesdeIngreso({
            productoId: item.productoId,
            empresaId,
            lote: item.lote,
            fechaVencimiento: parseFechaSoloDia(item.fechaVencimiento),
            cantidad: Number(item.cantidad),
            costoUnitario: costoNetoKardex,
            movimientoKardexId: movimiento.id,
          });
        }
      } catch (error) {
        console.error(
          `Error re-aplicando kardex del producto ${item.productoId}:`,
          error,
        );
        const nombreItem = item.descripcion ?? `producto ${item.productoId}`;
        warningsAplicar.push(
          `No se pudo actualizar el stock de "${nombreItem}": ${
            (error as any)?.message ?? 'error desconocido'
          }. Revisa/ajusta el stock manualmente.`,
        );
      }
    }

    // 5) Re-crear las series/IMEI del payload.
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
            sedeId:
              item.sedeId != null ? Number(item.sedeId) : (sedeId ?? null),
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

    const respuesta = this.normalizeCompraForResponse(compra);
    const stockWarnings = [...warningsRevertir, ...warningsAplicar];
    return stockWarnings.length
      ? { ...respuesta, stockWarnings }
      : respuesta;
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
        sedeFilter = {
          AND: [
            {
              OR: [
                { sedeId },
                { sedeId: null },
                { detalles: { some: { sedeId } } },
              ],
            },
          ],
        };
      } else {
        // Una compra distribuida cuenta para cada sede que recibió líneas.
        sedeFilter = { OR: [{ sedeId }, { detalles: { some: { sedeId } } }] };
      }
    }

    const where: Prisma.CompraWhereInput = {
      empresaId,
      ...sedeFilter,
      // Las compras anuladas no se listan (borrado lógico).
      estado: { not: 'ANULADO' as any },
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
        estado: { not: 'ANULADO' as any },
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

    // Saldo por pagar del filtro completo (no solo la página), en soles: las
    // compras en dólares se convierten con el TC con que se registraron.
    const conSaldo = await this.prisma.compra.findMany({
      where: {
        ...where,
        estado: { notIn: ['ANULADO', 'RECHAZADA'] as any },
        saldo: { gt: new Prisma.Decimal(this.saldoTolerance) },
      },
      select: { saldo: true, moneda: true, tipoCambio: true },
    });
    const saldoPendienteSoles = this.roundMoney(
      conSaldo.reduce(
        (acc, c) => acc + Number(c.saldo) * this.factorASoles(c),
        0,
      ),
    );

    return {
      data: data.map((compra) => this.normalizeCompraForResponse(compra)),
      total,
      page: Number(page),
      limit: Number(limit),
      saldoPendienteSoles,
      comprasConSaldo: conSaldo.length,
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
            sede: { select: { id: true, nombre: true } },
            seriesGarantias: {
              select: { numeroSerie: true, garantiaMeses: true, estado: true },
            },
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
    if (
      compra.estado === ('PENDIENTE_APROBACION' as any) ||
      compra.estado === ('RECHAZADA' as any)
    ) {
      throw new BadRequestException(
        'No se pueden registrar pagos en una compra pendiente de aprobación o rechazada.',
      );
    }

    const monto = this.roundMoney(Number(data.monto));
    if (monto <= 0)
      throw new BadRequestException('El monto debe ser mayor a 0');
    if (monto > Number(compra.saldo) + this.saldoTolerance)
      throw new BadRequestException('El monto excede el saldo pendiente');
    // Moneda del documento: el abono se registra en la misma moneda que el saldo
    // y se valoriza en soles con el TC del día del pago.
    const valor = this.valorizarPago(compra, monto, data.tipoCambio);
    // Documento en soles pagado desde cuenta en dólares: TC para el ledger USD.
    if (valor.moneda === 'PEN' && data.cuentaBancariaId) {
      valor.tipoCambio = await this.tipoCambioParaCuenta(
        data.cuentaBancariaId,
        'PEN',
        data.tipoCambio,
      );
    }

    // Transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Descuento condicional y atómico del saldo: la fila queda bloqueada
      // hasta el commit, así dos abonos simultáneos no pueden descontar el
      // mismo saldo (el segundo ve el saldo ya reducido y se rechaza).
      const descontado = await tx.compra.updateMany({
        where: {
          id: compraId,
          empresaId,
          saldo: {
            gte: new Prisma.Decimal(
              (monto - this.saldoTolerance).toFixed(2),
            ),
          },
        },
        data: { saldo: { decrement: monto } },
      });
      if (descontado.count === 0) {
        throw new BadRequestException('El monto excede el saldo pendiente');
      }
      const actual = await tx.compra.findUnique({
        where: { id: compraId },
        select: { saldo: true, total: true },
      });
      const nuevoSaldo = Math.max(
        0,
        this.roundMoney(Number(actual?.saldo ?? 0)),
      );
      const nuevoEstadoPago = this.normalizeEstadoPagoBySaldo(
        Number(actual?.total ?? compra.total),
        nuevoSaldo,
      );

      // Create Pago
      const pago = await tx.pagoCompra.create({
        data: {
          empresaId,
          usuarioId,
          compraId,
          monto: this.dec(monto),
          moneda: valor.moneda,
          tipoCambio: this.dec(valor.tipoCambio, 4),
          montoSoles: this.dec(valor.montoSoles),
          diferenciaCambio: this.dec(valor.diferenciaCambio),
          metodoPago: data.medioPago || 'EFECTIVO', // Frontend sends 'medioPago', backend uses 'metodoPago'
          referencia: data.referencia,
          cuentaBancariaId: data.cuentaBancariaId
            ? Number(data.cuentaBancariaId)
            : undefined,
        },
      });

      // Update Compra
      const compraUpdated = await tx.compra.update({
        where: { id: compraId },
        data: {
          saldo: this.dec(nuevoSaldo),
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

    // Abono en efectivo → egreso de caja (si hay caja abierta), en soles.
    await this.registrarEgresoCajaSiEfectivo({
      metodo: data.medioPago,
      monto: valor.montoSoles,
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

  /**
   * Lee una FOTO de factura/boleta de compra con IA (Gemini) y devuelve la
   * misma estructura que parseXmlSunat, para reutilizar el mismo pre-llenado
   * del formulario de compra en el frontend. Matchea proveedor por RUC y cada
   * ítem con el catálogo (por código o por descripción). Lo que no matchea
   * queda con productoId null (se vincula a mano, igual que el XML).
   */
  /**
   * Sube una foto de factura/boleta a S3 como evidencia y devuelve su URL, sin
   * leerla con IA. Para adjuntar/cambiar la foto de una compra sin alterar sus
   * datos. Aquí S3 SÍ es obligatorio: si falla, se informa el error (a
   * diferencia del parseo por IA, donde la foto es best-effort).
   */
  async subirFotoEvidencia(
    empresaId: number,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ fotoUrl: string }> {
    const key = this.s3Service.generateCompraFotoKey(empresaId, mimeType);
    const fotoUrl = await this.s3Service.uploadImage(buffer, key, mimeType);
    return { fotoUrl };
  }

  async parseImagenFactura(
    empresaId: number,
    buffer: Buffer,
    mimeType: string,
  ) {
    const base64 = buffer.toString('base64');
    const data = await this.geminiService.extraerFacturaDesdeImagen(
      base64,
      mimeType,
    );

    // Guardar la foto en S3 para que quede como evidencia y se muestre en el
    // detalle de la compra. Best-effort: si S3 falla, se sigue sin foto (la
    // lectura por IA no debe romperse por un problema de almacenamiento).
    let fotoUrl: string | null = null;
    try {
      const key = this.s3Service.generateCompraFotoKey(empresaId, mimeType);
      fotoUrl = await this.s3Service.uploadImage(buffer, key, mimeType);
    } catch (e) {
      fotoUrl = null;
    }

    // Proveedor: match por RUC contra los clientes tipo proveedor.
    const proveedorRuc = String(data?.proveedorRuc ?? '').trim();
    let proveedorId: number | null = null;
    let proveedorNombre: string = String(data?.proveedorNombre ?? '').trim();
    let proveedorCreado = false;
    if (proveedorRuc) {
      const found = await this.prisma.cliente.findFirst({
        where: { empresaId, nroDoc: proveedorRuc, estado: 'ACTIVO' },
        select: { id: true, nombre: true },
      });
      if (found) {
        proveedorId = found.id;
        proveedorNombre = found.nombre;
      } else if (/^\d{11}$/.test(proveedorRuc) && proveedorNombre) {
        // No existe y el RUC es válido (11 dígitos) → crear el proveedor
        // automáticamente con los datos de la factura y dejarlo seteado.
        const tipoDocRuc = await this.prisma.tipoDocumento.findFirst({
          where: { codigo: '6' },
          select: { id: true },
        });
        const nuevo = await this.prisma.cliente.create({
          data: {
            empresaId,
            nombre: proveedorNombre,
            nroDoc: proveedorRuc,
            persona: 'PROVEEDOR',
            estado: 'ACTIVO',
            tipoDocumentoId: tipoDocRuc?.id ?? null,
          },
          select: { id: true, nombre: true },
        });
        proveedorId = nuevo.id;
        proveedorNombre = nuevo.nombre;
        proveedorCreado = true;
      }
    }

    const itemsRaw: any[] = Array.isArray(data?.items) ? data.items : [];
    const items = await Promise.all(
      itemsRaw.map(async (it) => {
        const descripcion = String(it?.descripcion ?? '').trim();
        const codigo = String(it?.codigo ?? '').trim();
        const cantidad = Number(it?.cantidad) || 0;
        // El TOTAL de línea impreso es la fuente de verdad (la boleta lo calcula
        // con el precio de más decimales y lo redondea). Si viene, el precio
        // unitario se deriva de él (total/cantidad) para que precio×cantidad
        // cuadre exacto con la boleta. Si no viene, se usa el precio impreso.
        const totalLinea = Number(it?.totalLinea) || 0;
        const precioImpreso = Number(it?.precioUnitario) || 0;
        const precioUnitario =
          totalLinea > 0 && cantidad > 0
            ? parseFloat((totalLinea / cantidad).toFixed(4))
            : parseFloat(precioImpreso.toFixed(4));
        const subtotalLinea =
          totalLinea > 0
            ? parseFloat(totalLinea.toFixed(2))
            : parseFloat((precioUnitario * cantidad).toFixed(2));

        // Matcheo del producto: 1) por código exacto, 2) por descripción
        // exacta (case-insensitive), 3) por descripción que contiene.
        let productoId: number | null = null;
        let productoDescripcion: string | null = null;
        if (codigo && empresaId) {
          const p = await this.prisma.producto.findFirst({
            where: { empresaId, codigo, estado: 'ACTIVO' },
            select: { id: true, descripcion: true },
          });
          if (p) {
            productoId = p.id;
            productoDescripcion = p.descripcion;
          }
        }
        if (!productoId && descripcion && empresaId) {
          const exacto = await this.prisma.producto.findFirst({
            where: {
              empresaId,
              estado: 'ACTIVO',
              descripcion: { equals: descripcion, mode: 'insensitive' },
            },
            select: { id: true, descripcion: true },
          });
          const aprox =
            exacto ??
            (await this.prisma.producto.findFirst({
              where: {
                empresaId,
                estado: 'ACTIVO',
                descripcion: { contains: descripcion, mode: 'insensitive' },
              },
              select: { id: true, descripcion: true },
            }));
          if (aprox) {
            productoId = aprox.id;
            productoDescripcion = aprox.descripcion;
          }
        }

        return {
          descripcion,
          codigo,
          cantidad,
          unidad: '',
          precioUnitario,
          subtotal: subtotalLinea,
          igv: 0,
          esBonificacion: false,
          freeOfCharge: false,
          productoId,
          productoDescripcion,
        };
      }),
    );

    // ¿Los precios ya incluyen IGV? Se detecta comparando el TOTAL de la boleta
    // con la suma de las líneas: si el total ≈ suma de líneas, el precio mostrado
    // ya es el final (boleta/nota de venta); si el total ≈ suma + 18%, son netos
    // (factura con IGV desglosado). Sin total confiable, se asume precio final
    // (el caso más común al fotografiar una boleta).
    const sumLineas = items.reduce((s, it) => s + it.subtotal, 0);
    const totalExtraido = Number(data?.total) || 0;
    const incluyeIgv =
      totalExtraido > 0 && sumLineas > 0
        ? Math.abs(totalExtraido - sumLineas) <=
          Math.abs(totalExtraido - sumLineas * 1.18)
        : true;

    return {
      tipoDoc: String(data?.tipoDoc ?? '') || 'FACTURA',
      serie: String(data?.serie ?? ''),
      numero: String(data?.numero ?? ''),
      fechaEmision: String(data?.fechaEmision ?? ''),
      moneda: String(data?.moneda ?? 'PEN') === 'USD' ? 'USD' : 'PEN',
      proveedorRuc,
      proveedorNombre,
      proveedorId,
      proveedorCreado,
      subtotal: parseFloat((Number(data?.subtotal) || 0).toFixed(2)),
      igv: parseFloat((Number(data?.igv) || 0).toFixed(2)),
      total: parseFloat((Number(data?.total) || 0).toFixed(2)),
      incluyeIgv,
      fotoUrl,
      items,
    };
  }

  private normalizarCodigoXml(valor: string): string {
    return String(valor || '')
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  /**
   * Anula un abono: lo elimina, devuelve su monto al saldo de la compra y, si
   * fue en efectivo con caja abierta, deja INACTIVO el egreso de caja que generó.
   */
  async anularPago(
    empresaId: number,
    usuarioId: number,
    compraId: number,
    pagoId: number,
  ) {
    const compra = await this.prisma.compra.findFirst({
      where: { id: compraId, empresaId },
      select: { id: true, total: true, saldo: true, estado: true, serie: true, numero: true },
    });
    if (!compra) throw new NotFoundException('Compra no encontrada');
    if (compra.estado === ('ANULADO' as any)) {
      throw new BadRequestException('La compra está anulada.');
    }
    const pago = await this.prisma.pagoCompra.findFirst({
      where: { id: pagoId, compraId, empresaId },
    });
    if (!pago) throw new NotFoundException('El abono no existe.');

    const nuevoSaldo = Math.min(
      Number(compra.total),
      this.roundMoney(Number(compra.saldo) + Number(pago.monto)),
    );
    const nuevoEstadoPago = this.normalizeEstadoPagoBySaldo(
      Number(compra.total),
      nuevoSaldo,
    );
    const esEfectivo =
      String(pago.metodoPago || '').toUpperCase().trim() === 'EFECTIVO';
    const montoCaja =
      pago.montoSoles != null ? Number(pago.montoSoles) : Number(pago.monto);

    await this.prisma.$transaction(async (tx) => {
      await tx.pagoCompra.delete({ where: { id: pago.id } });
      await tx.compra.update({
        where: { id: compraId },
        data: { saldo: this.dec(nuevoSaldo), estadoPago: nuevoEstadoPago as any },
      });
      if (esEfectivo) {
        // El egreso de caja de este abono (mismo monto en soles, activo).
        const egreso = await tx.movimientoCaja.findFirst({
          where: {
            compraId,
            empresaId,
            tipoMovimiento: 'EGRESO',
            estado: 'ACTIVO',
            monto: { gte: montoCaja - 0.005, lte: montoCaja + 0.005 },
          },
          orderBy: { id: 'desc' },
        });
        if (egreso) {
          await tx.movimientoCaja.update({
            where: { id: egreso.id },
            data: {
              estado: 'INACTIVO',
              observaciones: [
                egreso.observaciones,
                `[${new Date().toISOString()}] Abono anulado (usuarioId ${usuarioId}) de la compra ${compra.serie}-${compra.numero}.`,
              ]
                .filter(Boolean)
                .join(' | '),
            },
          });
        }
      }
    });

    return {
      success: true,
      nuevoSaldo,
      nuevoEstado: nuevoEstadoPago,
      message: 'Abono anulado. El saldo de la compra fue restablecido.',
    };
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
    const factor = this.factorASoles(compra);
    const totalPagadoSoles = pagos.reduce(
      (acc, curr) =>
        acc +
        (curr.montoSoles != null
          ? Number(curr.montoSoles)
          : Number(curr.monto) * factor),
      0,
    );
    const diferenciaCambioTotal = pagos.reduce(
      (acc, curr) => acc + Number(curr.diferenciaCambio ?? 0),
      0,
    );

    return {
      success: true,
      data: pagos,
      totalPagado,
      moneda: compra.moneda,
      tipoCambioCompra: factor,
      totalPagadoSoles: this.roundMoney(totalPagadoSoles),
      diferenciaCambioTotal: this.roundMoney(diferenciaCambioTotal),
    };
  }
}
