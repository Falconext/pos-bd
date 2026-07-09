import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { ContabilidadService } from './contabilidad.service';
import { ArqueoService } from './arqueo.service';
import { CajaService } from '../caja/caja.service';
import { SireService } from './sire.service';
import type { Response } from 'express';
import * as XLSX from 'xlsx';

// Lima es UTC-5 sin DST — extrae "YYYY-MM-DD" en hora local Lima
function toFechaLima(d: Date): string {
  return new Date(d.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contabilidad')
export class ContabilidadController {
  constructor(
    private readonly service: ContabilidadService,
    private readonly arqueoService: ArqueoService,
    private readonly cajaService: CajaService,
    private readonly sireService: SireService,
  ) {}

  @Get('obtener-reporte')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerReporte(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeId?: string,
  ) {
    if (!fechaInicio || !fechaFin)
      throw new BadRequestException('fechaInicio y fechaFin son requeridos');
    const data = await this.service.obtenerReporte(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId ? Number(sedeId) : undefined,
    );
    return data;
  }

  @Get('obtener-reporte-informales')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerReporteInformales(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeId?: string,
  ) {
    if (!fechaInicio || !fechaFin)
      throw new BadRequestException('fechaInicio y fechaFin son requeridos');
    const data = await this.service.obtenerReporteInformales(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId ? Number(sedeId) : undefined,
    );
    return data;
  }

  @Get('reporte-exportar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async exportarReporte(
    @User() user: any,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @Res() res: Response,
    @Query('sedeId') sedeId?: string,
  ) {
    if (!fechaInicio || !fechaFin)
      throw new BadRequestException('fechaInicio y fechaFin son requeridos');
    const { comprobantes, resumen } = await this.service.obtenerReporte(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId ? Number(sedeId) : undefined,
    );

    const estadoPagoLabel: Record<string, string> = {
      COMPLETADO: 'Pagado',
      PENDIENTE_PAGO: 'Pendiente',
      PAGO_PARCIAL: 'Pago Parcial',
      ANULADO: 'Anulado',
    };

    const datosExcel = comprobantes.map((comp: any) => ({
      SEDE: comp.sede?.nombre ?? '',
      TIPO: comp.comprobante,
      SERIE: comp.serie,
      CORRELATIVO: comp.correlativo,
      'RUC/DNI': comp.cliente?.nroDoc ?? '',
      CLIENTE: comp.cliente?.nombre ?? '',
      'FECHA EMISIÓN': toFechaLima(new Date(comp.fechaEmision)),
      MONEDA: comp.tipoMoneda ?? 'PEN',
      'FORMA PAGO':
        (comp.formaPagoTipo ?? '').toUpperCase() === 'CREDITO'
          ? 'Crédito'
          : 'Contado',
      'MEDIO PAGO': comp.medioPago ?? '',
      'ESTADO SUNAT': comp.estadoEnvioSunat,
      'ESTADO PAGO': estadoPagoLabel[comp.estadoPago] ?? comp.estadoPago ?? '',
      'TIPO OPERACION': comp.tipoOperacion
        ? `${comp.tipoOperacion.codigo} - ${comp.tipoOperacion.descripcion}`
        : '',
      'OP. GRAVADAS': Number(comp.mtoOperGravadas ?? 0),
      'OP. INAFECTAS': Number(comp.mtoOperInafectas ?? 0),
      IGV: Number(comp.mtoIGV ?? 0),
      DESCUENTO: Number(comp.mtoDescuentoGlobal ?? 0),
      TOTAL: Number(comp.mtoImpVenta ?? 0),
      'SALDO PENDIENTE': Number(comp.saldo ?? 0),
      'MONTO DETRACCION': Number(comp.montoDetraccion ?? 0),
      '% DETRACCION': Number(comp.porcentajeDetraccion ?? 0),
      'MOTIVO NC/ND': comp.motivo?.descripcion ?? '',
      USUARIO: comp.usuario?.nombre ?? '',
      OBSERVACIONES: comp.observaciones ?? '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    worksheet['!cols'] = [
      { wch: 20 },
      { wch: 14 },
      { wch: 8 },
      { wch: 12 },
      { wch: 14 },
      { wch: 32 },
      { wch: 14 },
      { wch: 8 },
      { wch: 10 },
      { wch: 14 },
      { wch: 12 },
      { wch: 14 },
      { wch: 40 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 14 },
      { wch: 16 },
      { wch: 30 },
    ];

    XLSX.utils.sheet_add_aoa(worksheet, [[''], ['']], { origin: -1 });

    const resumenData = [
      ['BOLETAS', resumen.totalBoletas],
      ['FACTURAS', resumen.totalFacturas],
      ['NOTA DE CREDITO', resumen.totalNotasCredito],
      ['NOTA DE DEBITO', resumen.totalNotasDebito],
      ['TOTAL DESCUENTOS', resumen.totalDescuentos],
      ['TOTAL OP. INAFECTAS', resumen.totalInafectas],
      ['TOTAL OP. GRAVADAS', resumen.totalGravadas],
      ['TOTAL IGV (18%)', resumen.totalIGV],
      ['TOTAL VENTAS NETO:', resumen.totalVenta],
    ];

    XLSX.utils.sheet_add_aoa(
      worksheet,
      resumenData.map(([label, value]) =>
        Array(22).fill('').concat([label, value]),
      ),
      { origin: -1 },
    );

    // Crear y devolver el archivo
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Comprobantes');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    // Generar archivo Excel
    const fileName = `reporte-contabilidad-${fechaInicio}_a_${fechaFin}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    return res.end(buffer, 'binary');
  }

  @Get('reporte-informales-exportar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async exportarReporteInformales(
    @User() user: any,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @Res() res: Response,
    @Query('sedeId') sedeId?: string,
  ) {
    if (!fechaInicio || !fechaFin)
      throw new BadRequestException('fechaInicio y fechaFin son requeridos');
    const { comprobantes, resumen } =
      await this.service.obtenerReporteInformales(
        user.empresaId,
        fechaInicio,
        fechaFin,
        sedeId ? Number(sedeId) : undefined,
      );

    // Preparar datos para Excel siguiendo formato del proyecto Node original
    const datosExcel = comprobantes.map((comp: any) => ({
      SEDE: comp.sede?.nombre ?? '',
      TIPO: comp.comprobante,
      SERIE: comp.serie,
      CORRELATIVO: comp.correlativo,
      'NUMERO DOCUMENTO': comp.cliente?.nroDoc ?? '',
      CLIENTE: comp.cliente?.nombre ?? '',
      'FECHA EMISIÓN': toFechaLima(new Date(comp.fechaEmision)),
      'ESTADO PAGO': comp.estadoPago,
      SALDO: Number(comp.saldo ?? 0),
      'MEDIO PAGO': comp.medioPago || '-',
      'ESTADO OT': comp.estadoOT || '-',
      ADELANTO: Number(comp.adelanto ?? 0),
      TOTAL: Number(comp.mtoImpVenta ?? 0),
    }));

    // Crear hoja de cálculo
    const worksheet = XLSX.utils.json_to_sheet(datosExcel);

    // Ajustar anchos de columnas
    worksheet['!cols'] = [
      { wch: 20 }, // SEDE
      { wch: 12 }, // TIPO
      { wch: 10 }, // SERIE
      { wch: 15 }, // CORRELATIVO
      { wch: 20 }, // NUMERO DOCUMENTO
      { wch: 30 }, // CLIENTE
      { wch: 15 }, // FECHA EMISIÓN
      { wch: 15 }, // ESTADO PAGO
      { wch: 12 }, // SALDO
      { wch: 15 }, // MEDIO PAGO
      { wch: 12 }, // ESTADO OT
      { wch: 12 }, // ADELANTO
      { wch: 12 }, // TOTAL
    ];

    // Agregar filas vacías de separación
    XLSX.utils.sheet_add_aoa(worksheet, [[''], ['']], { origin: -1 });

    // Agregar filas de resumen como en el proyecto Node original
    const resumenData = [
      ['TICKETS', resumen.totalTickets],
      ['NOTAS DE VENTA', resumen.totalNotasVenta],
      ['RECIBOS HONORARIOS', resumen.totalRecibosHonorarios],
      ['COMPROBANTES PAGO', resumen.totalComprobantesPago],
      ['NOTAS PEDIDO', resumen.totalNotasPedido],
      ['ORDENES TRABAJO', resumen.totalOrdenesTrabajo],
      ['TOTALES:', resumen.totalVenta],
    ];

    XLSX.utils.sheet_add_aoa(
      worksheet,
      resumenData.map(([label, value]) =>
        Array(10).fill('').concat([label, value]),
      ),
      { origin: -1 },
    );

    // Crear y devolver el archivo
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      'Comprobantes Informales',
    );
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    // Generar archivo Excel
    const fileName = `reporte-informales-${fechaInicio}_a_${fechaFin}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    return res.end(buffer, 'binary');
  }

  @Get('obtener-arqueo')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerArqueo(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeId?: string,
  ) {
    if (!fechaInicio || !fechaFin)
      throw new BadRequestException('fechaInicio y fechaFin son requeridos');
    const data = await this.arqueoService.obtenerArqueoCaja(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId ? Number(sedeId) : undefined,
    );
    return data;
  }

  @Get('arqueo-exportar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async exportarArqueo(
    @User() user: any,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @Res() res: Response,
    @Query('sedeId') sedeId?: string,
  ) {
    if (!fechaInicio || !fechaFin)
      throw new BadRequestException('fechaInicio y fechaFin son requeridos');
    const { resumen, movimientosCaja, ingresosPorMedioPago } =
      await this.arqueoService.obtenerArqueoCaja(
        user.empresaId,
        fechaInicio,
        fechaFin,
        sedeId ? Number(sedeId) : undefined,
      );

    // Preparar datos para Excel siguiendo formato del proyecto Node original
    const datosExcel = movimientosCaja.map((mov) => ({
      TIPO: mov.tipo,
      DOCUMENTO: mov.documento,
      CLIENTE: mov.cliente,
      FECHA: new Date(mov.fecha).toISOString().split('T')[0],
      CONCEPTO: mov.concepto,
      'MEDIO PAGO': mov.medioPago,
      MONTO: Number(mov.monto),
      REFERENCIA: mov.referencia || '-',
    }));

    // Crear hoja de cálculo
    const worksheet = XLSX.utils.json_to_sheet(datosExcel);

    // Ajustar anchos de columnas
    worksheet['!cols'] = [
      { wch: 12 }, // TIPO
      { wch: 20 }, // DOCUMENTO
      { wch: 30 }, // CLIENTE
      { wch: 15 }, // FECHA
      { wch: 25 }, // CONCEPTO
      { wch: 15 }, // MEDIO PAGO
      { wch: 12 }, // MONTO
      { wch: 20 }, // REFERENCIA
    ];

    // Agregar filas vacías de separación
    XLSX.utils.sheet_add_aoa(worksheet, [[''], ['']], { origin: -1 });

    // Agregar resumen de arqueo
    const resumenData = [
      ['RESUMEN ARQUEO DE CAJA', ''],
      ['TOTAL EFECTIVO', resumen.detalleEfectivo],
      ['TOTAL YAPE', resumen.detalleYape],
      ['TOTAL PLIN', resumen.detallePlin],
      ['TOTAL TRANSFERENCIA', resumen.detalleTransferencia],
      ['TOTAL TARJETA', resumen.detalleTarjeta],
      ['TOTAL DIGITAL', resumen.totalDigital],
      ['TOTAL INGRESOS:', resumen.totalIngresos],
    ];

    XLSX.utils.sheet_add_aoa(
      worksheet,
      resumenData.map(([label, value]) =>
        Array(6).fill('').concat([label, value]),
      ),
      { origin: -1 },
    );

    // Crear y devolver el archivo
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Arqueo de Caja');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    // Generar archivo Excel
    const fileName = `arqueo-caja-${fechaInicio}_a_${fechaFin}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    return res.end(buffer, 'binary');
  }

  // ──────────────── SIRE ────────────────

  private parseSireParams(mes: string, anio: string) {
    const m = parseInt(mes, 10);
    const a = parseInt(anio, 10);
    if (!m || m < 1 || m > 12)
      throw new BadRequestException('mes inválido (1-12)');
    if (!a || a < 2020) throw new BadRequestException('anio inválido');
    return { mes: m, anio: a };
  }

  @Get('sire/ventas-txt')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async sireVentasTxt(
    @User() user: any,
    @Res() res: Response,
    @Query('mes') mes: string,
    @Query('anio') anio: string,
    @Query('simple') simple?: string,
    @Query('empresarial') empresarial?: string,
  ) {
    const { mes: m, anio: a } = this.parseSireParams(mes, anio);
    const buffer = await this.sireService.generarTxtVentas(
      user.empresaId,
      m,
      a,
      simple === 'true',
      empresarial === 'true',
      user.sedeId,
    );
    const periodo = `${a}${String(m).padStart(2, '0')}`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="SIRE_RVIE_${periodo}.txt"`,
    );
    res.setHeader('Content-Length', buffer.length.toString());
    return res.end(buffer);
  }

  @Get('sire/ventas-excel')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async sireVentasExcel(
    @User() user: any,
    @Res() res: Response,
    @Query('mes') mes: string,
    @Query('anio') anio: string,
    @Query('simple') simple?: string,
    @Query('empresarial') empresarial?: string,
  ) {
    const { mes: m, anio: a } = this.parseSireParams(mes, anio);
    const buffer = await this.sireService.generarExcelVentas(
      user.empresaId,
      m,
      a,
      simple === 'true',
      empresarial === 'true',
      user.sedeId,
    );
    const periodo = `${a}${String(m).padStart(2, '0')}`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="SIRE_RVIE_${periodo}.xlsx"`,
    );
    res.setHeader('Content-Length', buffer.length.toString());
    return res.end(buffer, 'binary');
  }

  @Post('sire/ventas-correo')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async sireVentasCorreo(
    @User() user: any,
    @Body()
    body: {
      mes: number;
      anio: number;
      simple?: boolean;
      empresarial?: boolean;
      destinatario: string;
    },
  ) {
    const { mes, anio, simple, empresarial, destinatario } = body;
    if (!destinatario)
      throw new BadRequestException('destinatario es requerido');
    await this.sireService.enviarPorCorreo({
      tipo: 'ventas',
      mes,
      anio,
      simple: simple ?? false,
      empresarial: empresarial ?? false,
      empresaId: user.empresaId,
      destinatario,
      sedeId: user.sedeId,
    });
    return { message: `Libro de ventas enviado a ${destinatario}` };
  }

  @Get('sire/compras-txt')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async sireComprasTxt(
    @User() user: any,
    @Res() res: Response,
    @Query('mes') mes: string,
    @Query('anio') anio: string,
    @Query('simple') simple?: string,
  ) {
    const { mes: m, anio: a } = this.parseSireParams(mes, anio);
    const buffer = await this.sireService.generarTxtCompras(
      user.empresaId,
      m,
      a,
      simple === 'true',
      user.sedeId,
    );
    const periodo = `${a}${String(m).padStart(2, '0')}`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="SIRE_RCE_${periodo}.txt"`,
    );
    res.setHeader('Content-Length', buffer.length.toString());
    return res.end(buffer);
  }

  @Get('sire/compras-excel')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async sireComprasExcel(
    @User() user: any,
    @Res() res: Response,
    @Query('mes') mes: string,
    @Query('anio') anio: string,
    @Query('simple') simple?: string,
  ) {
    const { mes: m, anio: a } = this.parseSireParams(mes, anio);
    const buffer = await this.sireService.generarExcelCompras(
      user.empresaId,
      m,
      a,
      simple === 'true',
      user.sedeId,
    );
    const periodo = `${a}${String(m).padStart(2, '0')}`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="SIRE_RCE_${periodo}.xlsx"`,
    );
    res.setHeader('Content-Length', buffer.length.toString());
    return res.end(buffer, 'binary');
  }

  @Post('sire/compras-correo')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async sireComprasCorreo(
    @User() user: any,
    @Body()
    body: { mes: number; anio: number; simple?: boolean; destinatario: string },
  ) {
    const { mes, anio, simple, destinatario } = body;
    if (!destinatario)
      throw new BadRequestException('destinatario es requerido');
    await this.sireService.enviarPorCorreo({
      tipo: 'compras',
      mes,
      anio,
      simple: simple ?? false,
      empresaId: user.empresaId,
      destinatario,
      sedeId: user.sedeId,
    });
    return { message: `Registro de compras enviado a ${destinatario}` };
  }
}
