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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    detalleComprobante: { deleteMany: jest.fn() },
    leyenda: { deleteMany: jest.fn() },
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
    // Anular una venta borra además sus comisiones PENDIENTES (las ya pagadas
    // no se tocan): sin esta tabla en el mock, anularComprobante reventaba
    // antes de llegar a lo que estas pruebas verifican.
    comisionVendedor: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    movimientoKardex: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    },
    movimientoKardexLote: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    sede: {
      findFirst: jest.fn().mockResolvedValue({ id: 1 }),
    },
    // Costo de la sede: lo que se devuelve vuelve a ese costo, no al global.
    productoStock: {
      findUnique: jest.fn().mockResolvedValue(null),
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
        {
          provide: InventarioNotificacionesService,
          useValue: { verificarStockBajo: jest.fn() },
        },
        {
          provide: S3Service,
          useValue: { uploadFile: jest.fn(), deleteFile: jest.fn() },
        },
        {
          provide: PdfGeneratorService,
          useValue: { generarComprobante: jest.fn(), generarTicket: jest.fn() },
        },
        {
          provide: ProductoLoteService,
          useValue: {
            descontarLoteFEFO: jest.fn(),
            revertirLote: jest.fn(),
            aumentarStockLote: jest.fn(),
          },
        },
        {
          provide: EnviarSunatService,
          useValue: {
            enviarComprobante: jest.fn(),
            anularEnSunat: jest.fn(),
            registrarComisionesAlAceptar: jest.fn(),
          },
        },
        {
          provide: ComisionesService,
          useValue: { registrarComision: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ComprobanteService>(ComprobanteService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Los mockResolvedValueOnce sin consumir no pasan a la prueba siguiente.
    mockPrismaService.comprobante.findUnique.mockReset();
    mockPrismaService.comprobante.findFirst.mockReset();
    mockPrismaService.motivoNota.findUnique.mockReset();
    // Restore defaults after clear
    mockPrismaService.pago.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaService.comisionVendedor.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaService.movimientoKardex.findMany.mockResolvedValue([]);
    mockPrismaService.movimientoKardexLote.findMany.mockResolvedValue([]);
    mockPrismaService.sede.findFirst.mockResolvedValue({ id: 1 });
    mockKardexService.registrarMovimiento.mockResolvedValue({ id: 999 });
  });

  describe('anularComprobante', () => {
    it('debería borrar las comisiones PENDIENTES del vendedor (las pagadas no)', async () => {
      const mockComprobante = {
        id: 1,
        tipoDoc: '01',
        estadoEnvioSunat: 'PENDIENTE',
        empresaId: 5,
        detalles: [
          { id: 1, productoId: 100, cantidad: 5, descripcion: 'Producto A' },
        ],
      };
      mockPrismaService.comprobante.findUnique.mockResolvedValue(mockComprobante);
      mockPrismaService.producto.findUnique.mockResolvedValue({
        id: 100,
        stock: 10,
        costoPromedio: 20,
      });
      mockPrismaService.comprobante.update.mockResolvedValue(mockComprobante);
      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { id: 501, productoId: 100, sedeId: 1, tipoMovimiento: 'SALIDA' },
      ]);

      await service.anularComprobante(1);

      // Una venta anulada no puede seguir generando comisión (inflaba los
      // reportes). Lo ya PAGADO no se toca: descuadraría pagos hechos.
      expect(mockPrismaService.comisionVendedor.deleteMany).toHaveBeenCalledWith({
        where: { comprobanteId: 1, estado: 'PENDIENTE' },
      });
    });

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

      mockPrismaService.comprobante.findUnique.mockResolvedValue(
        mockComprobante,
      );
      mockPrismaService.producto.findUnique
        .mockResolvedValueOnce({ id: 100, stock: 10, costoPromedio: 20 })
        .mockResolvedValueOnce({ id: 101, stock: 20, costoPromedio: 15 });
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
      });

      // Un comprobante que descontó stock tiene movimientos SALIDA en kardex;
      // revertirStock solo revierte cuando existen.
      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { id: 501, productoId: 100, sedeId: 1, tipoMovimiento: 'SALIDA' },
        { id: 502, productoId: 101, sedeId: 1, tipoMovimiento: 'SALIDA' },
      ]);

      await service.anularComprobante(1);

      // Kardex service es el que ahora maneja el stock (no prisma.produto.update directo)
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledTimes(2);
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({
          productoId: 100,
          tipoMovimiento: 'INGRESO',
          cantidad: 5,
        }),
      );
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({
          productoId: 101,
          tipoMovimiento: 'INGRESO',
          cantidad: 3,
        }),
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

      mockPrismaService.comprobante.findUnique.mockResolvedValue(
        mockComprobante,
      );
      mockPrismaService.producto.findUnique.mockResolvedValue({
        id: 102,
        stock: 5,
        costoPromedio: 10,
      });
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
        estadoPago: 'ANULADO',
        saldo: 0,
      });

      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { id: 503, productoId: 102, sedeId: 1, tipoMovimiento: 'SALIDA' },
      ]);

      await service.anularComprobante(2);

      // Stock revertido vía kardexService
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({
          productoId: 102,
          tipoMovimiento: 'INGRESO',
          cantidad: 2,
        }),
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

      mockPrismaService.comprobante.findUnique.mockResolvedValue(
        mockComprobante,
      );
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
          {
            id: 5,
            productoId: 999,
            cantidad: 1,
            descripcion: 'Producto inexistente',
          },
        ],
      };

      mockPrismaService.comprobante.findUnique.mockResolvedValue(
        mockComprobante,
      );
      mockPrismaService.producto.findUnique.mockResolvedValue(null);
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
      });

      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { id: 505, productoId: 999, sedeId: 1, tipoMovimiento: 'SALIDA' },
      ]);

      await service.anularComprobante(4);

      // Produto no existe, kardex (registrarMovimiento) no se llama
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

    it('devuelve el stock al costo de la sede, no al global', async () => {
      // QA: anular una venta en la sede que costaba S/50 la dejaba a S/10
      // (el global, mezcla de sedes).
      mockPrismaService.comprobante.findUnique.mockResolvedValue({
        id: 8,
        tipoDoc: 'NV',
        estadoEnvioSunat: 'NO_APLICA',
        empresaId: 5,
        detalles: [{ id: 1, productoId: 100, cantidad: 2 }],
      });
      mockPrismaService.producto.findUnique.mockResolvedValue({
        id: 100,
        stock: 5,
        costoPromedio: 10,
      });
      mockPrismaService.comprobante.update.mockResolvedValue({ id: 8 });
      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { id: 600, productoId: 100, sedeId: 18, tipoMovimiento: 'SALIDA' },
      ]);
      mockPrismaService.productoStock.findUnique.mockResolvedValueOnce({
        costoPromedio: 50,
      });

      await service.anularComprobante(8);

      expect(mockPrismaService.productoStock.findUnique).toHaveBeenCalledWith({
        where: { productoId_sedeId: { productoId: 100, sedeId: 18 } },
        select: { costoPromedio: true },
      });
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({
          tipoMovimiento: 'INGRESO',
          sedeId: 18,
          costoUnitario: 50,
        }),
      );
    });

    it('no vuelve a devolver stock si el comprobante ya estaba anulado', async () => {
      // QA: una NV de 5 anulada dos veces dejaba +10 en el stock.
      mockPrismaService.comprobante.findUnique.mockResolvedValue({
        id: 7,
        tipoDoc: 'NV',
        estadoEnvioSunat: 'ANULADO',
        estadoPago: 'ANULADO',
        empresaId: 5,
        detalles: [{ id: 1, productoId: 100, cantidad: 5 }],
      });
      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { id: 501, productoId: 100, sedeId: 1, tipoMovimiento: 'SALIDA' },
      ]);

      await expect(service.anularComprobante(7)).rejects.toThrow(
        'ya está anulado',
      );
      expect(mockKardexService.registrarMovimiento).not.toHaveBeenCalled();
      expect(mockPrismaService.comprobante.update).not.toHaveBeenCalled();
    });

    it('dos anulaciones simultáneas devuelven el stock una sola vez', async () => {
      // Las dos leen el comprobante sin anular; solo una gana el reclamo.
      mockPrismaService.comprobante.findUnique.mockResolvedValue({
        id: 9,
        tipoDoc: 'NV',
        estadoEnvioSunat: 'NO_APLICA',
        empresaId: 5,
        detalles: [{ id: 1, productoId: 100, cantidad: 3 }],
      });
      mockPrismaService.producto.findUnique.mockResolvedValue({ id: 100, stock: 7, costoPromedio: 1 });
      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { id: 700, productoId: 100, sedeId: 1, tipoMovimiento: 'SALIDA' },
      ]);
      mockPrismaService.comprobante.update.mockResolvedValue({ id: 9 });
      mockPrismaService.comprobante.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const r = await Promise.allSettled([
        service.anularComprobante(9),
        service.anularComprobante(9),
      ]);

      expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledTimes(1);
    });

    it('debería lanzar NotFoundException si el comprobante no existe', async () => {
      mockPrismaService.comprobante.findUnique.mockResolvedValue(null);

      await expect(service.anularComprobante(999)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.anularComprobante(999)).rejects.toThrow(
        'Comprobante no encontrado',
      );
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

      mockPrismaService.comprobante.findUnique.mockResolvedValue(
        mockComprobante,
      );
      mockPrismaService.producto.findUnique.mockResolvedValue({
        id: 200,
        stock: 10,
        costoPromedio: 25,
      });
      mockPrismaService.comprobante.update.mockResolvedValue({
        ...mockComprobante,
        estadoEnvioSunat: 'ANULADO',
        estadoPago: 'ANULADO',
        saldo: 0,
      });
      mockPrismaService.pago.deleteMany.mockResolvedValue({ count: 2 });

      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { id: 504, productoId: 200, sedeId: 1, tipoMovimiento: 'SALIDA' },
      ]);

      await service.anularComprobante(10);

      // Stock revertido vía kardexService
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({
          productoId: 200,
          tipoMovimiento: 'INGRESO',
          cantidad: 3,
          empresaId: 7,
        }),
      );

      // Pagos eliminados — punto clave del fix
      expect(mockPrismaService.pago.deleteMany).toHaveBeenCalledWith({
        where: { comprobanteId: 10 },
      });

      // Comprobante informal actualizado
      expect(mockPrismaService.comprobante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({
            estadoEnvioSunat: 'ANULADO',
            estadoPago: 'ANULADO',
            saldo: 0,
          }),
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

      mockPrismaService.comprobante.findUnique.mockResolvedValue(
        mockComprobante,
      );
      mockPrismaService.producto.findUnique.mockResolvedValue({
        id: 201,
        stock: 5,
        costoPromedio: 0,
      });
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

  /**
   * Borrado de un comprobante que SUNAT rechazó por datos (al emitir o en el
   * reintento automático). TIENDA MINERA, 26-10: el stock quedó 6 unidades por
   * encima sin una sola fila en el kardex que lo explicara.
   */
  describe('eliminarComprobante (rechazo fatal de SUNAT)', () => {
    const nota = {
      id: 50,
      empresaId: 88,
      tipoDoc: '07',
      serie: 'FC01',
      correlativo: 1,
      numDocAfectado: 'F0A1-3',
      motivoId: 1,
      detalles: [{ productoId: 7, cantidad: 2 }],
    };

    it('una nota de crédito: quita el stock que devolvió y la factura vuelve a estar vigente', async () => {
      mockPrismaService.comprobante.findUnique
        .mockResolvedValueOnce(nota)
        .mockResolvedValueOnce({ id: 20, detalles: [] });
      mockPrismaService.motivoNota.findUnique.mockResolvedValue({ codigo: '01' });
      mockPrismaService.comprobante.findFirst.mockResolvedValue({
        id: 20,
        serie: 'F0A1',
        correlativo: 3,
        mtoImpVenta: 100,
      });
      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { productoId: 7, cantidad: 2, sedeId: 117, costoUnitario: 10 },
      ]);

      await service.eliminarComprobante(50);

      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledTimes(1);
      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({
          productoId: 7,
          tipoMovimiento: 'SALIDA',
          cantidad: 2,
          sedeId: 117,
          comprobanteId: 50,
        }),
      );
      expect(mockPrismaService.comprobante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 20 },
          data: expect.objectContaining({ estadoEnvioSunat: 'EMITIDO' }),
        }),
      );
      expect(mockPrismaService.movimientoKardex.deleteMany).toHaveBeenCalledWith({
        where: { comprobanteId: 50 },
      });
      expect(mockPrismaService.comprobante.delete).toHaveBeenCalledWith({ where: { id: 50 } });
    });

    it('una boleta: devuelve el stock que descontó', async () => {
      mockPrismaService.comprobante.findUnique.mockResolvedValueOnce({
        ...nota,
        tipoDoc: '03',
        serie: 'B0A1',
        numDocAfectado: null,
        motivoId: null,
      });
      mockPrismaService.movimientoKardex.findMany.mockResolvedValue([
        { id: 1, productoId: 7, sedeId: 117, tipoMovimiento: 'SALIDA' },
      ]);
      mockPrismaService.producto.findUnique.mockResolvedValue({
        stock: 5,
        costoPromedio: 10,
        atributosTecnicos: null,
      });

      await service.eliminarComprobante(50);

      expect(mockKardexService.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({ productoId: 7, tipoMovimiento: 'INGRESO', cantidad: 2 }),
      );
      expect(mockPrismaService.motivoNota.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.comprobante.delete).toHaveBeenCalledWith({ where: { id: 50 } });
    });
  });
});
