import { Test, TestingModule } from '@nestjs/testing';
import { ComprobanteService } from './comprobante.service';
import { PrismaService } from '../prisma/prisma.service';
import { KardexService } from '../kardex/kardex.service';
import { InventarioNotificacionesService } from '../notificaciones/inventario-notificaciones.service';
import { S3Service } from '../s3/s3.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { ProductoLoteService } from '../producto/producto-lote.service';
import { EnviarSunatService } from './enviar-sunat.service';
import { ComisionesService } from '../comisiones/comisiones.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ComprobanteService - Stock Management', () => {
  let service: ComprobanteService;
  let prisma: PrismaService;

  const mockKardexService = {
    registrarMovimiento: jest.fn().mockResolvedValue({ id: 999 }),
    registrarMovimientoDetalle: jest.fn(),
  };

  const mockPrismaService = {
    comprobante: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    producto: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    cliente: {
      findFirst: jest.fn(),
    },
    tipoOperacion: {
      findUnique: jest.fn(),
    },
    motivoNota: {
      findUnique: jest.fn(),
    },
    pago: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    movimientoKardex: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    movimientoKardexLote: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    sede: {
      findFirst: jest.fn().mockResolvedValue({ id: 1 }),
    },
    productoLote: {
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComprobanteService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: KardexService, useValue: mockKardexService },
        { provide: InventarioNotificacionesService, useValue: { verificarStockBajo: jest.fn() } },
        { provide: S3Service, useValue: { uploadFile: jest.fn(), deleteFile: jest.fn() } },
        { provide: PdfGeneratorService, useValue: { generarComprobante: jest.fn(), generarTicket: jest.fn() } },
        { provide: ProductoLoteService, useValue: { descontarLoteFEFO: jest.fn(), revertirLote: jest.fn(), aumentarStockLote: jest.fn() } },
        { provide: EnviarSunatService, useValue: { enviarComprobante: jest.fn(), anularEnSunat: jest.fn() } },
        { provide: ComisionesService, useValue: { registrarComision: jest.fn() } },
      ],
    }).compile();

    service = module.get<ComprobanteService>(ComprobanteService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Restore defaults after clear
    mockPrismaService.pago.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaService.movimientoKardex.findMany.mockResolvedValue([]);
    mockPrismaService.movimientoKardexLote.findMany.mockResolvedValue([]);
    mockPrismaService.sede.findFirst.mockResolvedValue({ id: 1 });
    mockKardexService.registrarMovimiento.mockResolvedValue({ id: 999 });
  });

  describe('anularComprobante', () => {
    it('debería revertir stock para comprobante formal (factura) vía kardexService', async () => {
      const mockComprobante = {
        id: 1,
        tipoDoc: '01',
        serie: 'F0A1',
        correlativo: 1,
        estadoEnvioSunat: 'PENDIENTE',
        empresaId: 5,
        detalles: [
          { id: 1, productoId: 100, cantidad: 5, descripcion: 'Producto A' },
          { id: 2, productoId: 101, cantidad: 3, descripcion: 'Producto B' },
        ],
      };

      mockPrismaService.comprobante.findUnique.mockResolvedValue(mockComprobante);
      mockPrismaService.producto.findUnique
        .mockResolvedValueOnce({ id: 100, stock: 10, costoPromedio: 20 })
        .mockResolvedValueOnce({ id: 101, stock: 20, costoPromedio: 15 });
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
      });

      await service.anularComprobante(1);

      // Kardex service es el que ahora maneja el stock (no prisma.produto.update directo)
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledTimes(2);
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({ productoId: 100, tipoMovimiento: 'INGRESO', cantidad: 5 }),
      );
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({ productoId: 101, tipoMovimiento: 'INGRESO', cantidad: 3 }),
      );

      // Pagos eliminados
      expect(mockPrismaService.pago.deleteMany).toHaveBeenCalledWith({
        where: { comprobanteId: 1 },
      });

      // Comprobante marcado ANULADO
      expect(mockPrismaService.comprobante.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { estadoEnvioSunat: 'ANULADO' },
      });
    });

    it('debería revertir stock para comprobante informal (ticket) y eliminar pagos', async () => {
      const mockComprobante = {
        id: 2,
        tipoDoc: 'TICKET',
        serie: 'T001',
        correlativo: 1,
        empresaId: 5,
        detalles: [
          { id: 3, productoId: 102, cantidad: 2, descripcion: 'Producto C' },
        ],
      };

      mockPrismaService.comprobante.findUnique.mockResolvedValue(mockComprobante);
      mockPrismaService.producto.findUnique.mockResolvedValue({ id: 102, stock: 5, costoPromedio: 10 });
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
        estadoPago: 'ANULADO',
        saldo: 0,
      });

      await service.anularComprobante(2);

      // Stock revertido vía kardexService
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({ productoId: 102, tipoMovimiento: 'INGRESO', cantidad: 2 }),
      );

      // Pagos eliminados
      expect(mockPrismaService.pago.deleteMany).toHaveBeenCalledWith({
        where: { comprobanteId: 2 },
      });

      // Comprobante informal: también actualiza estadoPago y saldo
      expect(mockPrismaService.comprobante.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          estadoEnvioSunat: 'ANULADO',
          estadoPago: 'ANULADO',
          saldo: 0,
        },
      });
    });

    it('NO debería revertir stock para nota de crédito', async () => {
      const mockComprobante = {
        id: 3,
        tipoDoc: '07',
        serie: 'FCA1',
        correlativo: 1,
        empresaId: 5,
        detalles: [
          { id: 4, productoId: 103, cantidad: 1, descripcion: 'Producto D' },
        ],
      };

      mockPrismaService.comprobante.findUnique.mockResolvedValue(mockComprobante);
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
      });

      await service.anularComprobante(3);

      // NC no revierte stock
      expect(mockKardexService.registrarMovimiento).not.toHaveBeenCalled();
      expect(mockPrismaService.producto.findUnique).not.toHaveBeenCalled();

      // Pagos eliminados igual
      expect(mockPrismaService.pago.deleteMany).toHaveBeenCalledWith({
        where: { comprobanteId: 3 },
      });

      expect(mockPrismaService.comprobante.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { estadoEnvioSunat: 'ANULADO' },
      });
    });

    it('debería manejar productos inexistentes sin fallar', async () => {
      const mockComprobante = {
        id: 4,
        tipoDoc: '01',
        serie: 'F0A1',
        correlativo: 2,
        estadoEnvioSunat: 'PENDIENTE',
        empresaId: 5,
        detalles: [
          { id: 5, productoId: 999, cantidad: 1, descripcion: 'Producto inexistente' },
        ],
      };

      mockPrismaService.comprobante.findUnique.mockResolvedValue(mockComprobante);
      mockPrismaService.producto.findUnique.mockResolvedValue(null);
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
      });

      await service.anularComprobante(4);

      // Produto no existe, kardex no se llama
      expect(mockKardexService.registrarMovimiento).not.toHaveBeenCalled();

      // Pero pagos y comprobante sí se actualizan
      expect(mockPrismaService.pago.deleteMany).toHaveBeenCalledWith({
        where: { comprobanteId: 4 },
      });
      expect(mockPrismaService.comprobante.update).toHaveBeenCalledWith({
        where: { id: 4 },
        data: { estadoEnvioSunat: 'ANULADO' },
      });
    });

    it('debería lanzar NotFoundException si el comprobante no existe', async () => {
      mockPrismaService.comprobante.findUnique.mockResolvedValue(null);

      await expect(service.anularComprobante(999)).rejects.toThrow(NotFoundException);
      await expect(service.anularComprobante(999)).rejects.toThrow('Comprobante no encontrado');
    });

    it('debería eliminar pagos al anular NV (nota de venta)', async () => {
      const mockComprobante = {
        id: 10,
        tipoDoc: 'NV',
        serie: 'NV001',
        correlativo: 5,
        empresaId: 7,
        detalles: [
          { id: 20, productoId: 200, cantidad: 3, descripcion: 'Producto X' },
        ],
      };

      mockPrismaService.comprobante.findUnique.mockResolvedValue(mockComprobante);
      mockPrismaService.producto.findUnique.mockResolvedValue({ id: 200, stock: 10, costoPromedio: 25 });
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
        estadoPago: 'ANULADO',
        saldo: 0,
      });
      mockPrismaService.pago.deleteMany.mockResolvedValue({ count: 2 });

      await service.anularComprobante(10);

      // Stock revertido vía kardexService
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({ productoId: 200, tipoMovimiento: 'INGRESO', cantidad: 3, empresaId: 7 }),
      );

      // Pagos eliminados — punto clave del fix
      expect(mockPrismaService.pago.deleteMany).toHaveBeenCalledWith({
        where: { comprobanteId: 10 },
      });

      // Comprobante informal actualizado
      expect(mockPrismaService.comprobante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({ estadoEnvioSunat: 'ANULADO', estadoPago: 'ANULADO', saldo: 0 }),
        }),
      );
    });

    it('debería eliminar pagos al anular OT (orden de trabajo)', async () => {
      const mockComprobante = {
        id: 11,
        tipoDoc: 'OT',
        serie: 'OT001',
        correlativo: 3,
        empresaId: 7,
        detalles: [
          { id: 21, productoId: 201, cantidad: 1, descripcion: 'Servicio Z' },
        ],
      };

      mockPrismaService.comprobante.findUnique.mockResolvedValue(mockComprobante);
      mockPrismaService.producto.findUnique.mockResolvedValue({ id: 201, stock: 5, costoPromedio: 0 });
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
        estadoPago: 'ANULADO',
        saldo: 0,
      });
      mockPrismaService.pago.deleteMany.mockResolvedValue({ count: 1 });

      await service.anularComprobante(11);

      expect(mockPrismaService.pago.deleteMany).toHaveBeenCalledWith({
        where: { comprobanteId: 11 },
      });
    });
  });
});
