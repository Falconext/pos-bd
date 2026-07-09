import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SyncBackupDto,
  ProductoSyncDto,
  ClienteSyncDto,
  VentaSyncDto,
} from './dto/sync-backup.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) {}

  /**
   * Procesa un backup completo desde el móvil offline
   * Crea productos, clientes y ventas en el servidor
   */
  async processBackup(backup: SyncBackupDto, empresaId: number) {
    const mappings = {
      productos: {} as Record<number, number>,
      clientes: {} as Record<number, number>,
      ventas: {} as Record<number, number>,
    };

    let productosCreados = 0;
    let clientesCreados = 0;
    let ventasCreadas = 0;
    const errors: string[] = [];

    try {
      // 1. Procesar productos (reutilizando si ya existen)
      for (const productoSync of backup.productos) {
        try {
          const producto = await this.createOrUpdateProductoFromSync(
            productoSync,
            empresaId,
          );
          mappings.productos[productoSync.localId] = producto.id;
          productosCreados++;
        } catch (error) {
          errors.push(
            `Producto ${productoSync.nombre}: ${(error as Error).message}`,
          );
        }
      }

      // 2. Procesar clientes (reutilizando si ya existen)
      for (const clienteSync of backup.clientes) {
        try {
          const cliente = await this.createOrUpdateClienteFromSync(
            clienteSync,
            empresaId,
          );
          mappings.clientes[clienteSync.localId] = cliente.id;
          clientesCreados++;
        } catch (error) {
          errors.push(
            `Cliente ${clienteSync.nombre}: ${(error as Error).message}`,
          );
        }
      }

      // 3. Procesar ventas (comprobantes)
      for (const ventaSync of backup.ventas) {
        try {
          // Mapear cliente local a remoto
          let clienteId: number;
          if (
            ventaSync.clienteLocalId &&
            mappings.clientes[ventaSync.clienteLocalId]
          ) {
            clienteId = mappings.clientes[ventaSync.clienteLocalId];
          } else {
            // Cliente genérico si no se encuentra
            const clienteGenerico =
              await this.getOrCreateClienteGenerico(empresaId);
            clienteId = clienteGenerico.id;
          }

          const comprobante = await this.createComprobanteFromSync(
            ventaSync,
            empresaId,
            clienteId,
            mappings.productos,
          );
          mappings.ventas[ventaSync.localId] = comprobante.id;
          ventasCreadas++;
        } catch (error) {
          errors.push(
            `Venta ${ventaSync.serie}-${ventaSync.correlativo}: ${error.message}`,
          );
        }
      }

      return {
        success: true,
        message: `Sincronización completada: ${productosCreados} productos, ${clientesCreados} clientes, ${ventasCreadas} ventas`,
        data: {
          productosCreados,
          clientesCreados,
          ventasCreadas,
          mappings,
        },
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error procesando backup: ${error.message}`,
      );
    }
  }

  /**
   * Genera un código secuencial tipo PR001, PR002 por empresa
   */
  private async generateProductoCodigo(empresaId: number): Promise<string> {
    const count = await this.prisma.producto.count({ where: { empresaId } });
    const next = count + 1;
    return `PR${next.toString().padStart(3, '0')}`;
  }

  /**
   * Crea o actualiza un producto en Prisma desde datos del móvil, evitando duplicados
   */
  private async createOrUpdateProductoFromSync(
    productoSync: ProductoSyncDto,
    empresaId: number,
  ) {
    // 1) Si viene remoteId desde el móvil, intentar actualizar ese producto
    if (productoSync.remoteId) {
      const existing = await this.prisma.producto.findUnique({
        where: { id: productoSync.remoteId },
      });
      if (existing) {
        const precioUnitario = new Decimal(productoSync.precio);
        const valorUnitario = precioUnitario.div(new Decimal(1.18));

        return await this.prisma.producto.update({
          where: { id: existing.id },
          data: {
            descripcion: productoSync.nombre,
            precioUnitario,
            valorUnitario,
            stock: productoSync.stock,
          },
        });
      }
    }

    // 2) Buscar por empresaId + descripcion (nombre) para evitar duplicados si ya se sincronizó antes
    const byName = await this.prisma.producto.findFirst({
      where: {
        empresaId,
        descripcion: productoSync.nombre,
      },
    });
    if (byName) {
      return byName;
    }

    // 3) Crear nuevo producto
    const codigo = await this.generateProductoCodigo(empresaId);

    // Obtener unidad de medida por defecto (NIU = unidad)
    let unidadMedida = await this.prisma.unidadMedida.findUnique({
      where: { codigo: 'NIU' },
    });

    if (!unidadMedida) {
      // Crear unidad por defecto si no existe
      unidadMedida = await this.prisma.unidadMedida.create({
        data: {
          codigo: 'NIU',
          nombre: 'UNIDAD',
        },
      });
    }

    // Calcular valor unitario sin IGV (precio / 1.18)
    const precioUnitario = new Decimal(productoSync.precio);
    const valorUnitario = precioUnitario.div(new Decimal(1.18));

    return await this.prisma.producto.create({
      data: {
        codigo,
        descripcion: productoSync.nombre,
        empresaId,
        unidadMedidaId: unidadMedida.id,
        tipoAfectacionIGV: '10', // Gravado - Operación Onerosa
        precioUnitario,
        valorUnitario,
        igvPorcentaje: new Decimal(18),
        stock: productoSync.stock,
        estado: 'ACTIVO',
        costoPromedio: new Decimal(0),
        stockMinimo: 0,
      },
    });
  }

  /**
   * Crea o actualiza un cliente en Prisma desde datos del móvil, evitando duplicados
   */
  private async createOrUpdateClienteFromSync(
    clienteSync: ClienteSyncDto,
    empresaId: number,
  ) {
    // Obtener tipo de documento DNI por defecto
    let tipoDocumento = await this.prisma.tipoDocumento.findUnique({
      where: { codigo: '1' }, // DNI
    });

    if (!tipoDocumento) {
      tipoDocumento = await this.prisma.tipoDocumento.create({
        data: {
          codigo: '1',
          descripcion: 'DNI',
        },
      });
    }

    // 1) Si viene remoteId, intentar actualizar ese cliente
    if (clienteSync.remoteId) {
      const existing = await this.prisma.cliente.findUnique({
        where: { id: clienteSync.remoteId },
      });
      if (existing) {
        return await this.prisma.cliente.update({
          where: { id: existing.id },
          data: {
            nombre: clienteSync.nombre,
            telefono: clienteSync.telefono ?? existing.telefono,
            direccion: clienteSync.nota ?? existing.direccion,
          },
        });
      }
    }

    // 2) Buscar por empresaId + nombre para evitar duplicados
    const byName = await this.prisma.cliente.findFirst({
      where: {
        empresaId,
        nombre: clienteSync.nombre,
      },
    });
    if (byName) {
      return byName;
    }

    // 3) Crear nuevo cliente
    const nroDoc = '00000000';

    return await this.prisma.cliente.create({
      data: {
        nombre: clienteSync.nombre,
        nroDoc,
        telefono: clienteSync.telefono,
        direccion: clienteSync.nota || null,
        empresaId,
        tipoDocumentoId: tipoDocumento.id,
        estado: 'ACTIVO',
        persona: 'CLIENTE',
      },
    });
  }

  /**
   * Crea un comprobante (venta) en Prisma desde datos del móvil
   */
  private async createComprobanteFromSync(
    ventaSync: VentaSyncDto,
    empresaId: number,
    clienteId: number,
    productosMapping: Record<number, number>,
  ) {
    // Calcular totales para SUNAT (simplificado para informal)
    const total = ventaSync.total;
    const valorVenta = total / 1.18; // Sin IGV
    const mtoIGV = total - valorVenta;

    // Mapear estado de pago del móvil al enum de Prisma
    let estadoPago:
      | 'PENDIENTE_PAGO'
      | 'COMPLETADO'
      | 'PAGO_PARCIAL'
      | 'ANULADO' = 'PENDIENTE_PAGO';
    if (ventaSync.estadoPago === 'PAGADO') {
      estadoPago = 'COMPLETADO';
    } else if (ventaSync.estadoPago === 'PARCIAL') {
      estadoPago = 'PAGO_PARCIAL';
    }

    // Crear comprobante
    const comprobante = await this.prisma.comprobante.create({
      data: {
        ublVersion: '2.1',
        tipoDoc: ventaSync.tipoDoc,
        serie: ventaSync.serie,
        correlativo: ventaSync.correlativo,
        fechaEmision: new Date(ventaSync.fecha),
        formaPagoTipo: 'CONTADO',
        formaPagoMoneda: 'PEN',
        tipoMoneda: 'PEN',
        observaciones: ventaSync.observaciones,
        mtoOperGravadas: valorVenta,
        mtoIGV,
        valorVenta,
        totalImpuestos: mtoIGV,
        subTotal: valorVenta,
        mtoImpVenta: total,
        estadoEnvioSunat: 'NO_APLICA', // Informal no envía a SUNAT
        medioPago: ventaSync.medioPago || 'EFECTIVO',
        clienteId,
        empresaId,
        estadoPago,
        adelanto: ventaSync.adelanto || null,
        saldo: ventaSync.saldo || 0,
        estadoOT: ventaSync.estadoOT,
        mtoOperInafectas: 0,
        mtoDescuentoGlobal: 0,
      },
    });

    // Crear detalles del comprobante
    for (const detalleSync of ventaSync.detalles) {
      const productoId = productosMapping[detalleSync.productoLocalId];
      if (!productoId) {
        console.warn(
          `Producto local ${detalleSync.productoLocalId} no encontrado en mapping`,
        );
        continue;
      }

      // Obtener info del producto
      const producto = await this.prisma.producto.findUnique({
        where: { id: productoId },
        include: { unidadMedida: true },
      });

      if (!producto) continue;

      const cantidad = detalleSync.cantidad;
      const mtoPrecioUnitario = detalleSync.precioUnitario;
      const mtoValorUnitario = mtoPrecioUnitario / 1.18;
      const mtoValorVenta = mtoValorUnitario * cantidad;
      const igv = mtoValorVenta * 0.18;

      await this.prisma.detalleComprobante.create({
        data: {
          comprobanteId: comprobante.id,
          productoId,
          unidad: producto.unidadMedida.codigo,
          descripcion: producto.descripcion,
          cantidad,
          mtoValorUnitario,
          mtoValorVenta,
          mtoBaseIgv: mtoValorVenta,
          porcentajeIgv: 18,
          igv,
          tipAfeIgv: 10,
          totalImpuestos: igv,
          mtoPrecioUnitario,
        },
      });
    }

    return comprobante;
  }

  /**
   * Obtiene o crea un cliente genérico para ventas sin cliente
   */
  private async getOrCreateClienteGenerico(empresaId: number) {
    let cliente = await this.prisma.cliente.findFirst({
      where: {
        empresaId,
        nroDoc: '00000000',
      },
    });

    if (!cliente) {
      const tipoDocumento = await this.prisma.tipoDocumento.findUnique({
        where: { codigo: '1' },
      });

      cliente = await this.prisma.cliente.create({
        data: {
          nombre: 'CLIENTE GENÉRICO',
          nroDoc: '00000000',
          empresaId,
          tipoDocumentoId: tipoDocumento?.id || 1,
          estado: 'ACTIVO',
          persona: 'CLIENTE',
        },
      });
    }

    return cliente;
  }

  /**
   * Obtiene el estado de sincronización del usuario
   */
  async getSyncStatus(empresaId: number) {
    // Contar comprobantes sincronizados (los que vienen del móvil tendrán estadoEnvioSunat = NO_APLICA)
    const comprobantes = await this.prisma.comprobante.count({
      where: {
        empresaId,
        estadoEnvioSunat: 'NO_APLICA',
      },
    });

    return {
      lastSync: new Date().toISOString(),
      pendingItems: 0,
      syncedComprobantes: comprobantes,
    };
  }
}
