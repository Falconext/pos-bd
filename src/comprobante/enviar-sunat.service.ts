import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { numeroALetras } from './utils/numero-a-letras';
import axios from 'axios';
import { QpseClient, QpseSendResponse } from '../common/utils/qpse.client';
import { buildUblXml } from '../common/utils/ubl-xml';

/**
 * Error de datos: el payload no pudo armarse por datos incorrectos del comprobante.
 * A diferencia de errores de red, este tipo NO debe reintentarse —
 * el comprobante debe eliminarse para que el usuario corrija y reintente.
 */
export class SunatPayloadException extends Error {
  readonly isPayloadError = true;
  constructor(message: string) {
    super(message);
    this.name = 'SunatPayloadException';
  }
}


// Catálogo 51 SUNAT — códigos de tipo de operación válidos
const VALID_TIPO_OPERACION_CODES = new Set([
  '0101', // Venta interna
  '0102', // Exportación
  '0112', // Venta interna - Anticipos
  '0113', // Exportación - Anticipos
  '0121', // Venta interna sujeta a IVAP
  '0200', // Exportación de servicios - Prestación de servicios realizados en el país
  '0201', // Exportación de servicios - Prestación de servicios realizados íntegramente en el extranjero
  '0202', // Exportación de servicios - Servicios de hospedaje no domiciliados
  '0205', // Exportación de servicios - Servicios a naves y aeronaves de bandera extranjera
  '0206', // Exportación de servicios - Servicios complementarios al transporte de carga
  '0401', // Operaciones sujetas a detracción
]);

@Injectable()
export class EnviarSunatService {
  private readonly logger = new Logger(EnviarSunatService.name);
  private readonly maxRetries = 12;       // 12 intentos × 5s = 60s máximo esperando SUNAT
  private readonly retryInterval = 5000;

  // Casuística 1: Error de DATOS — SUNAT/QPSE rechaza explícitamente (XML inválido, RUC incorrecto, etc.)
  // Máx 5 intentos con backoff corto → luego RECHAZADO definitivo
  private readonly MAX_DATA_ERROR_RETRIES = 5;

  // Casuística 2: Error de RED — SUNAT caída, timeout, QPSE no disponible
  // Máx 30 intentos (~30 días con backoff de 24h) → el usuario puede eliminar manualmente si quiere
  private readonly MAX_INFRA_ERROR_RETRIES = 30;

  // Kept for backward compatibility reference only
  private readonly maxRetryAttempts = 10;
  private readonly maxRetryHours = 5;

