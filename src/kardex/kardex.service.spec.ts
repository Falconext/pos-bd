import { Test, TestingModule } from '@nestjs/testing';
import { KardexService } from './kardex.service';
import { PrismaService } from '../prisma/prisma.service';
import { PdfGeneratorService } from '../comprobante/pdf-generator.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('KardexService', () => {
  let service: KardexService;
  let prisma: PrismaService;

  const mockPrismaService = {
    producto: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    productoStock: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ stock: 100, producto: { costoPromedio: 10.5 } }),
      update: jest.fn().mockResolvedValue({}),
      // Descuento atómico de salidas: `count: 1` = habia stock suficiente, que
      // es el camino normal. Con 0 el servicio cae al fallback que fuerza 0.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { stock: 100 } }),
    },
    movimientoKardex: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      // Reconciliacion post-registro: si el stock real difiere del que quedo
      // grabado en el movimiento, el servicio corrige la fila.
      update: jest.fn().mockResolvedValue({}),
    },
    cliente: {
      findFirst: jest.fn(),
    },
  };

  // KardexService lo inyecta solo para la constancia de garantía; ninguna de
  // estas pruebas la ejercita, pero Nest exige el provider para instanciar.
  const mockPdfGeneratorService = {
    generarPDFConstanciaGarantia: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KardexService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: PdfGeneratorService,
          useValue: mockPdfGeneratorService,
        },
      ],
    }).compile();

    service = module.get<KardexService>(KardexService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registrarMovimiento', () => {
    it('debería registrar un movimiento de salida correctamente', async () => {
      const mockProducto = {
        stock: 100,
        costoPromedio: 10.5,
      };

      const mockMovimiento = {
        id: 1,
        productoId: 1,
        empresaId: 1,
        tipoMovimiento: 'SALIDA',
        concepto: 'Venta producto',
        cantidad: 5,
        stockAnterior: 100,
        stockActual: 95,
        costoUnitario: 10.5,
        valorTotal: 52.5,
        fecha: new Date(),
        producto: {
          id: 1,
          descripcion: 'Producto Test',
          unidadMedida: {
            codigo: 'UND',
            nombre: 'Unidad',
          },
        },
        usuario: null,
        comprobante: null,
      };

      mockPrismaService.producto.findUnique.mockResolvedValue(mockProducto);
      mockPrismaService.movimientoKardex.create.mockResolvedValue(
        mockMovimiento,
      );

      const result = await service.registrarMovimiento({
        productoId: 1,
        empresaId: 1,
        sedeId: 1,
        tipoMovimiento: 'SALIDA',
        concepto: 'Venta producto',
        cantidad: 5,
        costoUnitario: 10.5,
      });

      // El stock dejo de vivir en Producto: ahora se lee de ProductoStock,
      // que es por sede. `producto.findUnique` solo queda como fallback para
      // cuando la fila de la sede todavia no existe.
      expect(mockPrismaService.productoStock.findUnique).toHaveBeenCalledWith({
        where: { productoId_sedeId: { productoId: 1, sedeId: 1 } },
        include: { producto: { select: { costoPromedio: true } } },
      });

      expect(mockPrismaService.movimientoKardex.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productoId: 1,
          empresaId: 1,
          tipoMovimiento: 'SALIDA',
          concepto: 'Venta producto',
          cantidad: 5,
          stockAnterior: 100,
          stockActual: 95,
          costoUnitario: 10.5,
          valorTotal: 52.5,
        }),
        include: expect.any(Object),
      });

      expect(result).toEqual(mockMovimiento);
    });

    it('debería lanzar NotFoundException si el producto no existe', async () => {
      // Sin fila en la sede el servicio intenta crearla desde Producto; si ese
      // tampoco existe, el upsert no deja stock y debe abortar con NotFound.
      mockPrismaService.productoStock.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrismaService.producto.findUnique.mockResolvedValue(null);

      await expect(
        service.registrarMovimiento({
          productoId: 999,
          empresaId: 1,
          sedeId: 1,
          tipoMovimiento: 'SALIDA',
          concepto: 'Venta producto',
          cantidad: 5,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debería calcular correctamente stock para movimiento de ingreso', async () => {
      const mockProducto = {
        stock: 50,
        costoPromedio: 8.0,
      };

      // Este caso parte de 50, no de los 100 del mock compartido: el stock sale
      // de ProductoStock (por sede), asi que hay que sobreescribirlo aqui.
      mockPrismaService.productoStock.findUnique.mockResolvedValue({
        stock: 50,
        producto: { costoPromedio: 8.0 },
      });

      const mockMovimiento = {
        id: 2,
        productoId: 1,
        empresaId: 1,
        tipoMovimiento: 'INGRESO',
        concepto: 'Compra producto',
        cantidad: 20,
        stockAnterior: 50,
        stockActual: 70,
        costoUnitario: 9.0,
        valorTotal: 180.0,
        fecha: new Date(),
        producto: {
          id: 1,
          descripcion: 'Producto Test',
          unidadMedida: {
            codigo: 'UND',
            nombre: 'Unidad',
          },
        },
        usuario: null,
        comprobante: null,
      };

      mockPrismaService.producto.findUnique.mockResolvedValue(mockProducto);
      mockPrismaService.movimientoKardex.create.mockResolvedValue(
        mockMovimiento,
      );

      const result = await service.registrarMovimiento({
        productoId: 1,
        empresaId: 1,
        sedeId: 1,
        tipoMovimiento: 'INGRESO',
        concepto: 'Compra producto',
        cantidad: 20,
        costoUnitario: 9.0,
      });

      expect(mockPrismaService.movimientoKardex.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stockAnterior: 50,
          stockActual: 70,
        }),
        include: expect.any(Object),
      });

      expect(result).toEqual(mockMovimiento);
    });
  });

  describe('calcularStockActual', () => {
    it('debería retornar el stock del último movimiento', async () => {
      const mockMovimientos = [
        {
          id: 1,
          stockActual: 85,
          fecha: new Date(),
        },
      ];

      mockPrismaService.movimientoKardex.findMany.mockResolvedValue(
        mockMovimientos,
      );

      const result = await service.calcularStockActual(1, 1);

      expect(result).toBe(85);
    });

    it('debería retornar stock del producto si no hay movimientos', async () => {
      const mockProducto = {
        stock: 100,
      };

      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([]);
      mockPrismaService.producto.findUnique.mockResolvedValue(mockProducto);

      const result = await service.calcularStockActual(1, 1);

      expect(result).toBe(100);
    });
  });

  describe('validarConsistenciaStock', () => {
    it('debería detectar inconsistencias en el stock', async () => {
      const mockProductos = [
        {
          id: 1,
          codigo: 'PROD001',
          descripcion: 'Producto 1',
          stock: 100,
        },
        {
          id: 2,
          codigo: 'PROD002',
          descripcion: 'Producto 2',
          stock: 50,
        },
      ];

      mockPrismaService.producto.findMany.mockResolvedValue(mockProductos);

      // Mock para calcularStockActual
      jest
        .spyOn(service, 'calcularStockActual')
        .mockResolvedValueOnce(95) // Producto 1: inconsistencia
        .mockResolvedValueOnce(50); // Producto 2: consistente

      const result = await service.validarConsistenciaStock(1);

      expect(result.productosRevisados).toBe(2);
      expect(result.inconsistenciasEncontradas).toBe(1);
      expect(result.inconsistencias).toHaveLength(1);
      expect(result.inconsistencias[0]).toEqual({
        productoId: 1,
        codigo: 'PROD001',
        descripcion: 'Producto 1',
        stockSistema: 100,
        stockCalculado: 95,
        diferencia: 5,
      });
    });
  });
});
