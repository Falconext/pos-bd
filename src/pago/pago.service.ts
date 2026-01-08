import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrearPagoDto } from './dto/crear-pago.dto';

@Injectable()
export class PagoService {
  constructor(private readonly prisma: PrismaService) { }

  async registrarPago(
    comprobanteId: number,
    dto: CrearPagoDto,
    usuarioId?: number,
    empresaId?: number,
  ) {
    const comprobante = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
    });

    if (!comprobante) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    // Validar que el comprobante pertenezca a la empresa del usuario
    if (empresaId && comprobante.empresaId !== empresaId) {
      throw new BadRequestException('El comprobante no pertenece a tu empresa');
    }

    if (comprobante.estadoEnvioSunat === 'ANULADO') {
      throw new BadRequestException(
        'No se puede registrar pago en comprobante anulado',
      );
    }

    // Recalcular saldo si es crédito y tiene saldo 0 (mal guardado en BD)
    let saldoActual = comprobante.saldo ?? 0;
    const formaPagoUpper = (comprobante.formaPagoTipo || '').toUpperCase();
    const esCredito = formaPagoUpper === 'CREDITO';

    // Si es crédito y saldo es 0 pero tiene total > 0, recalcular y corregir en BD
    if (esCredito && saldoActual === 0 && Number(comprobante.mtoImpVenta) > 0) {
      const montoDescontado = Number(comprobante.montoDetraccion || 0);
      saldoActual = Math.max(0, Number(comprobante.mtoImpVenta) - montoDescontado);

      // Corregir el saldo en la base de datos para futuros pagos
      await this.prisma.comprobante.update({
        where: { id: comprobanteId },
        data: {
          saldo: saldoActual,
          estadoPago: 'PENDIENTE_PAGO'
        },
      });
    }

    if (dto.monto <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }
    if (dto.monto > saldoActual) {
      throw new BadRequestException(
        `El monto no puede exceder el saldo pendiente (${saldoActual})`,
      );
    }

    const pago = await this.prisma.pago.create({
      data: {
        comprobanteId,
        usuarioId,
        empresaId,
        monto: dto.monto,
        medioPago: (dto.medioPago ?? 'EFECTIVO').toUpperCase(),
        observacion: dto.observacion,
        referencia: dto.referencia,
      },
    });

    const nuevoSaldo = saldoActual - dto.monto;
    let nuevoEstado = 'PAGO_PARCIAL';
    if (nuevoSaldo <= 0) {
      nuevoEstado = 'COMPLETADO';
    } else if (nuevoSaldo === saldoActual) {
      nuevoEstado = 'PENDIENTE_PAGO';
    }

    const comprobanteActualizado = await this.prisma.comprobante.update({
      where: { id: comprobanteId },
      data: {
        saldo: Math.max(0, nuevoSaldo),
        estadoPago: nuevoEstado as any,
      },
    });

    return { pago, comprobanteActualizado };
  }

  async obtenerPagos(comprobanteId: number) {
    const comprobante = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      include: { pagos: { orderBy: { fecha: 'desc' } } },
    });

    if (!comprobante) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    return {
      comprobanteId,
      pagos: comprobante.pagos,
      totalPagado: comprobante.pagos.reduce((sum, p) => sum + p.monto, 0),
      saldoPendiente: comprobante.saldo,
      estadoPago: comprobante.estadoPago,
    };
  }

  async listarTodos(filtros?: {
    empresaId?: number;
    usuarioId?: number;
    clienteId?: number;
    estadoPago?: string;
    fechaInicio?: string;
    fechaFin?: string;
    medioPago?: string;
    search?: string;
  }) {
    const where: any = {};
    if (filtros?.empresaId) where.empresaId = filtros.empresaId;
    if (filtros?.usuarioId) where.usuarioId = filtros.usuarioId;
    if (filtros?.medioPago) where.medioPago = filtros.medioPago.toUpperCase();
    if (filtros?.fechaInicio || filtros?.fechaFin) {
      where.fecha = {};
      if (filtros.fechaInicio)
        where.fecha.gte = new Date(`${filtros.fechaInicio}T00:00:00.000Z`);
      if (filtros.fechaFin)
        where.fecha.lte = new Date(`${filtros.fechaFin}T23:59:59.999Z`);
    }
    if (filtros?.clienteId) {
      where.comprobante = { clienteId: filtros.clienteId };
    }
    if (filtros?.estadoPago) {
      where.comprobante = {
        ...where.comprobante,
        estadoPago: filtros.estadoPago,
      };
    }

    // Búsqueda por serie, correlativo o referencia
    if (filtros?.search) {
      const searchTerm = filtros.search.trim();
      where.OR = [
        { referencia: { contains: searchTerm, mode: 'insensitive' } },
        { observacion: { contains: searchTerm, mode: 'insensitive' } },
        {
          comprobante: {
            OR: [
              { serie: { contains: searchTerm, mode: 'insensitive' } },
              { cliente: { nombre: { contains: searchTerm, mode: 'insensitive' } } },
            ],
          },
        },
      ];
      // Si parece ser un número, buscar también por correlativo
      const numSearch = parseInt(searchTerm.replace(/\D/g, ''), 10);
      if (!isNaN(numSearch)) {
        where.OR.push({
          comprobante: { correlativo: numSearch },
        });
      }
    }

    const pagos = await this.prisma.pago.findMany({
      where,
      orderBy: { fecha: 'desc' },
      include: {
        usuario: { select: { id: true, nombre: true, email: true } },
        comprobante: {
          select: {
            id: true,
            serie: true,
            correlativo: true,
            tipoDoc: true,
            fechaEmision: true,
            mtoImpVenta: true,
            estadoPago: true,
            saldo: true,
            cliente: {
              select: { id: true, nombre: true, nroDoc: true },
            },
          },
        },
      },
    });
    return pagos;
  }

  async reportePorPeriodo(
    empresaId: number,
    fechaInicio: string,
    fechaFin: string,
  ) {
    const inicio = new Date(`${fechaInicio}T00:00:00.000Z`);
    const fin = new Date(`${fechaFin}T23:59:59.999Z`);

    const pagos = await this.prisma.pago.findMany({
      where: {
        empresaId,
        fecha: { gte: inicio, lte: fin },
      },
      include: {
        usuario: { select: { id: true, nombre: true } },
        comprobante: {
          select: {
            id: true,
            serie: true,
            correlativo: true,
            tipoDoc: true,
            mtoImpVenta: true,
            cliente: { select: { nombre: true } },
          },
        },
      },
      orderBy: { fecha: 'desc' },
    });

    const totalPagado = pagos.reduce((sum, p) => sum + p.monto, 0);
    const porMedioPago = pagos.reduce(
      (acc, p) => {
        acc[p.medioPago] = (acc[p.medioPago] || 0) + p.monto;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      periodo: { inicio, fin },
      totalPagado,
      cantidadPagos: pagos.length,
      porMedioPago,
      pagos,
    };
  }

  async reversarPago(pagoId: number, empresaId?: number) {
    const pago = await this.prisma.pago.findUnique({
      where: { id: pagoId },
      include: { comprobante: true },
    });

    if (!pago) throw new NotFoundException('Pago no encontrado');

    if (empresaId && pago.empresaId !== empresaId) {
      throw new BadRequestException('El pago no pertenece a tu empresa');
    }

    const comprobante = pago.comprobante;

    // Restaurar saldo
    const nuevoSaldo = (comprobante.saldo ?? 0) + pago.monto;
    let nuevoEstado = comprobante.estadoPago;
    if (nuevoSaldo > 0 && comprobante.estadoPago === 'COMPLETADO') {
      nuevoEstado = 'PAGO_PARCIAL';
    }

    // Eliminar pago
    await this.prisma.pago.delete({ where: { id: pagoId } });

    // Actualizar comprobante
    return this.prisma.comprobante.update({
      where: { id: comprobante.id },
      data: { saldo: nuevoSaldo, estadoPago: nuevoEstado as any },
    });
  }

  /**
   * Recalcula el saldo de un comprobante y elimina pagos excedentes
   * Útil para corregir comprobantes con datos inconsistentes
   */
  async recalcularSaldoComprobante(comprobanteId: number, empresaId?: number) {
    const comprobante = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      include: { pagos: { orderBy: { fecha: 'asc' } } },
    });

    if (!comprobante) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    if (empresaId && comprobante.empresaId !== empresaId) {
      throw new BadRequestException('El comprobante no pertenece a tu empresa');
    }

    // Calcular el saldo neto correcto (total - retención/detracción)
    const totalComprobante = Number(comprobante.mtoImpVenta || 0);
    const montoDescontado = Number(comprobante.montoDetraccion || 0);
    const saldoNetoOriginal = Math.max(0, totalComprobante - montoDescontado);

    // Procesar pagos válidos y eliminar los excedentes
    let saldoRestante = saldoNetoOriginal;
    const pagosValidos: number[] = [];
    const pagosAEliminar: number[] = [];

    for (const pago of comprobante.pagos) {
      if (saldoRestante >= pago.monto) {
        // Este pago es válido
        saldoRestante -= pago.monto;
        pagosValidos.push(pago.id);
      } else if (saldoRestante > 0 && saldoRestante < pago.monto) {
        // Este pago excede el saldo, marcarlo para eliminar
        pagosAEliminar.push(pago.id);
      } else {
        // Saldo ya es 0, este pago no debió existir
        pagosAEliminar.push(pago.id);
      }
    }

    // Eliminar pagos excedentes
    if (pagosAEliminar.length > 0) {
      await this.prisma.pago.deleteMany({
        where: { id: { in: pagosAEliminar } },
      });
    }

    // Calcular nuevo saldo
    const totalPagadoValido = saldoNetoOriginal - saldoRestante;
    const nuevoSaldo = saldoRestante;

    // Determinar nuevo estado
    let nuevoEstado = 'PENDIENTE_PAGO';
    if (nuevoSaldo === 0) {
      nuevoEstado = 'COMPLETADO';
    } else if (totalPagadoValido > 0) {
      nuevoEstado = 'PAGO_PARCIAL';
    }

    // Actualizar comprobante
    const comprobanteActualizado = await this.prisma.comprobante.update({
      where: { id: comprobanteId },
      data: {
        saldo: nuevoSaldo,
        estadoPago: nuevoEstado as any
      },
    });

    return {
      comprobanteId,
      saldoNetoOriginal,
      totalPagadoValido,
      nuevoSaldo,
      nuevoEstado,
      pagosValidosCount: pagosValidos.length,
      pagosEliminadosCount: pagosAEliminar.length,
      pagosEliminadosIds: pagosAEliminar,
    };
  }

  /**
   * Recalcula saldos para TODOS los comprobantes al crédito de una empresa
   */
  async recalcularTodosSaldos(empresaId: number) {
    // Obtener todos los comprobantes al crédito
    const comprobantes = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        formaPagoTipo: { in: ['CREDITO', 'Credito', 'credito'] },
      },
      select: { id: true },
    });

    const resultados: any[] = [];
    for (const comp of comprobantes) {
      try {
        const resultado = await this.recalcularSaldoComprobante(comp.id, empresaId);
        if (resultado.pagosEliminadosCount > 0 || resultado.nuevoEstado !== 'COMPLETADO') {
          resultados.push(resultado);
        }
      } catch (error) {
        resultados.push({ comprobanteId: comp.id, error: error.message });
      }
    }

    return {
      totalProcesados: comprobantes.length,
      comprobantesCorregidos: resultados,
    };
  }
}
