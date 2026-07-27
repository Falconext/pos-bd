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
import { BadRequestException } from '@nestjs/common';

const FACTURA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F001-123</cbc:ID>
  <cbc:IssueDate>2026-07-01</cbc:IssueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6">20123456789</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>CLIENTE DEMO SAC</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount>18.00</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount>100.00</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount>118.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount>118.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:InvoicedQuantity unitCode="NIU">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>100.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount>18.00</cbc:TaxAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>PRODUCTO X</cbc:Description>
      <cac:SellersItemIdentification>
        <cbc:ID>P001</cbc:ID>
      </cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount>50.00</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

describe('ComprobanteService - Importar comprobantes emitidos', () => {
  let service: ComprobanteService;

  const mockPrismaService = {
    comprobante: { findFirst: jest.fn(), create: jest.fn() },
    cliente: { findFirst: jest.fn() },
    producto: { findFirst: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComprobanteService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: KardexService, useValue: {} },
        {
          provide: InventarioNotificacionesService,
          useValue: { verificarStockBajo: jest.fn() },
        },
        { provide: S3Service, useValue: {} },
        { provide: PdfGeneratorService, useValue: {} },
        { provide: ProductoLoteService, useValue: {} },
        { provide: EnviarSunatService, useValue: {} },
        { provide: ComisionesService, useValue: {} },
      ],
    }).compile();

    service = module.get<ComprobanteService>(ComprobanteService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('parseXmlVenta', () => {
    it('extrae cabecera, cliente, detalles y totales de una Factura', async () => {
      // Cliente no registrado en DB → usa el nombre del XML.
      mockPrismaService.cliente.findFirst.mockResolvedValue(null);
      // Producto vinculado por código P001.
      mockPrismaService.producto.findFirst.mockResolvedValue({
        id: 55,
        descripcion: 'Producto X interno',
      });

      const result = await service.parseXmlVenta(
        7,
        Buffer.from(FACTURA_XML, 'utf-8'),
      );

      expect(result.tipoDoc).toBe('01');
      expect(result.serie).toBe('F001');
      expect(result.correlativo).toBe(123);
      expect(result.fechaEmision).toBe('2026-07-01');
      expect(result.tipoMoneda).toBe('PEN');
      expect(result.cliente.numDoc).toBe('20123456789');
      expect(result.cliente.tipoDoc).toBe('6');
      expect(result.clienteName).toBe('CLIENTE DEMO SAC');
      expect(result.totales).toEqual({
        valorVenta: 100,
        mtoIGV: 18,
        mtoImpVenta: 118,
      });
      expect(result.detalles).toHaveLength(1);
      const linea = result.detalles[0];
      expect(linea.productoId).toBe(55);
      expect(linea.cantidad).toBe(2);
      // Precio de venta CON IGV por unidad = (100 + 18) / 2 = 59
      expect(linea.nuevoValorUnitario).toBe(59);
      expect(linea.tipoAfectacionIGV).toBe('10');
      expect(linea.unidadVenta).toBe('NIU');
    });

    it('usa el cliente registrado cuando existe en la empresa', async () => {
      mockPrismaService.cliente.findFirst.mockResolvedValue({
        id: 9,
        nombre: 'CLIENTE REGISTRADO EIRL',
      });
      mockPrismaService.producto.findFirst.mockResolvedValue(null);

      const result = await service.parseXmlVenta(
        7,
        Buffer.from(FACTURA_XML, 'utf-8'),
      );

      expect(result.cliente.clienteId).toBe(9);
      expect(result.clienteName).toBe('CLIENTE REGISTRADO EIRL');
      // Sin match de producto → línea libre (productoId null) con descripción.
      expect(result.detalles[0].productoId).toBeNull();
      expect(result.detalles[0].descripcion).toBe('PRODUCTO X');
    });

    it('rechaza XML que no sea Factura ni Boleta', async () => {
      const ncXml = FACTURA_XML.replace(
        '<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>',
        '<cbc:InvoiceTypeCode>07</cbc:InvoiceTypeCode>',
      );
      await expect(
        service.parseXmlVenta(7, Buffer.from(ncXml, 'utf-8')),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un archivo que no es XML válido', async () => {
      await expect(
        service.parseXmlVenta(7, Buffer.from('no soy xml', 'utf-8')),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('crearFormal en modo importado', () => {
    it('rechaza importar tipos distintos de Factura/Boleta (ej. nota de crédito)', async () => {
      await expect(
        service.crearFormal({}, 7, '07', 1, undefined, { importado: true }),
      ).rejects.toThrow(
        'La importación de comprobantes emitidos solo admite Facturas (01) y Boletas (03).',
      );
    });
  });
});
