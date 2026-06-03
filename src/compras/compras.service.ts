import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KardexService } from '../kardex/kardex.service';
import { ProductoLoteService } from '../producto/producto-lote.service';
import { CrearCompraDto } from './dto/crear-compra.dto';
import { Prisma } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';

@Injectable()
export class ComprasService {
    constructor(
        private prisma: PrismaService,
        private kardexService: KardexService,
        private productoLoteService: ProductoLoteService,
    ) { }

    async crear(empresaId: number, usuarioId: number, data: CrearCompraDto, reqSedeId?: number) {
        const duplicado = await this.prisma.compra.findFirst({
            where: { empresaId, serie: data.serie, numero: data.numero },
            select: { id: true },
        });
        if (duplicado) {
            throw new BadRequestException(
                `Ya existe una compra registrada con la serie ${data.serie} y número ${data.numero}.`,
            );
        }

        let subtotal = 0;

        // Usar la sede del token; si el usuario es admin sin sede asignada, usar la sede principal
        let sedeId = reqSedeId;
        if (!sedeId) {
            const principal = await this.prisma.sede.findFirst({
                where: { empresaId, esPrincipal: true, activo: true },
                select: { id: true },
            });
            if (!principal) {
                throw new BadRequestException('No se pudo determinar la sede. Asigne una sede al usuario o configure una sede principal.');
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

            subtotal += sub;

            detallesData.push({
                productoId: item.productoId,
                descripcion: item.descripcion,
                cantidad: item.cantidad,
                precioUnitario: costoNeto,  // siempre neto en DB
                subtotal: sub,
                igv: igvItem * Number(item.cantidad),
                total: (costoNeto + igvItem) * Number(item.cantidad),
                lote: item.lote,
                fechaVencimiento: item.fechaVencimiento ? new Date(item.fechaVencimiento) : null,
            });
        }

        // Calculate final totals
        const igvTotal = data.igv !== undefined ? Number(data.igv) : subtotal * 0.18;
        const total = subtotal + igvTotal;

        // Create Purchase Transaction
        const compra = await this.prisma.$transaction(async (tx) => {
            return await tx.compra.create({
                data: {
                    empresaId,
                    proveedorId: data.proveedorId,
                    usuarioId,
                    tipoDoc: data.tipoDoc || 'FACTURA',
                    serie: data.serie,
                    numero: data.numero,
                    fechaEmision: new Date(data.fechaEmision),
                    fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
                    moneda: data.moneda || 'PEN',
                    tipoCambio: data.tipoCambio,
                    subtotal,
                    igv: igvTotal,
                    total,
                    saldo: total - (Number(data.montoPagadoInicial) || 0),
                    estado: 'REGISTRADO',
                    estadoPago: (Number(data.montoPagadoInicial) || 0) >= total ? 'COMPLETADO' : (data.montoPagadoInicial || 0) > 0 ? 'PAGO_PARCIAL' : 'PENDIENTE_PAGO',
                    observaciones: data.observaciones,
                    // Save installments
                    cuotas: data.cuotas ? JSON.stringify(data.cuotas) : undefined,
                    detalles: {
                        create: detallesData
                    },
                    sedeId: sedeId, // Guardar la sede a nivel de la cabecera de la compra
                    pagos: data.montoPagadoInicial ? {
                        create: {
                            empresaId,
                            usuarioId,
                            monto: data.montoPagadoInicial,
                            metodoPago: data.metodoPagoInicial || 'EFECTIVO',
                            fecha: new Date(),
                        }
                    } : undefined
                }
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
                        fechaVencimiento: item.fechaVencimiento ? new Date(item.fechaVencimiento) : undefined
                    });

                    // Sincronizar ProductoLote para FEFO (sin double-contar stock global)
                    if (item.lote && item.fechaVencimiento) {
                        await this.productoLoteService.sincronizarLoteDesdeIngreso({
                            productoId: item.productoId,
                            empresaId,
                            lote: item.lote,
                            fechaVencimiento: new Date(item.fechaVencimiento),
                            cantidad: Number(item.cantidad),
                            costoUnitario: costoNetoKardex,
                            movimientoKardexId: movimiento.id,
                        }).catch(err => {
                            throw new Error(
                                `Error sincronizando lote "${item.lote}" del producto "${item.descripcion ?? item.productoId}": ${err.message}`,
                            );
                        });
                    }
                } catch (error) {
                    console.error(`Error updating kardex for product ${item.productoId}:`, error);
                    // Continue with other items, or flag warning?
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
            console.error('No se pudo guardar equivalencias XML de proveedor:', error);
        }

        return compra;
    }

    async listar(empresaId: number, query: any, sedeId?: number) {
        const { page = 1, limit = 10, search, estadoPago, fechaInicio, fechaFin } = query;
        const skip = (Number(page) - 1) * Number(limit);

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
            ...(estadoPago ? { estadoPago: estadoPago } : {}),
            ...(fechaInicio ? {
                fechaEmision: {
                    gte: new Date(fechaInicio),
                    ...(fechaFin ? { lte: new Date(fechaFin + 'T23:59:59') } : {})
                }
            } : {}),
            ...(search ? {
                OR: [
                    { serie: { contains: search, mode: 'insensitive' } },
                    { numero: { contains: search, mode: 'insensitive' } },
                    { proveedor: { nombre: { contains: search, mode: 'insensitive' } } }
                ]
            } : {})
        };

        const [data, total] = await Promise.all([
            this.prisma.compra.findMany({
                where,
                skip,
                take: Number(limit),
                include: { proveedor: true },
                orderBy: { fechaEmision: 'desc' }
            }),
            this.prisma.compra.count({ where })
        ]);

        return { data, total, page: Number(page), limit: Number(limit) };
    }

    async obtenerPorId(empresaId: number, id: number, sedeId?: number) {
        const compra = await this.prisma.compra.findFirst({
            where: { id, empresaId, ...(sedeId ? { sedeId } : {}) },
            include: {
                proveedor: true,
                detalles: {
                    include: {
                        producto: true
                    }
                },
                pagos: true,
                usuario: true
            }
        });

        if (!compra) throw new NotFoundException('Compra no encontrada');
        return compra;
    }

    async registrarPago(empresaId: number, usuarioId: number, compraId: number, data: any, sedeId?: number) {
        const compra = await this.prisma.compra.findFirst({
            where: { id: compraId, empresaId, ...(sedeId ? { sedeId } : {}) }
        });

        if (!compra) throw new NotFoundException('Compra no encontrada');

        const monto = Number(data.monto);
        if (monto <= 0) throw new BadRequestException('El monto debe ser mayor a 0');
        if (monto > Number(compra.saldo) + 0.1) throw new BadRequestException('El monto excede el saldo pendiente');

        const nuevoSaldo = Number(compra.saldo) - monto;
        const nuevoEstadoPago = nuevoSaldo <= 0.1 ? 'COMPLETADO' : 'PAGO_PARCIAL';

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
                    referencia: data.referencia
                }
            });

            // Update Compra
            const compraUpdated = await tx.compra.update({
                where: { id: compraId },
                data: {
                    saldo: nuevoSaldo,
                    estadoPago: nuevoEstadoPago
                }
            });

            return { pago, nuevoSaldo: Number(compraUpdated.saldo), nuevoEstado: compraUpdated.estadoPago };
        });

        return { success: true, ...result };
    }

    async parseXmlSunat(empresaId: number, buffer: Buffer) {
        const sniff = buffer.toString('ascii', 0, Math.min(buffer.length, 300)).toLowerCase();
        const isLatin1 = sniff.includes('encoding="iso-8859-1"') || sniff.includes("encoding='iso-8859-1'");
        const xmlText = isLatin1 ? buffer.toString('latin1') : buffer.toString('utf-8');

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            removeNSPrefix: true,
            parseTagValue: true,
            parseAttributeValue: false,
            isArray: (tagName: string) =>
                ['InvoiceLine', 'CreditNoteLine', 'DebitNoteLine', 'TaxTotal', 'TaxSubtotal'].includes(tagName),
        });

        let parsed: any;
        try {
            parsed = parser.parse(xmlText);
        } catch {
            throw new BadRequestException('El archivo no es un XML válido');
        }

        const doc = parsed.Invoice ?? parsed.CreditNote ?? parsed.DebitNote;
        if (!doc) {
            throw new BadRequestException('El XML no corresponde a una Factura, Boleta o Nota de Crédito/Débito SUNAT');
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
        const tipoDocMap: Record<string, string> = { '01': 'FACTURA', '03': 'BOLETA', '07': 'NOTA_CREDITO', '08': 'NOTA_DEBITO' };
        const tipoDoc = tipoDocMap[typeCode] ?? 'FACTURA';

        const fechaEmision = tv(doc.IssueDate);
        const moneda = tv(doc.DocumentCurrencyCode) || 'PEN';

        // Proveedor desde el XML
        const supplierParty = doc.AccountingSupplierParty?.Party ?? {};
        const proveedorRuc = tv(supplierParty.PartyIdentification?.ID).trim();
        const proveedorRucNorm = this.normalizarCodigoXml(proveedorRuc);
        const proveedorNombreXml = tv(
            supplierParty.PartyLegalEntity?.RegistrationName ??
            supplierParty.PartyName?.Name ?? ''
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
        const igv = taxTotals.reduce((sum: number, t: any) => sum + tn(t.TaxAmount), 0);

        // Líneas de detalle
        const lines: any[] = doc.InvoiceLine ?? doc.CreditNoteLine ?? doc.DebitNoteLine ?? [];

        const items = await Promise.all(
            lines.map(async (line: any) => {
                const descripcion = tv(line.Item?.Description).replace(/\s+/g, ' ').trim();
                const codigo = tv(line.Item?.SellersItemIdentification?.ID ?? '').trim();
                const cantidad = tn(line.InvoicedQuantity);
                const unidad = tv(line.InvoicedQuantity?.['@_unitCode'] ?? 'NIU');

                let precioUnitario = tn(line.Price?.PriceAmount);
                if (!precioUnitario && cantidad > 0) {
                    precioUnitario = tn(line.LineExtensionAmount) / cantidad;
                }

                const freeOfCharge = String(line.FreeOfChargeIndicator ?? '').toLowerCase() === 'true';
                const subtotalLinea = freeOfCharge ? 0 : tn(line.LineExtensionAmount);
                const lineaTaxTotals: any[] = line.TaxTotal ?? [];
                const igvLinea = lineaTaxTotals.reduce((s: number, t: any) => s + tn(t.TaxAmount), 0);
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
                            const vinculo = await this.prisma.vinculoProductoProveedorXml.findUnique({
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
                            console.warn('Vínculo XML proveedor-producto no disponible aún:', (error as any)?.message || error);
                        }
                    }
                }

                return {
                    descripcion,
                    codigo,
                    cantidad,
                    unidad,
                    precioUnitario: parseFloat((esBonificacion ? 0 : precioUnitario).toFixed(4)),
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
        return String(valor || '').replace(/\s+/g, '').toUpperCase();
    }

    async getHistorialPagos(empresaId: number, compraId: number, sedeId?: number) {
        const compra = await this.prisma.compra.findFirst({
            where: { id: compraId, empresaId, ...(sedeId ? { sedeId } : {}) }
        });
        if (!compra) return { success: true, data: [], totalPagado: 0 }; // Filtrar pagos si no es su sede

        const pagos = await this.prisma.pagoCompra.findMany({
            where: { compraId, empresaId },
            orderBy: { fecha: 'desc' }
        });

        const totalPagado = pagos.reduce((acc, curr) => acc + Number(curr.monto), 0);

        return { success: true, data: pagos, totalPagado };
    }
}
