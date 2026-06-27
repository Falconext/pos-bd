import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AperturaCajaDto, CierreCajaDto, MovimientoCajaDto, RegistrarEgresoDto, EditarEgresoDto } from './dto/caja.dto';

@Injectable()
export class CajaService {
  constructor(private readonly prisma: PrismaService) {}

  // Detectar turno automáticamente basado en la hora
  private detectarTurno(fecha: Date = new Date()): string {
    const hora = fecha.getHours();
    
    if (hora >= 6 && hora < 14) {
      return 'MAÑANA';
    } else if (hora >= 14 && hora < 22) {
      return 'TARDE';
    } else {
      return 'NOCHE';
    }
  }

  private parseRangeDates(fechaInicio?: string, fechaFin?: string) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    const inicio = new Date(`${fechaInicio || today}T00:00:00.000-05:00`);
    const fin = new Date(`${fechaFin || today}T23:59:59.999-05:00`);
    return { gte: inicio, lte: fin } as const;
  }

  // Verificar si la caja está abierta para el usuario
  async verificarCajaAbierta(usuarioId: number, empresaId: number, sedeId?: number) {
    const { gte: hoyInicio, lte: hoyFin } = this.parseRangeDates();

    // Solo considerar APERTURA y CIERRE — los EGRESO/INGRESO no cambian el estado de la caja
    const ultimoMovimiento = await this.prisma.movimientoCaja.findFirst({
      where: {
        usuarioId,
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        fecha: { gte: hoyInicio, lte: hoyFin },
        estado: 'ACTIVO',
        tipoMovimiento: { in: ['APERTURA', 'CIERRE'] },
      },
      orderBy: { fecha: 'desc' },
    });

    if (ultimoMovimiento && ultimoMovimiento.tipoMovimiento === 'APERTURA') {
      return ultimoMovimiento;
    }
    return null;
  }

  // Verificar si la caja ya fue cerrada hoy
  async verificarCajaCerrada(usuarioId: number, empresaId: number, sedeId?: number) {
    const { gte: hoyInicio, lte: hoyFin } = this.parseRangeDates();

    const ultimoMovimiento = await this.prisma.movimientoCaja.findFirst({
      where: {
        usuarioId,
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        fecha: { gte: hoyInicio, lte: hoyFin },
        estado: 'ACTIVO',
        tipoMovimiento: { in: ['APERTURA', 'CIERRE'] },
      },
      orderBy: { fecha: 'desc' },
    });

    if (ultimoMovimiento && ultimoMovimiento.tipoMovimiento === 'CIERRE') {
      return ultimoMovimiento;
    }
    return null;
  }

  // Abrir caja
  async abrirCaja(
    usuarioId: number,
    empresaId: number,
    aperturaCajaDto: AperturaCajaDto,
    sedeId?: number,
  ) {
    // Verificar si ya hay una caja abierta hoy
    const cajaAbierta = await this.verificarCajaAbierta(usuarioId, empresaId, sedeId);
    if (cajaAbierta) {
      throw new BadRequestException(
        'Ya existe una caja abierta para el día de hoy',
      );
    }

    // Detectar turno automáticamente o usar el proporcionado
    const turno = aperturaCajaDto.turno || this.detectarTurno();

    // Crear movimiento de apertura
    const apertura = await this.prisma.movimientoCaja.create({
      data: {
        usuarioId,
        empresaId,
        sedeId,
        tipoMovimiento: 'APERTURA',
        montoInicial: aperturaCajaDto.montoInicial,
        montoEfectivo: aperturaCajaDto.montoInicial,
        observaciones: aperturaCajaDto.observaciones,
        turno,
        estado: 'ACTIVO',
      },
      include: {
        usuario: { select: { nombre: true, email: true } },
        empresa: { select: { razonSocial: true } },
      },
    });

    return {
      success: true,
      message: 'Caja abierta correctamente',
      data: apertura,
    };
  }

  // Cerrar caja
  async cerrarCaja(
    usuarioId: number,
    empresaId: number,
    cierreCajaDto: CierreCajaDto,
    sedeId?: number,
  ) {
    // Verificar si hay una caja abierta
    const cajaAbierta = await this.verificarCajaAbierta(usuarioId, empresaId, sedeId);
    if (!cajaAbierta) {
      throw new BadRequestException(
        'No hay una caja abierta para cerrar en el día de hoy',
      );
    }

    // Ya no bloqueamos por cierres previos del día; permitimos múltiples turnos.

    // Calcular totales de ventas del turno actual (desde la apertura hasta ahora)
    const fechaApertura = cajaAbierta.fecha;
    const fechaActual = new Date();

    const ventasDelTurno = await this.obtenerVentasDelDia(
      empresaId,
      fechaApertura,
      fechaActual,
      sedeId,
    );

    const montoDeclarado =
      cierreCajaDto.montoEfectivo +
      cierreCajaDto.montoYape +
      cierreCajaDto.montoPlin +
      cierreCajaDto.montoTransferencia +
      cierreCajaDto.montoTarjeta;

    const diferencia = montoDeclarado - ventasDelTurno.totalIngresos;

    // Usar el mismo turno que la apertura
    const turnoApertura = cajaAbierta.turno || this.detectarTurno();

    // Crear movimiento de cierre
    const cierre = await this.prisma.movimientoCaja.create({
      data: {
        usuarioId,
        empresaId,
        sedeId,
        tipoMovimiento: 'CIERRE',
        montoFinal: montoDeclarado,
        montoEfectivo: cierreCajaDto.montoEfectivo,
        montoYape: cierreCajaDto.montoYape,
        montoPlin: cierreCajaDto.montoPlin,
        montoTransferencia: cierreCajaDto.montoTransferencia,
        montoTarjeta: cierreCajaDto.montoTarjeta,
        totalVentas: ventasDelTurno.totalIngresos,
        totalIngresos: ventasDelTurno.totalIngresos,
        diferencia,
        observaciones: cierreCajaDto.observaciones,
        fechaCierre: new Date(),
        turno: turnoApertura,
        estado: 'ACTIVO',
      },
      include: {
        usuario: { select: { nombre: true, email: true } },
        empresa: { select: { razonSocial: true } },
      },
    });

    return {
      success: true,
      message: 'Caja cerrada correctamente',
      data: {
        ...cierre,
        ventasDelTurno,
        diferencia: parseFloat(diferencia.toString()),
      },
    };
  }

  // Obtener estado actual de la caja
  async obtenerEstadoCaja(usuarioId: number, empresaId: number, sedeId?: number) {
    const cajaAbierta = await this.verificarCajaAbierta(usuarioId, empresaId, sedeId);
    const cajaCerrada = await this.verificarCajaCerrada(usuarioId, empresaId, sedeId);

    let estado: 'CERRADA' | 'ABIERTA' | 'PENDIENTE_CIERRE' = 'CERRADA';
    let movimiento: any = null;

    if (cajaAbierta && !cajaCerrada) {
      estado = 'ABIERTA';
      movimiento = cajaAbierta;
    } else if (cajaAbierta && cajaCerrada) {
      estado = 'CERRADA';
      movimiento = cajaCerrada;
    } else {
      estado = 'CERRADA';
    }

    // Obtener ventas del período apropiado
    let ventasDelDia;
    if (cajaAbierta && estado === 'ABIERTA') {
      // Si hay caja abierta, mostrar solo ventas del turno actual
      ventasDelDia = await this.obtenerVentasDelDia(
        empresaId,
        cajaAbierta.fecha,
        new Date(),
        sedeId,
      );
    } else {
      const fechaEmision = this.parseRangeDates();
      ventasDelDia = await this.obtenerVentasDelDia(
        empresaId,
        fechaEmision.gte,
        fechaEmision.lte,
        sedeId,
      );
    }

    // Calcular total de egresos y obtener recientes
    let totalEgresos = 0;
    let egresosRecientes: any[] = [];
    if (estado === 'ABIERTA' && cajaAbierta) {
      const [resumen, recientes] = await Promise.all([
        this.prisma.movimientoCaja.aggregate({
          where: {
            empresaId,
            ...(sedeId ? { sedeId } : {}),
            tipoMovimiento: 'EGRESO',
            fecha: { gte: cajaAbierta.fecha },
            estado: 'ACTIVO',
          },
          _sum: { monto: true },
        }),
        this.prisma.movimientoCaja.findMany({
          where: {
            empresaId,
            ...(sedeId ? { sedeId } : {}),
            tipoMovimiento: 'EGRESO',
            fecha: { gte: cajaAbierta.fecha },
            estado: 'ACTIVO',
          },
          orderBy: { fecha: 'desc' },
          take: 10,
          include: { usuario: { select: { nombre: true } } }
        })
      ]);
      totalEgresos = Number(resumen._sum.monto || 0);
      egresosRecientes = recientes;
    }

    return {
      estado,
      movimiento,
      ventasDelDia,
      totalEgresos,
      egresosRecientes,
      fecha: new Date(),
    };
  }

  // Obtener historial de movimientos de caja
  async obtenerHistorialCaja(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
    page = 1,
    limit = 50,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRangeDates(fechaInicio, fechaFin);
    const skip = (page - 1) * limit;

    const [movimientos, total] = await Promise.all([
      this.prisma.movimientoCaja.findMany({
        where: {
          empresaId,
          ...(sedeId ? { sedeId } : {}),
          fecha: fechaEmision,
          estado: 'ACTIVO',
        },
        include: {
          usuario: { select: { nombre: true, email: true } },
        },
        orderBy: { fecha: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.movimientoCaja.count({
        where: {
          empresaId,
          ...(sedeId ? { sedeId } : {}),
          fecha: fechaEmision,
          estado: 'ACTIVO',
        },
      }),
    ]);

    return {
      movimientos,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Obtener arqueo mejorado con información de caja
  async obtenerArqueoConCaja(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRangeDates(fechaInicio, fechaFin);

    // Obtener movimientos de caja del período
    const movimientosCaja = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        fecha: fechaEmision,
        estado: 'ACTIVO',
      },
      include: {
        usuario: { select: { nombre: true, email: true } },
      },
      orderBy: { fecha: 'desc' },
    });

    // Obtener ventas del período
    const ventasDelPeriodo = await this.obtenerVentasDelDia(
      empresaId,
      fechaEmision.gte,
      fechaEmision.lte,
      sedeId,
    );

    // Calcular resumen de aperturas y cierres
    const aperturas = movimientosCaja.filter(m => m.tipoMovimiento === 'APERTURA');
    const cierres = movimientosCaja.filter(m => m.tipoMovimiento === 'CIERRE');

    // Calcular resumen por turno
    const resumenPorTurno = movimientosCaja.reduce((acc, mov) => {
      const turno = mov.turno || 'SIN_TURNO';
      if (!acc[turno]) {
        acc[turno] = {
          turno,
          aperturas: 0,
          cierres: 0,
          montoInicialTotal: 0,
          montoFinalTotal: 0,
          diferenciasTotal: 0,
        };
      }
      
      if (mov.tipoMovimiento === 'APERTURA') {
        acc[turno].aperturas++;
        acc[turno].montoInicialTotal += parseFloat(mov.montoInicial?.toString() || '0');
      } else if (mov.tipoMovimiento === 'CIERRE') {
        acc[turno].cierres++;
        acc[turno].montoFinalTotal += parseFloat(mov.montoFinal?.toString() || '0');
        acc[turno].diferenciasTotal += parseFloat(mov.diferencia?.toString() || '0');
      }
      
      return acc;
    }, {} as Record<string, any>);

    const resumenCaja = {
      totalAperturas: aperturas.length,
      totalCierres: cierres.length,
      montoInicialTotal: aperturas.reduce((sum, a) => sum + parseFloat(a.montoInicial?.toString() || '0'), 0),
      montoFinalTotal: cierres.reduce((sum, c) => sum + parseFloat(c.montoFinal?.toString() || '0'), 0),
      diferenciasTotal: cierres.reduce((sum, c) => sum + parseFloat(c.diferencia?.toString() || '0'), 0),
      resumenPorTurno: Object.values(resumenPorTurno),
    };

    return {
      ventasDelPeriodo,
      movimientosCaja,
      resumenCaja,
      fechaInicio: fechaEmision.gte,
      fechaFin: fechaEmision.lte,
    };
  }

  // Método auxiliar para obtener ventas del día
  private async obtenerVentasDelDia(
    empresaId: number,
    fechaInicio: Date,
    fechaFin: Date,
    sedeId?: number,
  ) {
    // Comprobantes informales completados
    const comprobantesInformales = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        tipoDoc: { in: ['TICKET', 'NV', 'RH', 'CP', 'NP', 'OT'] },
        creadoEn: { gte: fechaInicio, lte: fechaFin },
        estadoPago: 'COMPLETADO',
        estadoEnvioSunat: { not: 'ANULADO' as any },
        OR: [
          { adelanto: null },
          { adelanto: 0 }
        ],
        pagos: { none: {} }
      },
      select: { mtoImpVenta: true, medioPago: true },
    });

    // Comprobantes formales de contado
    const comprobantesFormales = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        tipoDoc: { in: ['01', '03'] },
        creadoEn: { gte: fechaInicio, lte: fechaFin },
        estadoEnvioSunat: { in: ['EMITIDO', 'PENDIENTE', 'REGISTRADO', 'ENVIADO'] as any },
        formaPagoTipo: 'Contado',
        pagos: { none: {} }
      },
      select: { mtoImpVenta: true, medioPago: true },
    });

    // Pagos del período
    const pagos = await this.prisma.pago.findMany({
      where: {
        empresaId,
        fecha: { gte: fechaInicio, lte: fechaFin },
        ...(sedeId ? { comprobante: { sedeId } } : {}),
      },
      select: { monto: true, medioPago: true },
    });

    // Calcular totales por medio de pago
    const mediosPago = {
      EFECTIVO: 0,
      YAPE: 0,
      PLIN: 0,
      TRANSFERENCIA: 0,
      TARJETA: 0,
    };

    [...comprobantesInformales, ...comprobantesFormales].forEach((comp) => {
      let medio = (comp.medioPago || 'EFECTIVO').toString().toUpperCase().trim();
      const monto = Number(comp.mtoImpVenta || 0);
      
      // Normalizar nombres de medios de pago
      if (medio === 'EFECTIVO' || medio === 'CASH') {
        medio = 'EFECTIVO';
      } else if (medio === 'YAPE') {
        medio = 'YAPE';
      } else if (medio === 'PLIN') {
        medio = 'PLIN';
      } else if (medio === 'TRANSFERENCIA' || medio === 'TRANSFER') {
        medio = 'TRANSFERENCIA';
      } else if (medio === 'TARJETA' || medio === 'CARD') {
        medio = 'TARJETA';
      } else {
        console.log(`Medio de pago no reconocido: "${comp.medioPago}" -> "${medio}", asignando a EFECTIVO`);
        medio = 'EFECTIVO';
      }
      
      mediosPago[medio as keyof typeof mediosPago] += monto;
    });

    pagos.forEach((pago) => {
      let medio = (pago.medioPago || 'EFECTIVO').toString().toUpperCase().trim();
      const monto = Number(pago.monto || 0);
      
      // Normalizar nombres de medios de pago para pagos
      if (medio === 'EFECTIVO' || medio === 'CASH') {
        medio = 'EFECTIVO';
      } else if (medio === 'YAPE') {
        medio = 'YAPE';
      } else if (medio === 'PLIN') {
        medio = 'PLIN';
      } else if (medio === 'TRANSFERENCIA' || medio === 'TRANSFER') {
        medio = 'TRANSFERENCIA';
      } else if (medio === 'TARJETA' || medio === 'CARD') {
        medio = 'TARJETA';
      } else {
        console.log(`Medio de pago de pago no reconocido: "${pago.medioPago}" -> "${medio}", asignando a EFECTIVO`);
        medio = 'EFECTIVO';
      }
      
      mediosPago[medio as keyof typeof mediosPago] += monto;
    });

    const totalIngresos = Object.values(mediosPago).reduce((sum, val) => sum + val, 0);

    return {
      totalIngresos,
      mediosPago,
      totalComprobantesInformales: comprobantesInformales.length,
      totalComprobantesFormales: comprobantesFormales.length,
      totalPagos: pagos.length,
    };
  }

  // Obtener reporte de turno específico
  async obtenerReporteTurno(
    empresaId: number,
    turno: string,
    fecha?: string,
    sedeId?: number,
  ) {
    const fechaEmision = fecha
      ? this.parseRangeDates(fecha, fecha)
      : this.parseRangeDates(
          new Date().toISOString().split('T')[0],
          new Date().toISOString().split('T')[0],
        );

    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        turno,
        fecha: fechaEmision,
        estado: 'ACTIVO',
      },
      include: {
        usuario: { select: { nombre: true, email: true } },
      },
      orderBy: { fecha: 'asc' },
    });

    const aperturas = movimientos.filter((m) => m.tipoMovimiento === 'APERTURA');
    const cierres = movimientos.filter((m) => m.tipoMovimiento === 'CIERRE');

    // Calcular totales
    const montoInicialTotal = aperturas.reduce(
      (sum, a) => sum + parseFloat(a.montoInicial?.toString() || '0'),
      0,
    );
    const montoFinalTotal = cierres.reduce(
      (sum, c) => sum + parseFloat(c.montoFinal?.toString() || '0'),
      0,
    );
    const diferenciasTotal = cierres.reduce(
      (sum, c) => sum + parseFloat(c.diferencia?.toString() || '0'),
      0,
    );
    const totalVentas = cierres.reduce(
      (sum, c) => sum + parseFloat(c.totalVentas?.toString() || '0'),
      0,
    );

    // Calcular medios de pago
    const mediosPago = {
      EFECTIVO: cierres.reduce(
        (sum, c) => sum + parseFloat(c.montoEfectivo?.toString() || '0'),
        0,
      ),
      YAPE: cierres.reduce(
        (sum, c) => sum + parseFloat(c.montoYape?.toString() || '0'),
        0,
      ),
      PLIN: cierres.reduce(
        (sum, c) => sum + parseFloat(c.montoPlin?.toString() || '0'),
        0,
      ),
      TRANSFERENCIA: cierres.reduce(
        (sum, c) => sum + parseFloat(c.montoTransferencia?.toString() || '0'),
        0,
      ),
      TARJETA: cierres.reduce(
        (sum, c) => sum + parseFloat(c.montoTarjeta?.toString() || '0'),
        0,
      ),
    };

    return {
      turno,
      fecha: fechaEmision.gte,
      movimientos,
      resumen: {
        totalAperturas: aperturas.length,
        totalCierres: cierres.length,
        montoInicialTotal,
        montoFinalTotal,
        diferenciasTotal,
        totalVentas,
        mediosPago,
      },
    };
  }

  // Obtener reporte de usuarios por turno
  async obtenerReporteUsuariosPorTurno(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRangeDates(fechaInicio, fechaFin);

    // Obtener todos los movimientos del período
    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        fecha: fechaEmision,
        estado: 'ACTIVO',
      },
      include: {
        usuario: { select: { id: true, nombre: true, email: true } },
      },
      orderBy: { fecha: 'desc' },
    });

    // Agrupar por usuario y turno
    const reportePorUsuario = movimientos.reduce((acc, mov) => {
      const usuarioId = mov.usuarioId;
      const turno = mov.turno || 'SIN_TURNO';
      const usuarioNombre = mov.usuario?.nombre || 'Sin usuario';

      if (!acc[usuarioId]) {
        acc[usuarioId] = {
          usuarioId,
          usuarioNombre,
          usuarioEmail: mov.usuario?.email || '',
          turnos: {},
          totales: {
            aperturas: 0,
            cierres: 0,
            montoInicialTotal: 0,
            montoFinalTotal: 0,
            diferenciasTotal: 0,
          },
        };
      }

      if (!acc[usuarioId].turnos[turno]) {
        acc[usuarioId].turnos[turno] = {
          turno,
          aperturas: 0,
          cierres: 0,
          montoInicialTotal: 0,
          montoFinalTotal: 0,
          diferenciasTotal: 0,
          movimientos: [],
        };
      }

      acc[usuarioId].turnos[turno].movimientos.push(mov);

      if (mov.tipoMovimiento === 'APERTURA') {
        acc[usuarioId].turnos[turno].aperturas++;
        acc[usuarioId].totales.aperturas++;
        const monto = parseFloat(mov.montoInicial?.toString() || '0');
        acc[usuarioId].turnos[turno].montoInicialTotal += monto;
        acc[usuarioId].totales.montoInicialTotal += monto;
      } else if (mov.tipoMovimiento === 'CIERRE') {
        acc[usuarioId].turnos[turno].cierres++;
        acc[usuarioId].totales.cierres++;
        const montoFinal = parseFloat(mov.montoFinal?.toString() || '0');
        const diferencia = parseFloat(mov.diferencia?.toString() || '0');
        acc[usuarioId].turnos[turno].montoFinalTotal += montoFinal;
        acc[usuarioId].turnos[turno].diferenciasTotal += diferencia;
        acc[usuarioId].totales.montoFinalTotal += montoFinal;
        acc[usuarioId].totales.diferenciasTotal += diferencia;
      }

      return acc;
    }, {} as Record<number, any>);

    // Convertir a array y ordenar
    const reporteArray = Object.values(reportePorUsuario).map((usuario: any) => ({
      ...usuario,
      turnos: Object.values(usuario.turnos),
    }));

    return {
      fechaInicio: fechaEmision.gte,
      fechaFin: fechaEmision.lte,
      usuarios: reporteArray,
    };
  }

  async registrarEgreso(
    usuarioId: number,
    empresaId: number,
    dto: RegistrarEgresoDto,
    sedeId?: number,
  ) {
    const cajaAbierta = await this.verificarCajaAbierta(usuarioId, empresaId, sedeId);
    if (!cajaAbierta) {
      throw new BadRequestException('No hay una caja abierta. Abre un turno antes de registrar gastos.');
    }

    const egreso = await this.prisma.movimientoCaja.create({
      data: {
        usuarioId,
        empresaId,
        sedeId,
        tipoMovimiento: 'EGRESO',
        monto: dto.monto,
        categoriaGasto: dto.categoriaGasto,
        descripcionGasto: dto.descripcionGasto,
        metodoPago: dto.metodoPago || 'Efectivo',
        estado: 'ACTIVO',
      },
      include: {
        usuario: { select: { nombre: true, email: true } },
      },
    });

    return {
      code: 1,
      message: 'Gasto registrado correctamente',
      data: egreso,
    };
  }

  async editarEgreso(empresaId: number, id: number, dto: EditarEgresoDto) {
    const egreso = await this.prisma.movimientoCaja.findFirst({
      where: { id, empresaId, tipoMovimiento: 'EGRESO', estado: 'ACTIVO' },
    });
    if (!egreso) throw new NotFoundException('Gasto no encontrado');

    const updated = await this.prisma.movimientoCaja.update({
      where: { id },
      data: {
        ...(dto.monto !== undefined && { monto: dto.monto }),
        ...(dto.categoriaGasto !== undefined && { categoriaGasto: dto.categoriaGasto }),
        ...(dto.descripcionGasto !== undefined && { descripcionGasto: dto.descripcionGasto }),
        ...(dto.metodoPago !== undefined && { metodoPago: dto.metodoPago }),
      },
    });

    return { code: 1, message: 'Gasto actualizado correctamente', data: updated };
  }

  async eliminarEgreso(empresaId: number, id: number) {
    const egreso = await this.prisma.movimientoCaja.findFirst({
      where: { id, empresaId, tipoMovimiento: 'EGRESO', estado: 'ACTIVO' },
    });
    if (!egreso) throw new NotFoundException('Gasto no encontrado');

    await this.prisma.movimientoCaja.update({
      where: { id },
      data: { estado: 'INACTIVO' },
    });

    return { code: 1, message: 'Gasto eliminado correctamente' };
  }
}