  // Debug: Set to true to simulate SUNAT failure for testing
  public simulateSunatFailure = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly qpseClient: QpseClient,
  ) { }

  async execute(comprobanteId: number) {
    const comp = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      include: {
        cliente: { include: { tipoDocumento: true } },
        empresa: { include: { ubicacion: true, rubro: true } },
        detalles: { include: { producto: { select: { codigo: true } } } },
        leyendas: true,
        tipoOperacion: true,
        motivo: true,
        tipoDetraccion: true,
        medioPagoDetraccion: true,
      },
    });
    if (!comp) throw new HttpException('Comprobante no encontrado', 404);

    const empresa = await (this.prisma.empresa as any).findUnique({
      where: { id: comp.empresaId },
      select: { ruc: true, usuarioPse: true, contrasenaPse: true },
    }) as { ruc: string | null; usuarioPse: string | null; contrasenaPse: string | null } | null;
    const qpseUsername = empresa?.usuarioPse;
    const qpsePassword = empresa?.contrasenaPse;
    if (!qpseUsername || !qpsePassword) {
      throw new HttpException(
        'Credenciales QPSE no configuradas. Configure usuarioPse y contrasenaPse en la empresa.',
        400,
      );
    }

    function limpiarTexto(texto: string): string {
      return texto
        .replace(/[\x00-\x1F\x7F]/g, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    }

    function formatPeruDateTime(dateIso: string | Date) {
      const d = new Date(dateIso);
      // Ajustar a -05:00 restando 5 horas
      const peruMs = d.getTime() - 5 * 60 * 60 * 1000;
      const peru = new Date(peruMs);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const yyyy = peru.getUTCFullYear();
      const mm = pad(peru.getUTCMonth() + 1);
      const dd = pad(peru.getUTCDate());
      const HH = pad(peru.getUTCHours());
      const MM = pad(peru.getUTCMinutes());
      const SS = pad(peru.getUTCSeconds());
      return { date: `${yyyy}-${mm}-${dd}`, time: `${HH}:${MM}:${SS}` };
    }

    let payload: any;
    try {
      const paddedCorrelativo = comp.correlativo.toString().padStart(8, '0');
      const fileName = `${empresa!.ruc}-${comp.tipoDoc}-${comp.serie}-${paddedCorrelativo}`;

      const paddedCorrelativoAfec = comp.numDocAfectado
        ?.split('-')[1]
        ?.padStart(8, '0');
      const docAfect = comp.numDocAfectado
        ?.split('-')[0]
        ?.concat(`-${paddedCorrelativoAfec}`);

      const { date: issueDate, time: issueTime } = formatPeruDateTime(
        comp.fechaEmision as any,
      );

      // Normalize Catálogo 51 listID — unknown/null codes always fall back to '0101'
      const rawCodigo = comp.tipoOperacion?.codigo;
      const tipoOperacionListID = (rawCodigo && VALID_TIPO_OPERACION_CODES.has(rawCodigo))
        ? rawCodigo
        : '0101';

      // Validate early: Boleta (03) only allows 0101 (Venta Interna)
      if (comp.tipoDoc === '03' && tipoOperacionListID !== '0101') {
        throw new SunatPayloadException(
          `Tipo de operación (Catálogo 51) inválido para Boleta: ${tipoOperacionListID}. Debe ser 0101 (Venta Interna).`,
        );
      }

      payload = {
        fileName,
        documentBody: {
          'cbc:UBLVersionID': { _text: '2.1' },
          'cbc:CustomizationID': { _text: '2.0' },
          'cbc:ID': { _text: `${comp.serie}-${paddedCorrelativo}` },
          'cbc:IssueDate': { _text: issueDate },
          'cbc:IssueTime': { _text: issueTime },
          'cbc:InvoiceTypeCode': {
            _attributes: {
              listID: tipoOperacionListID,
            },
            _text: comp.tipoDoc,
          },
          // cbc:Note DEBE ir antes de cbc:DocumentCurrencyCode (UBL 2.1 SUNAT schema)
          'cbc:Note': [
            ...comp.leyendas.map((l: any) => ({
              _text: l.value,
              _attributes: { languageLocaleID: '1000' },
            })),
            ...(comp.tipoDetraccionId ? [{
              _text: 'OPERACIÓN SUJETA A DETRACCIÓN',
              _attributes: { languageLocaleID: '2006' },
            }] : []),
            ...(!comp.tipoDetraccionId && comp.montoDetraccion && comp.porcentajeDetraccion ? [{
              _text: 'OPERACIÓN SUJETA A RETENCIÓN DEL 3%',
              _attributes: { languageLocaleID: '2006' },
            }] : [])
          ],
          'cbc:DocumentCurrencyCode': { _text: comp.tipoMoneda },
          // Placeholders en el orden exacto UBL 2.1 SUNAT.
          // Las asignaciones posteriores actualizan la key en su posición original.
          'cac:Signature': null,
          'cac:AccountingSupplierParty': {
            'cac:Party': {
              'cac:PartyIdentification': {
                'cbc:ID': {
                  _attributes: { schemeID: '6' },
                  _text: empresa!.ruc,
                },
              },
              'cac:PartyName': {
                'cbc:Name': {
                  _text: (comp.empresa as any).nombreComercial || '',
                },
              },
              'cac:PartyLegalEntity': {
                'cbc:RegistrationName': { _text: comp.empresa.razonSocial },
                'cac:RegistrationAddress': {
                  'cbc:AddressTypeCode': { _text: '0000' },
                  'cac:AddressLine': {
                    'cbc:Line': {
                      _text:
                        comp.empresa.direccion ||
                        `${(comp.empresa as any)?.direccion || ''} ${(comp.empresa as any)?.provincia || ''} ${(comp.empresa as any)?.departamento || ''} ${(comp.empresa as any)?.distrito || ''}`,
                    },
                  },
                },
              },
            },
          },
          'cac:AccountingCustomerParty': {
            'cac:Party': {
              'cac:PartyIdentification': {
                'cbc:ID': {
                  _attributes: {
                    schemeID:
                      comp.cliente.tipoDocumento!.codigo === '1' ? '1' : '6',
                  },
                  _text: comp.cliente.nroDoc,
                },
              },
              'cac:PartyLegalEntity': {
                'cbc:RegistrationName': { _text: comp.cliente.nombre },
                'cac:RegistrationAddress': {
                  'cac:AddressLine': {
                    'cbc:Line': {
                      _text:
                        comp.cliente.direccion?.trim() ||
                        [
                          comp.cliente.departamento,
                          comp.cliente.provincia,
                          comp.cliente.distrito,
                        ]
                          .filter(Boolean)
                          .join(' ')
                          .trim() ||
                        '',
                    },
                  },
                },
              },
            },
          },
          // UBL 2.1: PaymentMeans → PaymentTerms → AllowanceCharge → BillingReference
          //           → DiscrepancyResponse deben ir ANTES de TaxTotal
          'cac:PaymentMeans': null,
          'cac:PaymentTerms': null,
          'cac:AllowanceCharge': null,
          'cac:BillingReference': null,
          'cac:DiscrepancyResponse': null,
          'cac:TaxTotal': {
            'cbc:TaxAmount': {
              _attributes: { currencyID: comp.tipoMoneda },
              _text: comp.totalImpuestos,
            },
            'cac:TaxSubtotal': [
              {
                'cbc:TaxableAmount': {
                  _attributes: { currencyID: comp.tipoMoneda },
                  _text: comp.mtoOperGravadas,
                },
                'cbc:TaxAmount': {
                  _attributes: { currencyID: comp.tipoMoneda },
                  _text: comp.mtoIGV,
                },
                'cac:TaxCategory': {
                  'cac:TaxScheme': {
                    'cbc:ID': { _text: '1000' },
                    'cbc:Name': { _text: 'IGV' },
                    'cbc:TaxTypeCode': { _text: 'VAT' },
                  },
                },
              },
            ],
          },
          'cac:LegalMonetaryTotal': {
            'cbc:LineExtensionAmount': {
              _attributes: { currencyID: comp.tipoMoneda },
              _text: comp.valorVenta,
            },
            'cbc:TaxInclusiveAmount': {
              _attributes: { currencyID: comp.tipoMoneda },
              _text: comp.mtoImpVenta,
            },
            'cbc:PayableAmount': {
              _attributes: { currencyID: comp.tipoMoneda },
              _text: comp.mtoImpVenta,
            },
          },
          'cac:InvoiceLine': comp.detalles.map((d: any, index: number) => ({
            'cbc:ID': { _text: (index + 1).toString() },
            'cbc:InvoicedQuantity': {
              _attributes: { unitCode: d.unidad || 'NIU' },
              _text: d.cantidad,
            },
            'cbc:LineExtensionAmount': {
              _attributes: { currencyID: comp.tipoMoneda },
              _text: d.mtoValorVenta,
            },
            'cac:PricingReference': {
              'cac:AlternativeConditionPrice': {
                'cbc:PriceAmount': {
                  _attributes: { currencyID: comp.tipoMoneda },
                  _text: d.mtoPrecioUnitario || d.mtoValorUnitario,
                },
                'cbc:PriceTypeCode': { _text: '01' },
              },
            },
            'cac:TaxTotal': {
              'cbc:TaxAmount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: d.igv,
              },
              'cac:TaxSubtotal': [
                {
                  'cbc:TaxableAmount': {
                    _attributes: { currencyID: comp.tipoMoneda },
                    _text: d.mtoBaseIgv,
                  },
                  'cbc:TaxAmount': {
                    _attributes: { currencyID: comp.tipoMoneda },
                    _text: d.igv,
                  },
                  'cac:TaxCategory': {
                    'cbc:Percent': { _text: d.porcentajeIgv || 18 },
                    'cbc:TaxExemptionReasonCode': {
                      _text: d.tipAfeIgv || '10',
                    },
                    'cac:TaxScheme': {
                      'cbc:ID': { _text: '1000' },
                      'cbc:Name': { _text: 'IGV' },
                      'cbc:TaxTypeCode': { _text: 'VAT' },
                    },
                  },
                },
              ],
            },
            'cac:Item': {
              'cbc:Description': { _text: limpiarTexto(d.descripcion) },
              'cac:SellersItemIdentification': {
                'cbc:ID': { _text: d.producto.codigo },
              },
            },
            'cac:Price': {
              'cbc:PriceAmount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: d.mtoValorUnitario,
              },
            },
          })),
        },
      };

      payload.documentBody['cac:Signature'] = {
        'cbc:ID': { _text: `SIG-${empresa!.ruc}` },
        'cac:SignatoryParty': {
          'cac:PartyIdentification': {
            'cbc:ID': { _text: empresa!.ruc },
          },
          'cac:PartyName': {
            'cbc:Name': { _text: comp.empresa.razonSocial },
          },
        },
        'cac:DigitalSignatureAttachment': {
          'cac:ExternalReference': {
            'cbc:URI': { _text: '#signatureQPSE' },
          },
        },
      };

      if (comp.tipoDoc === '01') {
        const paymentTerms: any[] = [];
        const esCredito = comp.formaPagoTipo?.toLowerCase() === 'credito';
        const cuotasData = comp.cuotas ? (Array.isArray(comp.cuotas) ? comp.cuotas : []) : [];

        // 1. Si hay detracción, agregar primero el bloque de detracción
        if (comp.tipoDetraccionId && comp.tipoDetraccion) {
          paymentTerms.push({
            'cbc:ID': { _text: 'Detraccion' },
            'cbc:PaymentMeansID': { _text: String(comp.tipoDetraccion.codigo).padStart(3, '0') },
            'cbc:PaymentPercent': { _text: comp.porcentajeDetraccion || 0 },
            'cbc:Amount': {
              _attributes: { currencyID: comp.tipoMoneda },
              _text: Number(Number(comp.montoDetraccion || 0).toFixed(2)),
            },
          });
        }

        // 2. Agregar FormaPago (Contado o Credito)
        if (esCredito && cuotasData.length > 0) {
          // CRÉDITO: Calcular monto a crédito (total - detracción)
          const montoACredito = Number((comp.mtoImpVenta - (comp.montoDetraccion || 0)).toFixed(2));
          paymentTerms.push({
            'cbc:ID': { _text: 'FormaPago' },
            'cbc:PaymentMeansID': { _text: 'Credito' },
            'cbc:Amount': {
              _attributes: { currencyID: comp.tipoMoneda },
              _text: montoACredito,
            },
          });

          // 3. Agregar cuotas individuales
          cuotasData.forEach((cuota: any, index: number) => {
            paymentTerms.push({
              'cbc:ID': { _text: 'FormaPago' },
              'cbc:PaymentMeansID': { _text: `Cuota${String(index + 1).padStart(3, '0')}` },
              'cbc:Amount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: Number(Number(cuota.monto).toFixed(2)),
              },
              'cbc:PaymentDueDate': { _text: String(cuota.fechaVencimiento).substring(0, 10) },
            });
          });
        } else {
          // CONTADO: Solo el bloque simple
          // Normalizar formaPagoTipo a formato SUNAT: "CONTADO" -> "Contado", "CREDITO" -> "Credito"
          const formaPagoNormalizado = comp.formaPagoTipo?.toLowerCase() === 'contado' ? 'Contado' :
            comp.formaPagoTipo?.toLowerCase() === 'credito' ? 'Credito' :
              'Contado';
          paymentTerms.push({
            'cbc:ID': { _text: 'FormaPago' },
            'cbc:PaymentMeansID': { _text: formaPagoNormalizado },
          });
        }

        payload.documentBody['cac:PaymentTerms'] = paymentTerms;

        // Si hay detracción, agregar PaymentMeans con cuenta bancaria
        if (comp.tipoDetraccionId && comp.cuentaBancoNacion) {
          payload.documentBody['cac:PaymentMeans'] = [
            {
              'cbc:ID': { _text: 'Detraccion' },
              'cbc:PaymentMeansCode': { _text: comp.medioPagoDetraccion?.codigo || '001' },
              'cac:PayeeFinancialAccount': {
                'cbc:ID': { _text: comp.cuentaBancoNacion },
              },
            },
          ];
        }
      } else if (comp.tipoDoc === '03') {
        payload.documentBody['cac:PaymentTerms'] = {
          'cbc:PaymentMeansID': { _text: comp.formaPagoTipo || 'Contado' },
          'cbc:PaymentDueDate': { _text: issueDate },
        };
      }

      // AllowanceCharge para Retención 3% — en posición correcta (antes de TaxTotal)
      if (!comp.tipoDetraccionId && comp.montoDetraccion && comp.porcentajeDetraccion) {
        payload.documentBody['cac:AllowanceCharge'] = [{
          'cbc:ChargeIndicator': { _text: 'false' },
          'cbc:AllowanceChargeReasonCode': { _text: '62' },
          'cbc:MultiplierFactorNumeric': { _text: Number((comp.porcentajeDetraccion / 100).toFixed(4)) },
          'cbc:Amount': {
            _attributes: { currencyID: comp.tipoMoneda },
            _text: Number(Number(comp.montoDetraccion).toFixed(2)),
          },
          'cbc:BaseAmount': {
            _attributes: { currencyID: comp.tipoMoneda },
            _text: comp.mtoImpVenta,
          },
        }];
      }

      if ((comp.tipoDoc === '07' || comp.tipoDoc === '08') && comp.motivo) {
        payload.documentBody['cac:BillingReference'] = {
          'cac:InvoiceDocumentReference': {
            'cbc:ID': { _text: docAfect },
            'cbc:DocumentTypeCode': { _text: comp.tipDocAfectado },
          },
        };
        payload.documentBody['cac:DiscrepancyResponse'] = {
          'cbc:ResponseCode': { _text: comp.motivo.codigo },
          'cbc:Description': { _text: comp.motivo.descripcion },
        };
      }

      if (comp.tipoDoc === '07') {
        delete payload.documentBody['cbc:InvoiceTypeCode'];
        payload.documentBody['cbc:CreditNoteTypeCode'] = {
          _attributes: { listID: '0101' },
          _text: '07', // Tipo de documento nota de crédito
        };

        // Convertir InvoiceLines a CreditNoteLines con estructura correcta
        payload.documentBody['cac:CreditNoteLine'] = comp.detalles.map(
          (d: any, index: number) => ({
            'cbc:ID': { _text: (index + 1).toString() },
            'cbc:CreditedQuantity': {
              _attributes: { unitCode: d.unidad || 'NIU' },
              _text: d.cantidad,
            },
            'cbc:LineExtensionAmount': {
              _attributes: { currencyID: comp.tipoMoneda },
              _text: d.mtoValorVenta,
            },
            'cac:PricingReference': {
              'cac:AlternativeConditionPrice': {
                'cbc:PriceAmount': {
                  _attributes: { currencyID: comp.tipoMoneda },
                  _text: d.mtoPrecioUnitario, // Precio CON IGV
                },
                'cbc:PriceTypeCode': { _text: '01' },
              },
            },
            'cac:TaxTotal': {
              'cbc:TaxAmount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: d.igv,
              },
              'cac:TaxSubtotal': [
                {
                  'cbc:TaxableAmount': {
                    _attributes: { currencyID: comp.tipoMoneda },
                    _text: d.mtoBaseIgv,
                  },
                  'cbc:TaxAmount': {
                    _attributes: { currencyID: comp.tipoMoneda },
                    _text: d.igv,
                  },
                  'cac:TaxCategory': {
                    'cbc:Percent': { _text: d.porcentajeIgv || 18 },
                    'cbc:TaxExemptionReasonCode': {
                      _text: d.tipAfeIgv || '10',
                    },
                    'cac:TaxScheme': {
                      'cbc:ID': { _text: '1000' },
                      'cbc:Name': { _text: 'IGV' },
                      'cbc:TaxTypeCode': { _text: 'VAT' },
                    },
                  },
                },
              ],
            },
            'cac:Item': {
              'cbc:Description': { _text: limpiarTexto(d.descripcion) },
            },
            'cac:Price': {
              'cbc:PriceAmount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: d.mtoValorUnitario,
              },
            },
          }),
        );

        // Sobrescribir Note como array para nota de crédito
        payload.documentBody['cbc:Note'] = [
          {
            _text: comp.leyendas[0]?.value || '',
            _attributes: { languageLocaleID: '1000' },
          },
        ];

        // Ajustar TaxTotal para nota de crédito (con array en TaxSubtotal)
        payload.documentBody['cac:TaxTotal'] = {
          'cbc:TaxAmount': {
            _attributes: { currencyID: comp.tipoMoneda },
            _text: comp.totalImpuestos,
          },
          'cac:TaxSubtotal': [
            {
              'cbc:TaxableAmount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: comp.mtoOperGravadas,
              },
              'cbc:TaxAmount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: comp.mtoIGV,
              },
              'cac:TaxCategory': {
                'cac:TaxScheme': {
                  'cbc:ID': { _text: '1000' },
                  'cbc:Name': { _text: 'IGV' },
                  'cbc:TaxTypeCode': { _text: 'VAT' },
                },
              },
            },
          ],
        };

        // Ajustar estructura monetaria para nota de crédito
        payload.documentBody['cac:LegalMonetaryTotal'] = {
          'cbc:PayableAmount': {
            _attributes: { currencyID: comp.tipoMoneda },
            _text: comp.mtoImpVenta,
          },
        };

        // Rebuild in correct CreditNote UBL 2.1 element order.
        // UBL 2.1 CreditNoteType sequence (OASIS + SUNAT Peru):
        //   pos 12: DiscrepancyResponse (0..n)  ← BEFORE BillingReference
        //   pos 14: BillingReference (0..n)     ← AFTER DiscrepancyResponse
        //   pos 23: Signature (0..n)            ← BEFORE AccountingSupplierParty
        //   pos 24: AccountingSupplierParty (1..1)
        //   pos 25: AccountingCustomerParty (1..1)
        const cn = payload.documentBody;
        payload.documentBody = {
          'cbc:UBLVersionID': cn['cbc:UBLVersionID'],
          'cbc:CustomizationID': cn['cbc:CustomizationID'],
          'cbc:ID': cn['cbc:ID'],
          'cbc:IssueDate': cn['cbc:IssueDate'],
          'cbc:IssueTime': cn['cbc:IssueTime'],
          'cbc:CreditNoteTypeCode': cn['cbc:CreditNoteTypeCode'],
          'cbc:Note': cn['cbc:Note'],
          'cbc:DocumentCurrencyCode': cn['cbc:DocumentCurrencyCode'],
          'cac:DiscrepancyResponse': cn['cac:DiscrepancyResponse'],
          'cac:BillingReference': cn['cac:BillingReference'],
          'cac:Signature': cn['cac:Signature'],
          'cac:AccountingSupplierParty': cn['cac:AccountingSupplierParty'],
          'cac:AccountingCustomerParty': cn['cac:AccountingCustomerParty'],
          'cac:AllowanceCharge': cn['cac:AllowanceCharge'],
          'cac:TaxTotal': cn['cac:TaxTotal'],
          'cac:LegalMonetaryTotal': cn['cac:LegalMonetaryTotal'],
          'cac:CreditNoteLine': cn['cac:CreditNoteLine'],
        };
      }
      if (comp.tipoDoc === '08') {
        const debitNoteTypeCode = {
          _attributes: { listID: '0101' },
          _text: '08',
        };
        const debitNoteLines = payload.documentBody['cac:InvoiceLine'];
        const requestedMonetaryTotal = {
          'cbc:PayableAmount': {
            _attributes: { currencyID: comp.tipoMoneda },
            _text: comp.mtoImpVenta,
          },
        };

        // Rebuild in correct DebitNote UBL 2.1 element order
        // Same sequence as CreditNote: DiscrepancyResponse → BillingReference → Signature → Parties
        const dn = payload.documentBody;
        payload.documentBody = {
          'cbc:UBLVersionID': dn['cbc:UBLVersionID'],
          'cbc:CustomizationID': dn['cbc:CustomizationID'],
          'cbc:ID': dn['cbc:ID'],
          'cbc:IssueDate': dn['cbc:IssueDate'],
          'cbc:IssueTime': dn['cbc:IssueTime'],
          'cbc:DebitNoteTypeCode': debitNoteTypeCode,
          'cbc:Note': dn['cbc:Note'],
          'cbc:DocumentCurrencyCode': dn['cbc:DocumentCurrencyCode'],
          'cac:DiscrepancyResponse': dn['cac:DiscrepancyResponse'],
          'cac:BillingReference': dn['cac:BillingReference'],
          'cac:Signature': dn['cac:Signature'],
          'cac:AccountingSupplierParty': dn['cac:AccountingSupplierParty'],
          'cac:AccountingCustomerParty': dn['cac:AccountingCustomerParty'],
          'cac:AllowanceCharge': dn['cac:AllowanceCharge'],
          'cac:TaxTotal': dn['cac:TaxTotal'],
          'cac:RequestedMonetaryTotal': requestedMonetaryTotal,
          'cac:DebitNoteLine': debitNoteLines,
        };
      }
    } catch (err: any) {
      throw new SunatPayloadException(
        `Los datos del comprobante no son válidos para SUNAT: ${err?.message || 'estructura incorrecta'}`,
      );
    }

    let finalResponse: any;
    try {
      console.log('🚀 Enviando comprobante a SUNAT:', {
        comprobanteId,
        tipoDoc: comp.tipoDoc,
        serie: comp.serie,
        correlativo: comp.correlativo,
      });

      // DEBUG: Simulate SUNAT failure for testing retry mechanism
      if (this.simulateSunatFailure) {
        console.log('⚠️ MODO SIMULACIÓN: Forzando error de SUNAT para pruebas');
        throw new Error('SIMULACIÓN: SUNAT no disponible');
      }

      const buildXmlArtifacts = (currentCorrelativo: number) => {
        const padded = currentCorrelativo.toString().padStart(8, '0');
        payload.fileName = `${empresa!.ruc}-${comp.tipoDoc}-${comp.serie}-${padded}`;
        payload.documentBody['cbc:ID'] = { _text: `${comp.serie}-${padded}` };

        const xmlFilename = payload.fileName;
        const xmlContent = buildUblXml(this.resolveUblRootName(comp.tipoDoc), payload.documentBody);

        if (['07', '08'].includes(comp.tipoDoc)) {
          console.log(`[XML-DEBUG tipoDoc=${comp.tipoDoc}] primeros 2000 chars:\n`, xmlContent.substring(0, 2000));
        }

        return {
          xmlFilename,
          xmlContent,
          xmlContentBase64: Buffer.from(xmlContent, 'utf8').toString('base64'),
        };
      };

      let xmlArtifacts = buildXmlArtifacts(comp.correlativo);
      const qpseAccess = await this.qpseClient.obtenerTokenAcceso({
        username: qpseUsername,
        password: qpsePassword,
      });
      const accessToken = qpseAccess.token_acceso;
      if (!accessToken) {
        throw new HttpException('No se pudo obtener el token de acceso de QPSE', 502);
      }

      let signResponse = await this.qpseClient.firmarXML({
        accessToken,
        xmlFilename: xmlArtifacts.xmlFilename,
        xmlContentBase64: xmlArtifacts.xmlContentBase64,
      });

      if (!signResponse.xml) {
        throw new HttpException('QPSE no devolvió el XML firmado', 502);
      }

      let signedXmlBase64 = signResponse.xml;
      let signedXmlContent = this.decodeBase64ToUtf8(signedXmlBase64);
      let initialResponse = await this.qpseClient.enviarXML({
        accessToken,
        xmlFilename: xmlArtifacts.xmlFilename,
        externalId: signResponse.external_id,
        xmlSignedBase64: signedXmlBase64,
      });

      if (this.isSunatNumeracionRepetida(initialResponse)) {
        console.warn(
          `⚠️ QPSE reportó numeración repetida (${comp.serie}-${comp.correlativo}). Buscando siguiente correlativo disponible...`,
        );

        const ultimoComp = await this.prisma.comprobante.findFirst({
          where: { empresaId: comp.empresaId, serie: comp.serie, tipoDoc: comp.tipoDoc },
          orderBy: { correlativo: 'desc' },
          select: { correlativo: true },
        });
        const nuevoCorrelativo = (ultimoComp?.correlativo ?? 0) + 1;

        await this.prisma.comprobante.update({
          where: { id: comprobanteId },
          data: { correlativo: nuevoCorrelativo },
        });

        comp.correlativo = nuevoCorrelativo;
        xmlArtifacts = buildXmlArtifacts(nuevoCorrelativo);
        signResponse = await this.qpseClient.firmarXML({
          accessToken,
          xmlFilename: xmlArtifacts.xmlFilename,
          xmlContentBase64: xmlArtifacts.xmlContentBase64,
        });

        if (!signResponse.xml) {
          throw new HttpException('QPSE no devolvió el XML firmado en el reintento', 502);
        }

        signedXmlBase64 = signResponse.xml;
        signedXmlContent = this.decodeBase64ToUtf8(signedXmlBase64);
        initialResponse = await this.qpseClient.enviarXML({
          accessToken,
          xmlFilename: xmlArtifacts.xmlFilename,
          externalId: signResponse.external_id,
          xmlSignedBase64: signedXmlBase64,
        });
      }

      finalResponse = initialResponse;

      const qpseTicket = initialResponse.ticket;
      const documentId = String(qpseTicket || xmlArtifacts.xmlFilename);
      let status = this.normalizeQpseStatus(initialResponse);

      await this.prisma.comprobante.update({
        where: { id: comprobanteId },
        data: {
          documentoId: documentId,
          estadoEnvioSunat: status === 'PENDIENTE' ? 'PENDIENTE' : 'RECHAZADO',
        },
      });

      // Solo Factura (01) y similares retornan ticket para polling asíncrono.
      // Boleta (03) es síncrona: la respuesta de enviarXML ya es definitiva.
      if (qpseTicket && status === 'PENDIENTE') {
        let retries = 0;
        console.log(`🔄 Estado inicial QPSE: ${status}, iniciando polling por ticket ${qpseTicket}...`);

        while (status === 'PENDIENTE' && retries < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.retryInterval));

          finalResponse = await this.qpseClient.consultarTicket(qpseTicket, accessToken);
          status = this.normalizeQpseStatus(finalResponse);
          retries++;

          console.log(`📊 Estado actual QPSE: ${status}`, {
            intento: retries,
            response: finalResponse,
          });
        }
      } else if (!qpseTicket) {
        console.log(`✅ QPSE respuesta síncrona (sin ticket): ${status}`);
      }

      let s3XmlUrl: string | null = null;
      let s3CdrUrl: string | null = null;
      if (this.s3Service.isEnabled()) {
        try {
          const xmlKey = this.s3Service.generateComprobanteKey(
            comp.empresaId,
            comp.tipoDoc,
            comp.serie,
            comp.correlativo,
            'xml',
          );
          s3XmlUrl = await this.s3Service.uploadXML(Buffer.from(signedXmlContent, 'utf8'), xmlKey);

          if (finalResponse?.cdr) {
            const cdrBuffer = this.decodeBase64ToBuffer(finalResponse.cdr);
            const cdrKey = this.buildCdrStorageKey(comp.empresaId, comp.tipoDoc, comp.serie, comp.correlativo, cdrBuffer);
            s3CdrUrl = cdrBuffer.toString('utf8').trim().startsWith('<')
              ? await this.s3Service.uploadXML(cdrBuffer, cdrKey)
              : await this.s3Service.uploadZIP(cdrBuffer, cdrKey);
          }
        } catch (storageError: any) {
          this.logger.warn(`No se pudo subir XML/CDR a S3: ${storageError.message}`);
        }
      }

      // Generar PDF personalizado del sistema y subir a S3
      let s3PdfUrl: string | null = null;

      if (this.s3Service.isEnabled() && status === 'ACEPTADO') {
        try {
          // Generar PDF personalizado del sistema
          const tipoDocMap: Record<string, string> = {
            '01': 'FACTURA',
            '03': 'BOLETA',
            '07': 'NOTA DE CRÉDITO',
            '08': 'NOTA DE DÉBITO',
          };

          const buildLogoDataUrl = (raw?: string | null): string | undefined => {
            if (!raw) return undefined;
            const t = raw.trim();
            if (t.startsWith('data:')) return t;
            if (/^https?:\/\//i.test(t) || t.startsWith('/')) return t;
            return `data:${t.startsWith('/9j/') ? 'image/jpeg' : 'image/png'};base64,${t}`;
          };

          const rawLogo = comp.empresa.logo || null;
          const logoDataUrl = buildLogoDataUrl(rawLogo);

          const fechaEmision = new Date(comp.fechaEmision);

          // Recuperar información de Lotes para el PDF (Lógica Robusta Backend)
          const movimientos = await this.prisma.movimientoKardex.findMany({
            where: {
              comprobanteId: comprobanteId,
              empresaId: comp.empresaId,
              tipoMovimiento: 'SALIDA',
            },
            select: {
              productoId: true,
              lote: true,
              fechaVencimiento: true,
              movimientoLote: {
                select: {
                  lote: { select: { lote: true, fechaVencimiento: true } },
                },
              },
            },
          });

          let hayLotes = false;
          const detallesPrevios = comp.detalles.map((det: any) => {
            const m = movimientos.find((mov) => mov.productoId === det.productoId);
            const lotesParsed: any[] = [];
            if (m) {
              if (m.movimientoLote?.lote) {
                lotesParsed.push({
                  lote: m.movimientoLote.lote.lote,
                  fechaVencimiento: m.movimientoLote.lote.fechaVencimiento
                    ? new Date(m.movimientoLote.lote.fechaVencimiento).toLocaleDateString('es-PE')
                    : '',
                });
              } else if (m.lote) {
                lotesParsed.push({
                  lote: m.lote,
                  fechaVencimiento: m.fechaVencimiento
                    ? new Date(m.fechaVencimiento).toLocaleDateString('es-PE')
                    : '',
                });
              }
            }
            if (lotesParsed.length > 0) hayLotes = true;
            return { ...det, lotes: lotesParsed };
          });

          const pdfData = {
            // Empresa
            nombreComercial: (comp.empresa.nombreComercial || comp.empresa.razonSocial).toUpperCase(),
            razonSocial: comp.empresa.razonSocial.toUpperCase(),
            ruc: comp.empresa.ruc,
            direccion: (comp.empresa.direccion || '').toUpperCase(),
            rubro: comp.empresa.rubro?.nombre?.toUpperCase() || 'VENTA DE MATERIALES DE CONSTRUCCIÓN',
            celular: '',
            email: '',
            logo: logoDataUrl,

            // Comprobante
            tipoDocumento: tipoDocMap[comp.tipoDoc] || 'COMPROBANTE',
            serie: comp.serie,
            correlativo: String(comp.correlativo).padStart(8, '0'),
            fecha: fechaEmision.toLocaleDateString('es-PE'),
            hora: fechaEmision.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) + ' p.m.',

            // Cliente
            clienteNombre: (comp.cliente.nombre || 'CLIENTES VARIOS').toUpperCase(),
            clienteTipoDoc: comp.cliente.tipoDocumento?.codigo === '6' ? 'RUC' : 'DNI',
            clienteNumDoc: comp.cliente.nroDoc || '',
            clienteDireccion: (comp.cliente.direccion || '-').toUpperCase(),

            // Productos
            productos: detallesPrevios.map((det: any) => ({
              cantidad: det.cantidad,
              unidadMedida: det.unidadMedida || 'NIU',
              descripcion: (det.descripcion || '').toUpperCase(),
              precioUnitario: Number(det.mtoPrecioUnitario || 0).toFixed(2),
              total: Number((det.mtoPrecioUnitario || 0) * det.cantidad).toFixed(2),
              lotes: det.lotes,
            })),
            mostrarLotes: hayLotes,

            // Totales
            mtoOperGravadas: Number(comp.mtoOperGravadas).toFixed(2),
            mtoIGV: Number(comp.mtoIGV).toFixed(2),
            mtoOperInafectas: comp.mtoOperInafectas > 0 ? Number(comp.mtoOperInafectas).toFixed(2) : undefined,
            mtoImpVenta: Number(comp.mtoImpVenta).toFixed(2),
            totalEnLetras: numeroALetras(comp.mtoImpVenta).toUpperCase(),

            // Otros
            formaPago: comp.formaPagoTipo === 'Contado' ? 'CONTADO' : 'CRÉDITO',
            medioPago: (comp.medioPago || 'EFECTIVO').toUpperCase(),
            observaciones: comp.observaciones ? comp.observaciones.toUpperCase() : undefined,
            qrCode: undefined,
            // Detracción
            tipoDetraccion: comp.tipoDetraccion
              ? `${comp.tipoDetraccion.codigo} - ${comp.tipoDetraccion.descripcion} (${comp.tipoDetraccion.porcentaje}%)`
              : undefined,
            montoDetraccion: comp.montoDetraccion ? Number(comp.montoDetraccion).toFixed(2) : undefined,
            cuentaBancoNacion: comp.cuentaBancoNacion || undefined,
            medioPagoDetraccion: comp.medioPagoDetraccion
              ? `${comp.medioPagoDetraccion.codigo} - ${comp.medioPagoDetraccion.descripcion}`
              : undefined,
          };

          const pdfBuffer = await this.pdfGenerator.generarPDFComprobante(pdfData);

          const pdfKey = this.s3Service.generateComprobanteKey(
            comp.empresaId,
            comp.tipoDoc,
            comp.serie,
            comp.correlativo,
            'pdf',
          );
          s3PdfUrl = await this.s3Service.uploadPDF(pdfBuffer, pdfKey);
          console.log(`📤 PDF personalizado subido a S3: ${s3PdfUrl}`);

        } catch (s3Error) {
          console.error('⚠️ Error subiendo archivos a S3:', s3Error.message);
          // No fallar el proceso si S3 falla, solo loguear
        }
      }

      if (status !== 'ACEPTADO') {
        console.error("❌ SUNAT Full Response:", JSON.stringify(finalResponse, null, 2));
      }

      // Mapear el estado de SUNAT al estado interno del comprobante
      const estadoFinal: string =
        status === 'ACEPTADO' ? 'EMITIDO' :
        status === 'PENDIENTE' ? 'PENDIENTE' :  // aún procesando → scheduler reintentará
        'RECHAZADO';                             // cualquier otro estado (ERROR, RECHAZADO, etc.)

      await this.prisma.comprobante.update({
        where: { id: comprobanteId },
        data: {
          estadoEnvioSunat: estadoFinal as any,
          sunatXml: signedXmlContent || null,
          sunatCdrZip: finalResponse.cdr || null,
          sunatCdrResponse: JSON.stringify(finalResponse),
          sunatErrorMsg:
            estadoFinal !== 'EMITIDO'
              ? this.extractQpseMessage(finalResponse, status)
              : null,
          s3PdfUrl,
          s3XmlUrl,
          s3CdrUrl,
        },
      });

      if (status === 'PENDIENTE') {
        console.log('⚠️ Documento queda PENDIENTE después del polling');
        return {
          status: 'PENDIENTE',
          documentId,
          message: this.extractQpseMessage(finalResponse, status) || 'El documento está pendiente de procesamiento por SUNAT.',
        };
      }

      if (status !== 'ACEPTADO') {
        console.error('❌ SUNAT rechazó el documento:', {
          status,
          error: finalResponse.error,
          fullResponse: finalResponse,
        });
        throw new HttpException(
          `QPSE rechazó el documento: ${this.extractQpseMessage(finalResponse, status) || 'Error desconocido'}`,
          502,
        );
      }

      console.log('✅ Documento ACEPTADO por SUNAT:', {
        status,
        documentId,
        cdr: finalResponse.cdr ? 'Recibido' : 'No recibido',
      });

      // Actualizar estado del comprobante afectado si es nota de crédito/débito
      await this.procesarEfectoEnComprobanteAfectado(comp, status);

      return finalResponse;
    } catch (err: any) {
      console.error('🚫 Error crítico enviando a SUNAT:', {
        comprobanteId,
        error: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });

      // Persist retry state based on error type:
      // - DATOS (SUNAT/QPSE rechazó explícitamente): máx 5 intentos → RECHAZADO
      // - RED (SUNAT caída, timeout, no disponible): máx 30 intentos con backoff hasta 24h
      try {
        const currentComp = await this.prisma.comprobante.findUnique({
          where: { id: comprobanteId },
          select: { sunatRetriesCount: true },
        });

        if (currentComp) {
          const newRetryCount = (currentComp.sunatRetriesCount || 0) + 1;
          const errorType = this.classifyError(err);
          const maxRetries = errorType === 'DATOS'
            ? this.MAX_DATA_ERROR_RETRIES
            : this.MAX_INFRA_ERROR_RETRIES;

          if (newRetryCount < maxRetries) {
            const nextRetry = errorType === 'DATOS'
              ? this.calculateNextRetry(newRetryCount)
              : this.calculateNetworkRetry(newRetryCount);

            await this.prisma.comprobante.update({
              where: { id: comprobanteId },
              data: {
                estadoEnvioSunat: 'FALLIDO_ENVIO',
                sunatRetriesCount: newRetryCount,
                sunatLastRetryAt: new Date(),
                sunatNextRetryAt: nextRetry,
                sunatErrorMsg: `[${errorType}] (intento ${newRetryCount}/${maxRetries}): ${err.message}`,
              },
            });
            console.log(`📅 Comprobante ${comprobanteId} → reintento #${newRetryCount} [${errorType}] en ${nextRetry.toISOString()}`);
          } else {
            await this.prisma.comprobante.update({
              where: { id: comprobanteId },
              data: {
                estadoEnvioSunat: 'RECHAZADO',
                sunatNextRetryAt: null,
                sunatErrorMsg: `[${errorType}] Fallido tras ${newRetryCount} intentos: ${err.message}`,
              },
            });
            console.log(`❌ Comprobante ${comprobanteId} → RECHAZADO (agotó ${maxRetries} reintentos [${errorType}])`);
          }
        }
      } catch (dbErr) {
        console.error('Error guardando estado de fallo:', dbErr);
      }

      throw new HttpException(
        `Error enviando a QPSE: ${err.response?.data?.message || err.message}`,
        502,
      );
    }
  }

  private resolveUblRootName(tipoDoc: string): 'Invoice' | 'CreditNote' | 'DebitNote' {
    if (tipoDoc === '07') return 'CreditNote';
    if (tipoDoc === '08') return 'DebitNote';
    return 'Invoice';
  }

  private normalizeQpseStatus(response: QpseSendResponse | null | undefined): 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' {
    const stateLabel = String(response?.state_label || '').toLowerCase();
    const code = String(response?.code ?? '');
    const estado = Number(response?.estado ?? -1);

    console.log(`[normalizeQpseStatus] raw response:`, JSON.stringify({
      sunat_success: response?.sunat_success,
      state_label: response?.state_label,
      code: response?.code,
      estado: response?.estado,
      success: (response as any)?.success,
      message: response?.message,
      mensaje: response?.mensaje,
    }));

    // Si hay errores de SUNAT (código 0306, etc.), es RECHAZADO independientemente de success HTTP
    const hasErrors = (Array.isArray(response?.errors) && response.errors.length > 0) ||
      (Array.isArray((response as any)?.errores) && (response as any).errores.length > 0);
    const hasErrorCode = code !== '' && code !== '0' && code !== 'null' && code !== 'undefined' && !/^2\d\d$/.test(code);

    if (hasErrors && hasErrorCode) {
      return 'RECHAZADO';
    }

    // QPSE state_label: 'aceptado', 'registrado', 'observado' = aceptado por SUNAT
    if (
      response?.sunat_success === true ||
      stateLabel === 'aceptado' ||
      stateLabel === 'registrado' ||
      stateLabel === 'observado' ||
      estado === 1 ||
      code === '0'
    ) {
      return 'ACEPTADO';
    }

    if (
      stateLabel === 'pendiente' ||
      stateLabel === 'en_proceso' ||
      stateLabel === 'en proceso' ||
      stateLabel === 'indeterminado' ||
      code === '98'
    ) {
      return 'PENDIENTE';
    }

    return 'RECHAZADO';
  }

  private isSunatNumeracionRepetida(response: any): boolean {
    const responseText = JSON.stringify(response || {}).toLowerCase();
    const code = String(
      response?.code ??
      response?.error?.code ??
      response?.response?.data?.code ??
      response?.response?.data?.error?.code ??
      '',
    );

    return code === '1033' || responseText.includes('1033') || responseText.includes('numeraci');
  }

  private extractQpseMessage(response: any, status?: string): string {
    const messages = [
      response?.message,
      response?.mensaje,
      Array.isArray(response?.errors) ? response.errors.join(' | ') : response?.errors,
      Array.isArray(response?.errores) ? response.errores.join(' | ') : response?.errores,
      Array.isArray(response?.notes) ? response.notes.join(' | ') : response?.notes,
      Array.isArray(response?.observaciones) ? response.observaciones.join(' | ') : response?.observaciones,
    ].filter(Boolean);

    return messages[0] || (status ? `SUNAT devolvió estado: ${status}` : 'Respuesta sin detalle de QPSE');
  }

  private decodeBase64ToUtf8(value: string): string {
    try {
      return Buffer.from(value, 'base64').toString('utf8');
    } catch {
      return value;
    }
  }

  private decodeBase64ToBuffer(value: string): Buffer {
    return Buffer.from(value, 'base64');
  }

  private buildCdrStorageKey(
    empresaId: number,
    tipoDoc: string,
    serie: string,
    correlativo: number,
    cdrBuffer: Buffer,
  ): string {
    const tipo =
      tipoDoc === '01' ? 'factura' : tipoDoc === '03' ? 'boleta' : 'nota';
    const numero = String(correlativo).padStart(8, '0');
    const extension = cdrBuffer.toString('utf8').trim().startsWith('<') ? 'xml' : 'zip';
    return `comprobantes/empresa-${empresaId}/${tipo}/${serie}-${numero}-cdr.${extension}`;
  }

  /**
   * Genera y sube el PDF a S3 para un comprobante ya existente.
   * Útil para comprobantes que fueron marcados como ACEPTADO por el scheduler
   * pero no tienen PDF generado.
   */
  async generarYSubirPDF(comprobanteId: number, qrCode?: string): Promise<string | null> {
    if (!this.s3Service.isEnabled()) {
      console.log('S3 no está habilitado, no se puede generar PDF');
      return null;
    }

    const comp = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      include: {
        cliente: { include: { tipoDocumento: true } },
        empresa: { include: { ubicacion: true, rubro: true } },
        detalles: true,
        tipoDetraccion: true,
        medioPagoDetraccion: true,
      },
    });

    if (!comp) {
      console.error(`Comprobante ${comprobanteId} no encontrado`);
      return null;
    }

    if (comp.s3PdfUrl) {
      console.log(`Comprobante ${comprobanteId} ya tiene PDF: ${comp.s3PdfUrl}`);
      return comp.s3PdfUrl;
    }

    try {
      const tipoDocMap: Record<string, string> = {
        '01': 'FACTURA',
        '03': 'BOLETA',
        '07': 'NOTA DE CRÉDITO',
        '08': 'NOTA DE DÉBITO',
      };

      const buildLogoDataUrl = (raw?: string | null): string | undefined => {
        if (!raw) return undefined;
        const t = raw.trim();
        if (t.startsWith('data:')) return t;
        if (/^https?:\/\//i.test(t) || t.startsWith('/')) return t;
        return `data:${t.startsWith('/9j/') ? 'image/jpeg' : 'image/png'};base64,${t}`;
      };

      const rawLogo = (comp.empresa as any).logo || null;
      const logoDataUrl = buildLogoDataUrl(rawLogo);

      const fechaEmision = new Date(comp.fechaEmision as any);

      const pdfData = {
        nombreComercial: ((comp.empresa as any).nombreComercial || comp.empresa.razonSocial).toUpperCase(),
        razonSocial: comp.empresa.razonSocial.toUpperCase(),
        ruc: comp.empresa.ruc,
        direccion: (comp.empresa.direccion || '').toUpperCase(),
        rubro: comp.empresa.rubro?.nombre?.toUpperCase() || 'VENTA DE MATERIALES DE CONSTRUCCIÓN',
        celular: '',
        email: '',
        logo: logoDataUrl,
        tipoDocumento: tipoDocMap[comp.tipoDoc] || 'COMPROBANTE',
        serie: comp.serie,
        correlativo: String(comp.correlativo).padStart(8, '0'),
        fecha: fechaEmision.toLocaleDateString('es-PE'),
        hora: fechaEmision.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) + ' p.m.',
        clienteNombre: (comp.cliente?.nombre || 'CLIENTES VARIOS').toUpperCase(),
        clienteTipoDoc: comp.cliente?.tipoDocumento?.codigo === '6' ? 'RUC' : 'DNI',
        clienteNumDoc: comp.cliente?.nroDoc || '',
        clienteDireccion: (comp.cliente?.direccion || '-').toUpperCase(),
        productos: comp.detalles.map((det: any) => ({
          cantidad: det.cantidad,
          unidadMedida: det.unidadMedida || 'NIU',
          descripcion: (det.descripcion || '').toUpperCase(),
          precioUnitario: Number(det.mtoPrecioUnitario || 0).toFixed(2),
          total: Number((det.mtoPrecioUnitario || 0) * det.cantidad).toFixed(2),
        })),
        mtoOperGravadas: Number(comp.mtoOperGravadas).toFixed(2),
        mtoIGV: Number(comp.mtoIGV).toFixed(2),
        mtoOperInafectas: Number(comp.mtoOperInafectas || 0) > 0 ? Number(comp.mtoOperInafectas).toFixed(2) : undefined,
        mtoImpVenta: Number(comp.mtoImpVenta).toFixed(2),
        totalEnLetras: numeroALetras(Number(comp.mtoImpVenta)).toUpperCase(),
        formaPago: comp.formaPagoTipo === 'Contado' ? 'CONTADO' : 'CRÉDITO',
        medioPago: (comp.medioPago || 'EFECTIVO').toUpperCase(),
        observaciones: comp.observaciones ? comp.observaciones.toUpperCase() : undefined,
        qrCode: qrCode ? `data:image/png;base64,${qrCode}` : undefined,
        // Detracción
        tipoDetraccion: (comp as any).tipoDetraccion
          ? `${(comp as any).tipoDetraccion.codigo} - ${(comp as any).tipoDetraccion.descripcion} (${(comp as any).tipoDetraccion.porcentaje}%)`
          : undefined,
        montoDetraccion: comp.montoDetraccion ? Number(comp.montoDetraccion).toFixed(2) : undefined,
        cuentaBancoNacion: comp.cuentaBancoNacion || undefined,
        medioPagoDetraccion: (comp as any).medioPagoDetraccion
          ? `${(comp as any).medioPagoDetraccion.codigo} - ${(comp as any).medioPagoDetraccion.descripcion}`
          : undefined,
      };

      const pdfBuffer = await this.pdfGenerator.generarPDFComprobante(pdfData);

      const pdfKey = this.s3Service.generateComprobanteKey(
        comp.empresaId,
        comp.tipoDoc,
        comp.serie,
        comp.correlativo,
        'pdf',
      );

      const s3PdfUrl = await this.s3Service.uploadPDF(pdfBuffer, pdfKey);
      console.log(`📤 PDF generado y subido a S3 para comprobante ${comprobanteId}: ${s3PdfUrl}`);

      await this.prisma.comprobante.update({
        where: { id: comprobanteId },
        data: { s3PdfUrl },
      });

      return s3PdfUrl;
    } catch (error: any) {
      console.error(`❌ Error generando PDF para comprobante ${comprobanteId}:`, error.message);
      return null;
    }
  }

  private async procesarEfectoEnComprobanteAfectado(nota: any, status: string) {
    // Solo procesar si la nota fue aceptada y afecta a otro comprobante
    if (status !== 'ACEPTADO') return;
    if (!nota.tipDocAfectado || !nota.numDocAfectado || !nota.motivo) return;

    console.log('🔄 Procesando efecto en comprobante afectado:', {
      tipoNota: nota.tipoDoc,
      motivoCodigo: nota.motivo.codigo,
      docAfectado: nota.numDocAfectado,
    });

    // Buscar el comprobante afectado
    const [serieAfectado, correlativoAfectado] = nota.numDocAfectado.split('-');
    const comprobanteAfectado = await this.prisma.comprobante.findFirst({
      where: {
        empresaId: nota.empresaId,
        tipoDoc: nota.tipDocAfectado,
        serie: serieAfectado,
        correlativo: Number(correlativoAfectado),
      },
    });

    if (!comprobanteAfectado) {
      console.warn(
        '⚠️ Comprobante afectado no encontrado:',
        nota.numDocAfectado,
      );
      return;
    }

    // Procesar según el tipo de nota y motivo
    if (nota.tipoDoc === '07') {
      // Nota de Crédito
      await this.procesarNotaCredito(nota, comprobanteAfectado);
    } else if (nota.tipoDoc === '08') {
      // Nota de Débito
      await this.procesarNotaDebito(nota, comprobanteAfectado);
    }
  }

  private async procesarNotaCredito(nota: any, comprobanteAfectado: any) {
    const motivoCodigo = nota.motivo.codigo;

    switch (motivoCodigo) {
      case '01': // Anulación de la operación
      case '06': // Devolución total
        console.log('🚫 Anulando comprobante por nota de crédito:', {
          comprobante: `${comprobanteAfectado.tipoDoc}-${comprobanteAfectado.serie}-${comprobanteAfectado.correlativo}`,
          motivo: nota.motivo.descripcion,
        });

        await this.prisma.comprobante.update({
          where: { id: comprobanteAfectado.id },
          data: {
            estadoEnvioSunat: 'ANULADO',
            estadoPago: 'ANULADO' as any,
            saldo: 0,
          },
        });

        console.log('✅ Comprobante anulado correctamente');
        break;

      case '02': // Corrección por error en el RUC
      case '03': // Corrección por error en la descripción
        // Estos motivos no cambian el estado del documento original
        console.log(
          '📝 Nota de crédito por corrección - no se modifica estado del original',
        );
        break;

      case '04': // Descuento global
      case '05': // Descuento por ítem
        // Estos motivos no anulan el documento, solo ajustan valores
        console.log(
          '💰 Nota de crédito por descuento - documento original mantiene su estado',
        );
        break;

      case '07': // Devolución por ítem
        // Devolución parcial, no anula el documento completo
        console.log(
          '🔄 Nota de crédito por devolución parcial - documento original mantiene su estado',
        );
        break;

      default:
        console.warn(
          '⚠️ Motivo de nota de crédito no reconocido:',
          motivoCodigo,
        );
        break;
    }
  }

  private async procesarNotaDebito(nota: any, comprobanteAfectado: any) {
    const motivoCodigo = nota.motivo.codigo;

    switch (motivoCodigo) {
      case '01': // Intereses por mora
      case '02': // Aumento en el valor
      case '03': // Penalidades / otros conceptos
      case '11': // Ajustes de operaciones de exportación
      case '12': // Ajustes afectos al IVAP
        // Estos motivos NO cambian el estado del documento original
        // Solo agregan cargos adicionales al documento existente
        console.log(
          '💳 Nota de débito por cargo adicional - documento original mantiene su estado:',
          {
            comprobante: `${comprobanteAfectado.tipoDoc}-${comprobanteAfectado.serie}-${comprobanteAfectado.correlativo}`,
            motivo: nota.motivo.descripcion,
            motivoCodigo,
          },
        );
        break;

      case '10': // Ajuste de precio (cuando el precio original fue menor)
        // Este motivo generalmente tampoco anula el documento
        // Solo ajusta el precio, pero mantiene válido el documento original
        console.log(
          '💰 Nota de débito por ajuste de precio - documento original mantiene su estado:',
          {
            comprobante: `${comprobanteAfectado.tipoDoc}-${comprobanteAfectado.serie}-${comprobanteAfectado.correlativo}`,
            motivo: nota.motivo.descripcion,
          },
        );
        break;

      // CASOS ESPECIALES que podrían requerir acción adicional:
      case '99': // Otros conceptos (revisar caso por caso)
        console.log(
          '🔍 Nota de débito por otros conceptos - revisar manualmente:',
          {
            comprobante: `${comprobanteAfectado.tipoDoc}-${comprobanteAfectado.serie}-${comprobanteAfectado.correlativo}`,
            motivo: nota.motivo.descripcion,
            advertencia: 'Motivo genérico, revisar si requiere acción especial',
          },
        );
        break;

      default:
        console.warn('⚠️ Motivo de nota de débito no reconocido:', {
          motivoCodigo,
          descripcion: nota.motivo.descripcion,
          comprobante: `${comprobanteAfectado.tipoDoc}-${comprobanteAfectado.serie}-${comprobanteAfectado.correlativo}`,
        });
        break;
    }

    // IMPORTANTE: Las notas de débito generalmente NO anulan documentos
    // Solo agregan cargos o ajustan valores hacia arriba
    // El documento original sigue siendo válido
  }

  /**
   * Calculate next retry time using exponential backoff
   * Retry intervals: 1min, 2min, 5min, 15min, 30min, 1h, 2h, 3h, 4h, 5h (max)
   */
  calculateNextRetry(currentRetryCount: number): Date {
    const backoffMinutes = [1, 2, 5, 15, 30, 60, 120, 180, 240, 300]; // Up to 5 hours
    const minutes = backoffMinutes[Math.min(currentRetryCount, backoffMinutes.length - 1)];
    const nextRetry = new Date();
    nextRetry.setMinutes(nextRetry.getMinutes() + minutes);
    return nextRetry;
  }

  /**
   * Check if comprobante has exceeded max retry window (5 hours from creation)
   * @deprecated Kept for backward compatibility — retry logic now uses classifyError()
   */
  isRetryWindowExpired(comprobante: any): boolean {
    const createdAt = new Date(comprobante.creadoEn);
    const maxRetryTime = new Date(createdAt.getTime() + (this.maxRetryHours * 60 * 60 * 1000));
    return new Date() > maxRetryTime;
  }

  /**
   * Backoff para errores de RED: 5m → 15m → 1h → 4h → 12h → 24h (se mantiene en 24h).
   * Cubre apagones de SUNAT de varias horas o días completos.
   * Public para que el scheduler también pueda usarlo en Job 1.
   */
  public calculateNetworkRetry(currentRetryCount: number): Date {
    const backoffMinutes = [5, 15, 60, 240, 720, 1440]; // último = 24h
    const minutes = backoffMinutes[Math.min(currentRetryCount, backoffMinutes.length - 1)];
    const next = new Date();
    next.setMinutes(next.getMinutes() + minutes);
    return next;
  }

  /**
   * Clasifica el error para decidir la estrategia de reintento:
   * - DATOS: SUNAT/QPSE rechazó explícitamente (XML inválido, datos incorrectos) → máx 5 reintentos
   * - RED: falla de infraestructura (SUNAT caída, timeout, sin conexión) → máx 30 reintentos con backoff 24h
   */
  private classifyError(err: any): 'DATOS' | 'RED' {
    const msg = String(err?.message || '').toLowerCase();
    const httpStatus = err?.status || err?.response?.status;

    // HttpException lanzada por nosotros al detectar rechazo explícito de SUNAT/QPSE
    if (msg.includes('qpse rechaz') || msg.includes('rechazó el documento')) return 'DATOS';

    // Errores de validación XML / UBL
    if (msg.includes('no se puede leer') || msg.includes('parsear') ||
        msg.includes('xml') || msg.includes('ubl') || msg.includes('cvc-')) return 'DATOS';

    // HTTP 4xx = rechazo explícito del servidor (no infraestructura)
    if (httpStatus && httpStatus >= 400 && httpStatus < 500) return 'DATOS';

    // Todo lo demás: timeouts, conexión rechazada, 5xx, QPSE no disponible → RED
    return 'RED';
  }

  async anularComprobanteSunat(documentId: string, empresaId: number, motivo: string = 'ANULACION DE LA OPERACION') {
    try {
      const empresaCreds = await (this.prisma.empresa as any).findUnique({
        where: { id: empresaId },
        select: { usuarioPse: true, contrasenaPse: true },
      }) as { usuarioPse: string | null; contrasenaPse: string | null } | null;
      const qpseUsername = empresaCreds?.usuarioPse;
      const qpsePassword = empresaCreds?.contrasenaPse;
      if (!qpseUsername || !qpsePassword) {
        throw new HttpException(
          'Credenciales QPSE no configuradas. Configure usuarioPse y contrasenaPse en la empresa.',
          400,
        );
      }

      const comprobante = await this.prisma.comprobante.findFirst({
        where: { empresaId, documentoId: documentId },
        select: { documentoId: true, serie: true, correlativo: true, tipoDoc: true },
      });

      const externalId = comprobante?.documentoId || documentId;
      const qpseAccess = await this.qpseClient.obtenerTokenAcceso({
        username: qpseUsername,
        password: qpsePassword,
      });

      console.log(`🚀 Enviando anulación a QPSE para el documento: ${externalId}`);

      const response = await this.qpseClient.anularComprobante({
        accessToken: qpseAccess.token_acceso!,
        externalId,
        motivo: motivo.substring(0, 100),
      });

      console.log('✅ Documento anulado en QPSE:', response);
      return response;
    } catch (err: any) {
      console.error('🚫 Error anulando en QPSE:', {
        documentId,
        error: err.response?.data || err.message,
      });
      throw new HttpException(
        `QPSE rechazó la anulación: ${err.response?.data?.message || err.message || 'Error desconocido'}`,
        502,
      );
    }
  }

  async debugPayload(comprobanteId: number) {
    const comp = await this.prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      include: {
        cliente: true,
        detalles: true,
        leyendas: true,
        motivo: true,
      },
    });

    return {
      message: 'Debug mode',
      comprobante: comp,
    };
  }
}
