import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { numeroALetras } from './utils/numero-a-letras';
import axios from 'axios';
import { QpseClient, QpseSendResponse } from '../common/utils/qpse.client';
import { buildUblXml } from '../common/utils/ubl-xml';
import { ApisPeruClient } from '../common/utils/apis-peru.client';
import { JambleClient } from '../common/utils/jamble.client';
import { isApisunatProvider, isJambleProvider, resolveBillingProvider } from '../common/utils/billing-provider';

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

/**
 * Códigos SUNAT que nunca serán aceptados sin importar cuántos reintentos se hagan.
 * Cuando SUNAT devuelve uno de estos códigos el comprobante se elimina automáticamente.
 */
const SUNAT_FATAL_CODES = new Set([
  1033, 1034,          // RUC emisor no activo / no habilitado para CPE
  1083,                // RUC receptor no existe en SUNAT
  2329,                // Dirección del establecimiento no registrada
  2800, 2825,          // Serie no corresponde / no existe para el emisor
  3117,                // Código de producto SUNAT incorrecto
]);

function extractFatalSunatCode(detail: string | null | undefined): number | null {
  if (!detail) return null;
  const match = detail.match(/\b(\d{3,4})\s*[-–]/);
  if (!match) return null;
  const code = Number(match[1]);
  return SUNAT_FATAL_CODES.has(code) ? code : null;
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

// Catálogo 06 SUNAT — tipos de documento de identidad (schemeID UBL)
// Nota: este mapping se usa para UBL (schemeID). El valor es el mismo código.
function getTipoDocumentoSchemeId(tipoDocCodigo: string | null | undefined): string {
  const codigo = String(tipoDocCodigo ?? '').trim();
  const map: Record<string, string> = { '0': '0', '1': '1', '4': '4', '6': '6', '7': '7' };
  return map[codigo] ?? '1';
}

function getTipoDocumentoLabel(tipoDocCodigo: string | null | undefined): string {
  const codigo = String(tipoDocCodigo ?? '').trim();
  const map: Record<string, string> = {
    '0': 'NO DOM. (SIN RUC)',
    '1': 'DNI',
    '4': 'CE',
    '6': 'RUC',
    '7': 'PASAPORTE',
  };
  return map[codigo] ?? 'DNI';
}

@Injectable()
export class EnviarSunatService {
  private readonly logger = new Logger(EnviarSunatService.name);
  private readonly maxRetries = 12;       // 12 intentos × 5s = 60s máximo esperando SUNAT
  private readonly retryInterval = 5000;


  private readonly MAX_DATA_ERROR_RETRIES = 5;


  private readonly MAX_INFRA_ERROR_RETRIES = 30;


  private readonly maxRetryAttempts = 10;
  private readonly maxRetryHours = 5;

  public simulateSunatFailure = false;

  private getJambleCorrelativoFloor(empresaId: number, serie: string): number | null {
    const raw = String(process.env.JAMBLE_CORRELATIVO_FLOOR || '').trim();
    if (!raw) return null;
    const entries = raw.split(',').map((v) => v.trim()).filter(Boolean);
    for (const entry of entries) {
      const [empresa, serieCfg, floor] = entry.split(':').map((v) => String(v || '').trim());
      if (!empresa || !serieCfg || !floor) continue;
      if (Number(empresa) !== empresaId) continue;
      if (serieCfg.toUpperCase() !== String(serie || '').toUpperCase()) continue;
      const value = Number(floor);
      if (!Number.isNaN(value) && value > 0) return value;
    }
    return null;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly qpseClient: QpseClient,
    private readonly apisPeruClient: ApisPeruClient,
    private readonly jambleClient: JambleClient,
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
      select: {
        ruc: true,
        usuarioPse: true,
        contrasenaPse: true,
        usaDemo: true,
        providerId: true,
        providerToken: true,
        billingProvider: true,
        billingApiBaseUrl: true,
        billingApiDemoBaseUrl: true,
        billingApiToken: true,
        billingApiUser: true,
        billingApiPassword: true,
      },
    }) as {
      ruc: string | null;
      usuarioPse: string | null;
      contrasenaPse: string | null;
      usaDemo: boolean;
      providerId: string | null;
      providerToken: string | null;
      billingProvider: string | null;
      billingApiBaseUrl: string | null;
      billingApiDemoBaseUrl: string | null;
      billingApiToken: string | null;
      billingApiUser: string | null;
      billingApiPassword: string | null;
    } | null;
    const qpseUsername = empresa?.usuarioPse;
    const qpsePassword = empresa?.contrasenaPse;
    const providerId = String(empresa?.providerId || '').trim();
    const providerToken = String(empresa?.providerToken || '').trim();
    const billingProvider = resolveBillingProvider(empresa);
    const usaDemo = empresa?.usaDemo ?? false;
    const jambleBaseUrl = String(
      usaDemo
        ? (empresa?.billingApiDemoBaseUrl || empresa?.billingApiBaseUrl || '')
        : (empresa?.billingApiBaseUrl || ''),
    ).trim();
    const jambleToken = String(empresa?.billingApiToken || '').trim();
    const jambleUser = String(empresa?.billingApiUser || '').trim();
    const jamblePassword = String(empresa?.billingApiPassword || '').trim();

    if (isApisunatProvider(billingProvider)) {
      if (!providerId || !providerToken) {
        throw new HttpException(
          'Proveedor APISUNAT: faltan credenciales. Configura providerId (personaId) y providerToken en la empresa.',
          400,
        );
      }
    } else if (isJambleProvider(billingProvider)) {
      if (!jambleBaseUrl) {
        throw new HttpException(
          'Proveedor JAMBLE: falta URL API para el entorno seleccionado en la empresa.',
          400,
        );
      }
      if (!jambleToken && !(jambleUser && jamblePassword)) {
        throw new HttpException(
          'Proveedor JAMBLE: configura billingApiToken o billingApiUser + billingApiPassword en la empresa.',
          400,
        );
      }
    } else if (!qpseUsername || !qpsePassword) {
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
              listAgencyName: 'PE:SUNAT',
              listName: 'Tipo de Documento',
              listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01',
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
          'cbc:DocumentCurrencyCode': {
            _attributes: {
              listID: 'ISO 4217 Alpha',
              listName: 'Currency',
              listAgencyName: 'United Nations Economic Commission for Europe',
            },
            _text: comp.tipoMoneda,
          },
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
                    schemeID: getTipoDocumentoSchemeId(comp.cliente.tipoDocumento?.codigo),
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
            'cac:TaxSubtotal': (() => {
              const cur = comp.tipoMoneda;
              const subtotals: any[] = [];
              // IGV (Gravado) — siempre incluir si hay mtoOperGravadas o si no hay otras ops
              if (Number(comp.mtoOperGravadas) > 0 || (Number(comp.mtoOperExoneradas ?? 0) === 0 && Number(comp.mtoOperInafectas ?? 0) === 0)) {
                subtotals.push({
                  'cbc:TaxableAmount': { _attributes: { currencyID: cur }, _text: comp.mtoOperGravadas },
                  'cbc:TaxAmount': { _attributes: { currencyID: cur }, _text: comp.mtoIGV },
                  'cac:TaxCategory': {
                    'cac:TaxScheme': { 'cbc:ID': { _text: '1000' }, 'cbc:Name': { _text: 'IGV' }, 'cbc:TaxTypeCode': { _text: 'VAT' } },
                  },
                });
              }
              // Exonerado (9997)
              if (Number(comp.mtoOperExoneradas ?? 0) > 0) {
                subtotals.push({
                  'cbc:TaxableAmount': { _attributes: { currencyID: cur }, _text: comp.mtoOperExoneradas },
                  'cbc:TaxAmount': { _attributes: { currencyID: cur }, _text: 0 },
                  'cac:TaxCategory': {
                    'cac:TaxScheme': { 'cbc:ID': { _text: '9997' }, 'cbc:Name': { _text: 'EXO' }, 'cbc:TaxTypeCode': { _text: 'VAT' } },
                  },
                });
              }
              // Inafecto (9998)
              if (Number(comp.mtoOperInafectas ?? 0) > 0) {
                subtotals.push({
                  'cbc:TaxableAmount': { _attributes: { currencyID: cur }, _text: comp.mtoOperInafectas },
                  'cbc:TaxAmount': { _attributes: { currencyID: cur }, _text: 0 },
                  'cac:TaxCategory': {
                    'cac:TaxScheme': { 'cbc:ID': { _text: '9998' }, 'cbc:Name': { _text: 'INA' }, 'cbc:TaxTypeCode': { _text: 'FRE' } },
                  },
                });
              }
              return subtotals;
            })(),
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
          'cac:InvoiceLine': comp.detalles.map((d: any, index: number) => {
            const tipAfe = Number(d.tipAfeIgv ?? 10);
            // Catálogo 05 SUNAT: TaxScheme por tipo de afectación IGV
            const taxScheme = tipAfe === 20
              ? { id: '9997', name: 'EXO', typeCode: 'VAT' }
              : tipAfe === 30
              ? { id: '9998', name: 'INA', typeCode: 'FRE' }
              : { id: '1000', name: 'IGV', typeCode: 'VAT' }; // 10 Gravado

            return ({
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
                    'cbc:Percent': { _text: tipAfe === 10 ? (d.porcentajeIgv || 18) : 0 },
                    'cbc:TaxExemptionReasonCode': {
                      _text: String(tipAfe === 10 ? (d.tipAfeIgv || 10) : d.tipAfeIgv),
                    },
                    'cac:TaxScheme': {
                      'cbc:ID': { _text: taxScheme.id },
                      'cbc:Name': { _text: taxScheme.name },
                      'cbc:TaxTypeCode': { _text: taxScheme.typeCode },
                    },
                  },
                },
              ],
            },
            'cac:Item': {
              'cbc:Description': { _text: limpiarTexto(d.descripcion) },
              'cac:SellersItemIdentification': {
                'cbc:ID': { _text: d.producto?.codigo || '-' },
              },
            },
            'cac:Price': {
              'cbc:PriceAmount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: d.mtoValorUnitario,
              },
            },
          }); }),
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
          (d: any, index: number) => {
            const tipAfe = Number(d.tipAfeIgv ?? 10);
            const taxScheme = tipAfe === 20
              ? { id: '9997', name: 'EXO', typeCode: 'VAT' }
              : tipAfe === 30
              ? { id: '9998', name: 'INA', typeCode: 'FRE' }
              : { id: '1000', name: 'IGV', typeCode: 'VAT' };
            return ({
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
                  _text: d.mtoPrecioUnitario,
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
                    'cbc:Percent': { _text: tipAfe === 10 ? (d.porcentajeIgv || 18) : 0 },
                    'cbc:TaxExemptionReasonCode': {
                      _text: String(d.tipAfeIgv || 10),
                    },
                    'cac:TaxScheme': {
                      'cbc:ID': { _text: taxScheme.id },
                      'cbc:Name': { _text: taxScheme.name },
                      'cbc:TaxTypeCode': { _text: taxScheme.typeCode },
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
          }); },
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
          'cac:TaxSubtotal': (() => {
            const cur = comp.tipoMoneda;
            const subtotals: any[] = [];
            if (Number(comp.mtoOperGravadas) > 0 || (Number(comp.mtoOperExoneradas ?? 0) === 0 && Number(comp.mtoOperInafectas ?? 0) === 0)) {
              subtotals.push({
                'cbc:TaxableAmount': { _attributes: { currencyID: cur }, _text: comp.mtoOperGravadas },
                'cbc:TaxAmount': { _attributes: { currencyID: cur }, _text: comp.mtoIGV },
                'cac:TaxCategory': {
                  'cac:TaxScheme': { 'cbc:ID': { _text: '1000' }, 'cbc:Name': { _text: 'IGV' }, 'cbc:TaxTypeCode': { _text: 'VAT' } },
                },
              });
            }
            if (Number(comp.mtoOperExoneradas ?? 0) > 0) {
              subtotals.push({
                'cbc:TaxableAmount': { _attributes: { currencyID: cur }, _text: comp.mtoOperExoneradas },
                'cbc:TaxAmount': { _attributes: { currencyID: cur }, _text: 0 },
                'cac:TaxCategory': {
                  'cac:TaxScheme': { 'cbc:ID': { _text: '9997' }, 'cbc:Name': { _text: 'EXO' }, 'cbc:TaxTypeCode': { _text: 'VAT' } },
                },
              });
            }
            if (Number(comp.mtoOperInafectas ?? 0) > 0) {
              subtotals.push({
                'cbc:TaxableAmount': { _attributes: { currencyID: cur }, _text: comp.mtoOperInafectas },
                'cbc:TaxAmount': { _attributes: { currencyID: cur }, _text: 0 },
                'cac:TaxCategory': {
                  'cac:TaxScheme': { 'cbc:ID': { _text: '9998' }, 'cbc:Name': { _text: 'INA' }, 'cbc:TaxTypeCode': { _text: 'FRE' } },
                },
              });
            }
            return subtotals;
          })(),
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

      let includeNoteNode = true;
      let includePaymentDueDateInTerms = true;
      const buildXmlArtifacts = (currentCorrelativo: number) => {
        const padded = currentCorrelativo.toString().padStart(8, '0');
        payload.fileName = `${empresa!.ruc}-${comp.tipoDoc}-${comp.serie}-${padded}`;
        payload.documentBody['cbc:ID'] = { _text: `${comp.serie}-${padded}` };
        payload.documentBody['cbc:UBLVersionID'] = { _text: '2.1' };
        payload.documentBody['cbc:CustomizationID'] = { _text: '2.0' };

        const noteNode = payload.documentBody['cbc:Note'];
        if (!includeNoteNode) {
          delete payload.documentBody['cbc:Note'];
        } else if (Array.isArray(noteNode)) {
          payload.documentBody['cbc:Note'] = noteNode
            .filter((item: any) => item && item._text !== undefined && item._text !== null && String(item._text).trim() !== '')
            .map((item: any) => {
              const attrs = { ...(item?._attributes || {}) };
              delete attrs.languageLocaleID;
              return {
                ...item,
                _attributes: {
                  ...attrs,
                },
              };
            });
        }

        if (!includePaymentDueDateInTerms) {
          const paymentTermsNode = payload.documentBody['cac:PaymentTerms'];
          const stripDueDate = (term: any) => {
            if (!term || typeof term !== 'object') return term;
            if ('cbc:PaymentDueDate' in term) delete term['cbc:PaymentDueDate'];
            return term;
          };

          if (Array.isArray(paymentTermsNode)) {
            payload.documentBody['cac:PaymentTerms'] = paymentTermsNode.map(stripDueDate);
          } else if (paymentTermsNode && typeof paymentTermsNode === 'object') {
            payload.documentBody['cac:PaymentTerms'] = stripDueDate(paymentTermsNode);
          }
        }

        const xmlFilename = payload.fileName;
        const documentBody = this.sanitizeUblNode(payload.documentBody) || {};
        const xmlContent = buildUblXml(this.resolveUblRootName(comp.tipoDoc), documentBody);

        if (['01', '07', '08'].includes(comp.tipoDoc)) {
          console.log(`[XML-DEBUG tipoDoc=${comp.tipoDoc}] primeros 2000 chars:\n`, xmlContent.substring(0, 2000));
        }

        return {
          xmlFilename,
          xmlContent,
          xmlContentBase64: Buffer.from(xmlContent, 'utf8').toString('base64'),
          documentBody,
        };
      };

      let xmlArtifacts = buildXmlArtifacts(comp.correlativo);
      let signedXmlContent = xmlArtifacts.xmlContent;
      let cdrBase64OrNull: string | null = null;
      let providerPdfBuffer: Buffer | null = null;
      let documentId: string | null = null;
      let status: 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' = 'PENDIENTE';

      if (isApisunatProvider(billingProvider)) {
        console.log(`🧪 Proveedor APISUNAT para ${comp.serie}-${comp.correlativo}`);

        const sendResponse = await this.apisPeruClient.sendBill({
          personaId: providerId,
          personaToken: providerToken,
          fileName: xmlArtifacts.xmlFilename,
          documentBody: xmlArtifacts.documentBody,
          customerEmail: comp.cliente?.email || undefined,
        });

        finalResponse = sendResponse;
        documentId = sendResponse?.documentId ? String(sendResponse.documentId) : null;
        status = this.normalizeApisunatStatus(sendResponse);

        if (!documentId || status === 'RECHAZADO') {
          const detail = this.extractApisunatMessage(sendResponse);
          throw new HttpException(`APISUNAT rechazó el documento: ${detail}`, 502);
        }

        await this.prisma.comprobante.update({
          where: { id: comprobanteId },
          data: {
            documentoId: documentId,
            estadoEnvioSunat: 'PENDIENTE',
          },
        });

        let retries = 0;
        while (status === 'PENDIENTE' && retries < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.retryInterval));
          const doc = await this.apisPeruClient.getDocumentById(documentId);
          finalResponse = doc;
          status = this.normalizeApisunatStatus(doc);
          retries++;

          console.log(`📊 Estado actual APISUNAT: ${status}`, {
            intento: retries,
            documentId,
            response: doc,
          });

          if (status !== 'PENDIENTE') {
            const xmlUrl = typeof doc?.xml === 'string' ? doc.xml : '';
            if (xmlUrl) {
              signedXmlContent = await this.downloadTextFromUrl(xmlUrl);
            }
            const cdrUrl = typeof doc?.cdr === 'string' ? doc.cdr : '';
            if (cdrUrl) {
              cdrBase64OrNull = await this.downloadBinaryAsBase64(cdrUrl);
            }
          }
        }
      } else if (isJambleProvider(billingProvider)) {
        console.log(`🧪 Proveedor JAMBLE para ${comp.serie}-${comp.correlativo}`);
        console.log('🧭 JAMBLE contexto emisión:', {
          comprobanteId,
          empresaId: comp.empresaId,
          tipoDoc: comp.tipoDoc,
          serie: comp.serie,
          correlativo: comp.correlativo,
          baseUrlHost: this.extractHost(jambleBaseUrl),
          authMode: jambleToken ? 'TOKEN' : (jambleUser && jamblePassword ? 'LOGIN' : 'NONE'),
          loginUser: this.maskJambleUser(jambleUser || null),
          forceDispatch: ['1', 'true', 'yes'].includes(
            String(process.env.JAMBLE_FORCE_DISPATCH || '').toLowerCase(),
          ),
        });

        const floor = this.getJambleCorrelativoFloor(comp.empresaId, comp.serie);
        if (floor && Number(comp.correlativo || 0) < floor) {
          await this.prisma.comprobante.update({
            where: { id: comprobanteId },
            data: { correlativo: floor },
          });
          comp.correlativo = floor;
          console.log(`⏫ JAMBLE correlativo ajustado por floor empresa ${comp.empresaId}: ${comp.serie}-${comp.correlativo}`);
        }

        const remoteNext = await this.jambleClient.obtenerSiguienteCorrelativo(
          {
            baseUrl: jambleBaseUrl,
            token: jambleToken || null,
            username: jambleUser || null,
            password: jamblePassword || null,
          },
          comp.serie,
          comp.tipoDoc,
        );
        if (remoteNext && remoteNext > Number(comp.correlativo || 0)) {
          await this.prisma.comprobante.update({
            where: { id: comprobanteId },
            data: { correlativo: remoteNext },
          });
          comp.correlativo = remoteNext;
          console.log(`⏩ JAMBLE correlativo alineado con remoto: ${comp.serie}-${comp.correlativo}`);
        }

        const jambleLoginContext = await this.jambleClient.obtenerContextoDesdeLogin({
          baseUrl: jambleBaseUrl,
          token: jambleToken || null,
          username: jambleUser || null,
          password: jamblePassword || null,
        });
        if (jambleLoginContext) {
          console.log('🪪 JAMBLE contexto login detectado:', {
            userId: jambleLoginContext.userId,
            establishmentId: jambleLoginContext.establishmentId,
          });
        }

        let registerResponse: any;
        let jambleRetryByDuplicate = 0;
        const jambleMaxRetryByDuplicate = Math.max(
          8,
          Number(process.env.JAMBLE_MAX_DUPLICATE_RETRIES || 80),
        );
        while (true) {
          const jamblePayload = this.buildJamblePayload(comp, jambleLoginContext || undefined);
          console.log(
            `📦 JAMBLE payload (${comp.tipoDoc === '01' ? 'FACTURA' : comp.tipoDoc === '03' ? 'BOLETA' : `TIPO-${comp.tipoDoc}`}) ${comp.serie}-${comp.correlativo}:`,
            JSON.stringify(jamblePayload, null, 2),
          );
          try {
            registerResponse = await this.jambleClient.emitirDocumento(
              {
                baseUrl: jambleBaseUrl,
                token: jambleToken || null,
                username: jambleUser || null,
                password: jamblePassword || null,
              },
              jamblePayload,
            );
            break;
          } catch (error) {
            if (
              jambleRetryByDuplicate < jambleMaxRetryByDuplicate &&
              this.isJambleNumeracionRepetidaError(error)
            ) {
              const remote = this.extractJambleSerieCorrelativoFromError(error);
              const ultimoLocal = await this.prisma.comprobante.findFirst({
                where: { empresaId: comp.empresaId, tipoDoc: comp.tipoDoc, serie: comp.serie },
                orderBy: { correlativo: 'desc' },
                select: { correlativo: true },
              });

              const localNext = (ultimoLocal?.correlativo ?? comp.correlativo ?? 0) + 1;
              const remoteNext = remote ? remote.correlativo + 1 : localNext;

              // When JAMBLE has many hidden/filtered numbers already taken,
              // advancing one-by-one is too slow. Jump by blocks after a few retries.
              const jump =
                jambleRetryByDuplicate >= 30 ? 200 :
                jambleRetryByDuplicate >= 15 ? 100 :
                jambleRetryByDuplicate >= 5 ? 25 :
                1;

              const nuevoCorrelativo = Math.max(localNext, remoteNext + jump);

              await this.prisma.comprobante.update({
                where: { id: comprobanteId },
                data: { correlativo: nuevoCorrelativo },
              });
              comp.correlativo = nuevoCorrelativo;
              jambleRetryByDuplicate++;
              console.warn(`♻️ JAMBLE numeración repetida. Reintentando ${comp.serie}-${comp.correlativo} (intento ${jambleRetryByDuplicate}/${jambleMaxRetryByDuplicate})`);
              continue;
            }
            throw error;
          }
        }

        finalResponse = registerResponse;
        documentId = this.extractJambleDocumentId(registerResponse, xmlArtifacts.xmlFilename);
        const jambleInternalId = this.extractJambleInternalId(registerResponse);
        status = this.normalizeJambleStatus(registerResponse);
        console.log('🧾 JAMBLE register result:', this.summarizeJambleResponse(registerResponse, status, documentId));

        // Intentar sincronizar numeración real del proveedor (ej: B001-35)
        // para evitar que el correlativo local se desalinee.
        let jambleNumberFull =
          String(
            registerResponse?.data?.number_full ||
              registerResponse?.number_full ||
              registerResponse?.data?.numero_completo ||
              registerResponse?.numero_completo ||
              '',
          ).trim() || null;

        if (!jambleNumberFull && documentId) {
          jambleNumberFull = await this.jambleClient.buscarNumeroCompletoPorExternalId(
            {
              baseUrl: jambleBaseUrl,
              token: jambleToken || null,
              username: jambleUser || null,
              password: jamblePassword || null,
            },
            documentId,
          );
        }

        const parsedNumber = this.parseSerieCorrelativo(jambleNumberFull);
        if (parsedNumber) {
          await this.prisma.comprobante.update({
            where: { id: comprobanteId },
            data: {
              serie: parsedNumber.serie,
              correlativo: parsedNumber.correlativo,
            },
          });
          comp.serie = parsedNumber.serie;
          comp.correlativo = parsedNumber.correlativo;
        }
        console.log('📌 JAMBLE trazabilidad:', {
          comprobanteId,
          empresaId: comp.empresaId,
          serie: comp.serie,
          correlativo: comp.correlativo,
          numberFull: jambleNumberFull,
          externalId: documentId || null,
          internalId: jambleInternalId || null,
          status,
          baseUrlHost: this.extractHost(jambleBaseUrl),
          loginUser: this.maskJambleUser(jambleUser || null),
        });

        // QPOS/Jamble flow: first registers document, then explicitly sends to SUNAT
        if (documentId && this.shouldTriggerJambleSunat(registerResponse, status)) {
          try {
            console.log(`📤 JAMBLE dispatch request for ${comp.serie}-${comp.correlativo}`, {
              externalId: documentId,
              internalId: jambleInternalId || null,
            });
            const dispatchResponse = await this.jambleClient.enviarDocumentoSunat(
              {
                baseUrl: jambleBaseUrl,
                token: jambleToken || null,
                username: jambleUser || null,
                password: jamblePassword || null,
              },
              documentId,
              jambleInternalId,
            );
            finalResponse = dispatchResponse;
            status = this.normalizeJambleStatus(dispatchResponse);
            console.log('📨 JAMBLE dispatch result:', this.summarizeJambleResponse(dispatchResponse, status, documentId));
          } catch (error) {
            // Keep current response and continue with polling.
            // Some tenants process dispatch asynchronously and return non-blocking errors.
            const detail =
              (error as any)?.response?.data?.message ||
              (error as any)?.response?.data?.error ||
              (error as any)?.message ||
              'Error sin detalle';
            console.warn(`⚠️ JAMBLE dispatch to SUNAT failed, continuing polling (${comp.serie}-${comp.correlativo})`, {
              detail,
            });
          }
        }

        let retries = 0;
        while (status === 'PENDIENTE' && documentId && retries < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.retryInterval));
          const doc = await this.jambleClient.consultarDocumento(
            {
              baseUrl: jambleBaseUrl,
              token: jambleToken || null,
              username: jambleUser || null,
              password: jamblePassword || null,
            },
            documentId,
          );
          finalResponse = doc;
          status = this.normalizeJambleStatus(doc);
          retries++;
          console.log(`🔎 JAMBLE polling #${retries}:`, this.summarizeJambleResponse(doc, status, documentId));
        }

        const xmlUrl = this.extractJambleLink(finalResponse, 'xml');
        if (xmlUrl) {
          signedXmlContent = await this.downloadTextFromUrl(xmlUrl);
        }

        const cdrUrl = this.extractJambleLink(finalResponse, 'cdr');
        if (cdrUrl) {
          cdrBase64OrNull = await this.downloadBinaryAsBase64(cdrUrl);
        }

        const pdfUrl = this.extractJambleLink(finalResponse, 'pdf');
        if (pdfUrl) {
          providerPdfBuffer = await this.downloadBinaryAsBuffer(pdfUrl);
        }

        if (documentId) {
          await this.prisma.comprobante.update({
            where: { id: comprobanteId },
            data: {
              documentoId: documentId,
              estadoEnvioSunat: status === 'PENDIENTE' ? 'PENDIENTE' : 'EMITIDO',
            },
          });
        }
        console.log(`✅ JAMBLE final status ${comp.serie}-${comp.correlativo}:`, this.summarizeJambleResponse(finalResponse, status, documentId));
      } else {
        const qpseAccess = await this.qpseClient.obtenerTokenAcceso({
          username: qpseUsername!,
          password: qpsePassword!,
          usaDemo,
        });
        const accessToken = qpseAccess.token_acceso;
        if (!accessToken) {
          throw new HttpException('No se pudo obtener el token de acceso de QPSE', 502);
        }

        let signResponse = await this.qpseClient.firmarXML({
          accessToken,
          xmlFilename: xmlArtifacts.xmlFilename,
          xmlContentBase64: xmlArtifacts.xmlContentBase64,
          usaDemo,
        });

        if (!signResponse.xml) {
          throw new HttpException('QPSE no devolvió el XML firmado', 502);
        }

        let signedXmlBase64 = signResponse.xml;
        signedXmlContent = this.decodeBase64ToUtf8(signedXmlBase64);
        let initialResponse = await this.qpseClient.enviarXML({
          accessToken,
          xmlFilename: xmlArtifacts.xmlFilename,
          externalId: signResponse.external_id,
          xmlSignedBase64: signedXmlBase64,
          usaDemo,
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
            usaDemo,
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
            usaDemo,
          });
        }

        if (this.isSunatUblVersionError(initialResponse) || this.isSunatCustomizationVersionError(initialResponse)) {
          console.warn(
            `⚠️ QPSE rechazó versión UBL/Customization (${comp.serie}-${comp.correlativo}). Reintentando solo sin cbc:Note (manteniendo UBL 2.1 / Customization 2.0)...`,
          );

          includeNoteNode = false;

          xmlArtifacts = buildXmlArtifacts(comp.correlativo);
          signResponse = await this.qpseClient.firmarXML({
            accessToken,
            xmlFilename: xmlArtifacts.xmlFilename,
            xmlContentBase64: xmlArtifacts.xmlContentBase64,
            usaDemo,
          });

          if (!signResponse.xml) {
            throw new HttpException('QPSE no devolvió el XML firmado en el reintento sin cbc:Note', 502);
          }

          signedXmlBase64 = signResponse.xml;
          signedXmlContent = this.decodeBase64ToUtf8(signedXmlBase64);
          initialResponse = await this.qpseClient.enviarXML({
            accessToken,
            xmlFilename: xmlArtifacts.xmlFilename,
            externalId: signResponse.external_id,
            xmlSignedBase64: signedXmlBase64,
            usaDemo,
          });
        }

        if (this.isSunatPaymentDueDateInTermsError(initialResponse) && includePaymentDueDateInTerms) {
          console.warn(
            `⚠️ QPSE rechazó cbc:PaymentDueDate en cac:PaymentTerms (${comp.serie}-${comp.correlativo}). Reintentando sin PaymentDueDate...`,
          );

          includePaymentDueDateInTerms = false;

          xmlArtifacts = buildXmlArtifacts(comp.correlativo);
          signResponse = await this.qpseClient.firmarXML({
            accessToken,
            xmlFilename: xmlArtifacts.xmlFilename,
            xmlContentBase64: xmlArtifacts.xmlContentBase64,
            usaDemo,
          });

          if (!signResponse.xml) {
            throw new HttpException('QPSE no devolvió el XML firmado en el reintento sin PaymentDueDate', 502);
          }

          signedXmlBase64 = signResponse.xml;
          signedXmlContent = this.decodeBase64ToUtf8(signedXmlBase64);
          initialResponse = await this.qpseClient.enviarXML({
            accessToken,
            xmlFilename: xmlArtifacts.xmlFilename,
            externalId: signResponse.external_id,
            xmlSignedBase64: signedXmlBase64,
            usaDemo,
          });
        }

        finalResponse = initialResponse;
        const qpseTicket = initialResponse.ticket;
        documentId = String(qpseTicket || xmlArtifacts.xmlFilename);
        status = this.normalizeQpseStatus(initialResponse);

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

            finalResponse = await this.qpseClient.consultarTicket(qpseTicket, accessToken, usaDemo);
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

          if (cdrBase64OrNull || finalResponse?.cdr) {
            const cdrBuffer = this.decodeBase64ToBuffer(cdrBase64OrNull || finalResponse.cdr);
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
          if (providerPdfBuffer) {
            const providerPdfKey = this.s3Service.generateComprobanteKey(
              comp.empresaId,
              comp.tipoDoc,
              comp.serie,
              comp.correlativo,
              'pdf',
            );
            s3PdfUrl = await this.s3Service.uploadPDF(providerPdfBuffer, providerPdfKey);
            console.log(`📤 PDF del proveedor subido a S3: ${s3PdfUrl}`);
          }

          if (!s3PdfUrl) {
            // Si no vino PDF oficial del proveedor, generar PDF interno.

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
              movimientoLotes: {
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
              if (m.movimientoLotes.length > 0) {
                const primerLote = m.movimientoLotes[0]?.lote;
                if (!primerLote) return { ...det, lotes: [] };
                lotesParsed.push({
                  lote: primerLote.lote,
                  fechaVencimiento: primerLote.fechaVencimiento
                    ? new Date(primerLote.fechaVencimiento).toLocaleDateString('es-PE')
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
            clienteTipoDoc: getTipoDocumentoLabel(comp.cliente.tipoDocumento?.codigo),
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
          }

        } catch (s3Error: any) {
          console.error('⚠️ Error subiendo archivos a S3:', s3Error.message);
          // No fallar el proceso si S3 falla, solo loguear
        }
      }

      if (status !== 'ACEPTADO') {
        console.error('❌ SUNAT Full Response:', JSON.stringify(this.sanitizeLogPayload(finalResponse), null, 2));
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
          sunatCdrZip: cdrBase64OrNull || finalResponse?.cdr || null,
          sunatCdrResponse: JSON.stringify(finalResponse),
          sunatErrorMsg:
            estadoFinal !== 'EMITIDO'
              ? (isApisunatProvider(billingProvider)
                ? this.extractApisunatMessage(finalResponse, status)
                : isJambleProvider(billingProvider)
                  ? this.extractJambleMessage(finalResponse, status)
                  : this.extractQpseMessage(finalResponse, status))
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
          comprobanteId,
          serie: comp.serie,
          correlativo: comp.correlativo,
          message: isApisunatProvider(billingProvider)
            ? this.extractApisunatMessage(finalResponse, status) || 'El documento está pendiente de procesamiento por SUNAT.'
            : isJambleProvider(billingProvider)
              ? this.extractJambleMessage(finalResponse, status) || 'El documento está pendiente de procesamiento por SUNAT.'
              : this.extractQpseMessage(finalResponse, status) || 'El documento está pendiente de procesamiento por SUNAT.',
        };
      }

      if (status !== 'ACEPTADO') {
        console.error('❌ SUNAT rechazó el documento:', {
          status,
          error: finalResponse.error,
          fullResponse: this.sanitizeLogPayload(finalResponse),
        });
        const provider = billingProvider;
        const detail = isApisunatProvider(billingProvider)
          ? this.extractApisunatMessage(finalResponse, status)
          : isJambleProvider(billingProvider)
            ? this.extractJambleMessage(finalResponse, status)
            : this.extractQpseMessage(finalResponse, status);

        // Códigos SUNAT permanentemente fatales: eliminar el comprobante de inmediato
        const fatalCode = extractFatalSunatCode(detail);
        if (fatalCode) {
          console.warn(`🗑️ Comprobante ${comprobanteId} → código SUNAT fatal ${fatalCode}: auto-eliminando`);
          throw new SunatPayloadException(
            `Código SUNAT ${fatalCode}: ${detail || 'Error de datos permanente'}`,
          );
        }

        throw new HttpException(
          `${provider} rechazó el documento: ${detail || 'Error desconocido'}`,
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

      return { ...finalResponse, serie: comp.serie, correlativo: comp.correlativo, comprobanteId };
    } catch (err: any) {
      console.error('🚫 Error crítico enviando a SUNAT:', {
        comprobanteId,
        error: err.message,
        response: this.sanitizeLogPayload(err.response?.data),
        status: err.response?.status,
      });

      // Error de datos fatal (código SUNAT irrecuperable): re-lanzar sin guardar estado
      // El controller lo captura como SunatPayloadException y elimina el comprobante.
      if (err instanceof SunatPayloadException) throw err;

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

      // Errores de RED (SUNAT caída, timeout): el comprobante ya quedó guardado
      // y el scheduler reintentará. Devolver 200 con estado PENDIENTE para no confundir al usuario.
      const finalErrorType = this.classifyError(err);
      if (finalErrorType === 'RED') {
        return {
          status: 'PENDIENTE',
          documentId: comprobanteId,
          comprobanteId,
          serie: comp?.serie,
          correlativo: comp?.correlativo,
          message: 'Comprobante registrado correctamente. SUNAT no está disponible en este momento; la confirmación llegará automáticamente cuando el servicio se restablezca.',
        };
      }

      // Errores de DATOS: el usuario debe corregir algo.
      const rawMsg = err.response?.data?.message || err.message || 'Error al enviar a SUNAT';
      throw new HttpException(`Error al emitir el comprobante: ${rawMsg}`, 502);
    }
  }

  private resolveUblRootName(tipoDoc: string): 'Invoice' | 'CreditNote' | 'DebitNote' {
    if (tipoDoc === '07') return 'CreditNote';
    if (tipoDoc === '08') return 'DebitNote';
    return 'Invoice';
  }

  private sanitizeUblNode(node: any): any {
    if (node === null || node === undefined) return undefined;
    if (Array.isArray(node)) {
      const arr = node
        .map((item) => this.sanitizeUblNode(item))
        .filter((item) => item !== undefined);
      return arr.length > 0 ? arr : undefined;
    }
    if (typeof node === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(node)) {
        const sanitized = this.sanitizeUblNode(value);
        if (sanitized !== undefined) {
          result[key] = sanitized;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
    return node;
  }

  private normalizeApisunatStatus(response: any): 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' {
    const status = String(response?.status || '').toUpperCase();
    if (status === 'ACEPTADO') return 'ACEPTADO';
    if (status === 'PENDIENTE') return 'PENDIENTE';
    return 'RECHAZADO';
  }

  private normalizeJambleStatus(response: any): 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' {
    const stateTypeId = String(response?.data?.state_type_id || '').trim();
    const stateLabel = String(response?.data?.state_type_description || response?.state_type_description || '').toLowerCase();
    const message = String(response?.message || response?.data?.message || response?.data?.message_text || '').toLowerCase();
    const numberFull = String(response?.data?.number_full || response?.number_full || '').trim();
    const externalId = String(response?.data?.external_id || response?.external_id || '').trim();
    const code =
      String(
        response?.response?.code ??
          response?.code ??
          response?.data?.code ??
          '',
      ).trim();
    const success = response?.success === true;

    if (
      code === '0' ||
      stateTypeId === '01' ||
      stateTypeId === '05' ||
      stateLabel.includes('registrad') ||
      stateLabel.includes('aceptad') ||
      stateLabel.includes('observad')
    ) {
      return 'ACEPTADO';
    }

    // En JAMBLE/QPOS el alta del comprobante puede ser el flujo final exitoso.
    // Si ya devolvió "registrado con éxito" + IDs, no forzar envío adicional.
    if (
      success &&
      (message.includes('registrado con éxito') || message.includes('registrado con exito')) &&
      (Boolean(numberFull) || Boolean(externalId))
    ) {
      return 'ACEPTADO';
    }

    if (stateLabel.includes('pendient') || stateTypeId === '03' || stateTypeId === '04') {
      return 'PENDIENTE';
    }

    if (!success && (code || stateLabel)) {
      return 'RECHAZADO';
    }

    return success ? 'PENDIENTE' : 'RECHAZADO';
  }

  private buildJamblePayload(
    comp: any,
    loginCtx?: { userId: number | null; establishmentId: number | null } | null,
  ): any {
    const fecha = new Date(comp.fechaEmision || new Date());
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    const HH = String(fecha.getHours()).padStart(2, '0');
    const MM = String(fecha.getMinutes()).padStart(2, '0');
    const SS = String(fecha.getSeconds()).padStart(2, '0');
    const fechaIso = `${yyyy}-${mm}-${dd}`;
    const hora = `${HH}:${MM}:${SS}`;

    const tipoDocIdentidad = comp.cliente?.tipoDocumento?.codigo || '0';
    const numeroDocCliente = comp.cliente?.nroDoc || (tipoDocIdentidad === '6' ? '20100070970' : '99999999');

    const items = (comp.detalles || []).map((item: any) => ({
      codigo_interno: item?.producto?.codigo || item.codigo || null,
      descripcion: item.descripcion,
      codigo_producto_sunat: null,
      unidad_de_medida: item.unidadMedida || item.unidad || 'NIU',
      cantidad: Number(item.cantidad || 0),
      valor_unitario: Number(item.mtoValorUnitario || 0),
      codigo_tipo_precio: '01',
      precio_unitario: Number(item.mtoPrecioUnitario || 0),
      codigo_tipo_afectacion_igv: String(item.tipAfeIgv || '10'),
      total_base_igv: Number(item.mtoBaseIgv || 0),
      porcentaje_igv: Number(item.porcentajeIgv || 18),
      total_igv: Number(item.igv || 0),
      total_impuestos: Number(item.totalImpuestos || item.igv || 0),
      total_valor_item: Number(item.mtoValorVenta || 0),
      total_item: Number((item.mtoPrecioUnitario || 0) * (item.cantidad || 0)),
      datos_adicionales: [],
    }));

    const payload: any = {
      serie_documento: comp.serie,
      // En JAMBLE/QPOS conviene delegar numeración al proveedor para evitar
      // desalineaciones entre correlativo local y correlativo remoto.
      numero_documento: '#',
      fecha_de_emision: fechaIso,
      hora_de_emision: hora,
      fecha_de_vencimiento: fechaIso,
      codigo_tipo_operacion: comp?.tipoOperacion?.codigo || '0101',
      codigo_tipo_documento: comp.tipoDoc,
      codigo_tipo_moneda: comp.tipoMoneda || 'PEN',
      numero_orden_de_compra: null,
      datos_del_cliente_o_receptor: {
        codigo_tipo_documento_identidad: String(tipoDocIdentidad),
        numero_documento: String(numeroDocCliente),
        apellidos_y_nombres_o_razon_social: comp.cliente?.nombre || 'CLIENTES VARIOS',
        codigo_pais: 'PE',
        ubigeo: comp.cliente?.ubigeo || comp.empresa?.ubigeo || '150101',
        direccion: comp.cliente?.direccion || '-',
        correo_electronico: comp.cliente?.email || null,
        telefono: comp.cliente?.celular || null,
      },
      codigo_condicion_de_pago: comp.formaPagoTipo === 'Credito' ? '02' : '01',
      totales: {
        total_exportacion: 0,
        total_operaciones_gravadas: Number(comp.mtoOperGravadas || 0),
        total_operaciones_inafectas: Number(comp.mtoOperInafectas || 0),
        total_operaciones_exoneradas: Number(comp.mtoOperExoneradas || 0),
        total_operaciones_gratuitas: Number(comp.mtoOperGratuitas || 0),
        total_igv: Number(comp.mtoIGV || 0),
        total_impuestos: Number(comp.totalImpuestos || comp.mtoIGV || 0),
        total_valor: Number(comp.valorVenta || comp.mtoOperGravadas || 0),
        total_venta: Number(comp.mtoImpVenta || 0),
      },
      items,
    };

    if (loginCtx?.establishmentId) {
      payload.establishment_id = loginCtx.establishmentId;
    }
    if (loginCtx?.userId) {
      payload.seller_id = loginCtx.userId;
    }

    if (comp.tipoDoc === '07' || comp.tipoDoc === '08') {
      const afectado = this.parseAfectadoReference(comp.numDocAfectado);
      payload.codigo_tipo_nota = String(comp.motivo?.codigo || '01');
      payload.motivo_o_sustento_de_nota = String(
        comp.motivo?.descripcion || comp.motivo?.nombre || 'Error al emitir comprobante',
      );
      payload.documento_afectado = {
        serie_documento: afectado.serie || '',
        numero_documento: afectado.numero || '',
        codigo_tipo_documento: String(comp.tipDocAfectado || ''),
      };

      delete payload.codigo_tipo_operacion;
      delete payload.codigo_condicion_de_pago;
    }

    return payload;
  }

  private parseAfectadoReference(numDocAfectado?: string | null): { serie: string; numero: string } {
    const raw = String(numDocAfectado || '').trim();
    if (!raw) return { serie: '', numero: '' };

    const [serie, ...numeroPartes] = raw.split('-');
    const numeroRaw = numeroPartes.join('-').trim();
    if (!numeroRaw) return { serie: serie?.trim() || '', numero: '' };

    const numeroNormalizado = numeroRaw.replace(/^0+(?=\d)/, '');
    return {
      serie: serie?.trim() || '',
      numero: numeroNormalizado || numeroRaw,
    };
  }

  private parseSerieCorrelativo(numberFull?: string | null): { serie: string; correlativo: number } | null {
    const raw = String(numberFull || '').trim().toUpperCase();
    if (!raw) return null;
    const match = raw.match(/^([A-Z0-9]{1,6})-(\d{1,12})$/);
    if (!match) return null;
    const correlativo = Number(match[2]);
    if (!Number.isFinite(correlativo) || correlativo <= 0) return null;
    return { serie: match[1], correlativo };
  }

  private extractJambleDocumentId(response: any, fallback: string): string {
    const id =
      response?.data?.external_id ||
      response?.data?.id ||
      response?.external_id ||
      response?.id ||
      fallback;
    return String(id);
  }

  private extractJambleInternalId(response: any): string | null {
    const internalId = response?.data?.id ?? response?.id ?? null;
    if (internalId === null || internalId === undefined) return null;
    const text = String(internalId).trim();
    return text || null;
  }

  private summarizeJambleResponse(
    response: any,
    status: 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO',
    documentId?: string | null,
  ): Record<string, any> {
    return {
      status,
      externalId: documentId || this.extractJambleDocumentId(response, ''),
      internalId: this.extractJambleInternalId(response),
      stateTypeId: String(response?.data?.state_type_id || '').trim() || null,
      stateTypeDescription:
        String(response?.data?.state_type_description || response?.state_type_description || '').trim() || null,
      responseCode: String(response?.response?.code ?? response?.code ?? '').trim() || null,
      message: this.extractJambleMessage(response, status),
      hasXml: Boolean(this.extractJambleLink(response, 'xml')),
      hasCdr: Boolean(this.extractJambleLink(response, 'cdr')),
      hasPdf: Boolean(this.extractJambleLink(response, 'pdf')),
      sendSunat: response?.data?.send_sunat ?? null,
    };
  }

  private shouldTriggerJambleSunat(response: any, currentStatus: 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO'): boolean {
    if (currentStatus === 'ACEPTADO') return false;

    // Nuevo comportamiento por defecto: JAMBLE suele completar correctamente en /documents.
    // Solo disparamos /documents/send cuando se habilite explícitamente.
    const forceDispatch = ['1', 'true', 'yes'].includes(String(process.env.JAMBLE_FORCE_DISPATCH || '').toLowerCase());
    if (!forceDispatch) return false;

    const sendSunat = response?.data?.send_sunat;
    if (sendSunat === false) return true;

    const stateTypeId = String(response?.data?.state_type_id || '').trim();
    if (!stateTypeId) return true;

    return currentStatus === 'PENDIENTE';
  }

  private extractJambleLink(response: any, key: 'xml' | 'cdr' | 'pdf' | 'xml_unsigned'): string | null {
    const value = response?.links?.[key];
    if (!value || typeof value !== 'string') return null;
    return value.trim() || null;
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

  private isJambleNumeracionRepetidaError(error: any): boolean {
    const text = JSON.stringify(
      error?.response?.data ||
      error?.message ||
      error ||
      '',
    ).toLowerCase();

    return (
      text.includes('ya se encuentra registrado') ||
      text.includes('documento ya existe') ||
      (text.includes('documento') && text.includes('registrado'))
    );
  }

  private extractJambleSerieCorrelativoFromError(error: any): { serie: string; correlativo: number } | null {
    const text = String(
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      '',
    );

    const match = text.match(/([A-Z]\d{3})-(\d{1,10})/i);
    if (!match) return null;
    const correlativo = Number(match[2]);
    if (Number.isNaN(correlativo)) return null;
    return {
      serie: match[1].toUpperCase(),
      correlativo,
    };
  }

  private isSunatUblVersionError(response: any): boolean {
    const text = JSON.stringify(response || {}).toLowerCase();
    const code = String(response?.code ?? response?.estado ?? '');
    return (
      code === '2074' ||
      text.includes('ublversionid - la versión del ubl no es correcta') ||
      text.includes('ublversionid - la version del ubl no es correcta') ||
      text.includes('nodo: "invoice/cbc:ublversionid"')
    );
  }

  private isSunatCustomizationVersionError(response: any): boolean {
    const text = JSON.stringify(response || {}).toLowerCase();
    const code = String(response?.code ?? response?.estado ?? '');
    return (
      code === '2072' ||
      text.includes('customizationid - la versión del documento no es la correcta') ||
      text.includes('customizationid - la version del documento no es la correcta') ||
      text.includes('nodo: "invoice/cbc:customizationid"')
    );
  }

  private isSunatPaymentDueDateInTermsError(response: any): boolean {
    const text = JSON.stringify(response || {}).toLowerCase();
    return (
      text.includes('paymentterms') &&
      text.includes('paymentduedate') &&
      text.includes('but next item should be end-element')
    );
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

  private extractApisunatMessage(response: any, status?: string): string {
    const faults = Array.isArray(response?.faults) ? response.faults.join(' | ') : response?.faults;
    const notes = Array.isArray(response?.notes) ? response.notes.join(' | ') : response?.notes;
    const errors = Array.isArray(response?.errors) ? response.errors.join(' | ') : response?.errors;
    const nestedError =
      response?.error?.message ||
      response?.error?.descripcion ||
      response?.error?.detail ||
      (typeof response?.error === 'string' ? response.error : null);

    const messages = [
      response?.message,
      nestedError,
      faults,
      notes,
      errors,
    ].filter(Boolean);

    return messages[0] || (status ? `SUNAT devolvió estado: ${status}` : 'Respuesta sin detalle de APISUNAT');
  }

  private extractJambleMessage(response: any, status?: string): string {
    const messages = [
      response?.response?.description,
      response?.message,
      response?.description,
      response?.error?.message,
      response?.error?.descripcion,
      Array.isArray(response?.response?.notes) ? response.response.notes.join(' | ') : response?.response?.notes,
      Array.isArray(response?.errors) ? response.errors.join(' | ') : response?.errors,
    ].filter(Boolean);

    return messages[0] || (status ? `SUNAT devolvió estado: ${status}` : 'Respuesta sin detalle de JAMBLE');
  }

  private sanitizeLogPayload(payload: any): any {
    const LIMIT = 240;
    const HIDDEN_KEYS = new Set([
      'logo',
      'image',
      'imagen',
      'base64',
      'xml',
      'xml_unsigned',
      'cdr',
      'pdf_base64',
      'qr',
    ]);

    const walk = (value: any, key = ''): any => {
      if (value === null || value === undefined) return value;
      if (Array.isArray(value)) return value.map((item) => walk(item));
      if (typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
          out[k] = walk(v, k);
        }
        return out;
      }
      if (typeof value === 'string') {
        const lowerKey = String(key || '').toLowerCase();
        if (HIDDEN_KEYS.has(lowerKey)) {
          return `[hidden:${lowerKey}:len=${value.length}]`;
        }
        if (value.length > LIMIT) {
          return `${value.slice(0, LIMIT)}...[truncated:${value.length - LIMIT}]`;
        }
      }
      return value;
    };

    return walk(payload);
  }

  private async downloadTextFromUrl(url: string): Promise<string> {
    const resp = await axios.get(url, { responseType: 'text', timeout: 30000 });
    return String(resp.data || '');
  }

  private async downloadBinaryAsBase64(url: string): Promise<string> {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(resp.data as any).toString('base64');
  }

  private async downloadBinaryAsBuffer(url: string): Promise<Buffer> {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(resp.data as any);
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
        clienteTipoDoc: getTipoDocumentoLabel(comp.cliente?.tipoDocumento?.codigo),
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
    if (
      msg.includes('qpse rechaz') ||
      msg.includes('apisunat rechaz') ||
      msg.includes('rechazó el documento')
    ) return 'DATOS';

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
        select: {
          usuarioPse: true,
          contrasenaPse: true,
          usaDemo: true,
          providerId: true,
          providerToken: true,
          billingProvider: true,
          billingApiBaseUrl: true,
          billingApiDemoBaseUrl: true,
          billingApiToken: true,
          billingApiUser: true,
          billingApiPassword: true,
        },
      }) as {
        usuarioPse: string | null;
        contrasenaPse: string | null;
        usaDemo: boolean;
        providerId: string | null;
        providerToken: string | null;
        billingProvider: string | null;
        billingApiBaseUrl: string | null;
        billingApiDemoBaseUrl: string | null;
        billingApiToken: string | null;
        billingApiUser: string | null;
        billingApiPassword: string | null;
      } | null;
      const qpseUsername = empresaCreds?.usuarioPse;
      const qpsePassword = empresaCreds?.contrasenaPse;
      const providerId = String(empresaCreds?.providerId || '').trim();
      const providerToken = String(empresaCreds?.providerToken || '').trim();
      const billingProvider = resolveBillingProvider(empresaCreds);
      const usaDemo = empresaCreds?.usaDemo ?? false;
      const jambleBaseUrl = String(
        usaDemo
          ? (empresaCreds?.billingApiDemoBaseUrl || empresaCreds?.billingApiBaseUrl || '')
          : (empresaCreds?.billingApiBaseUrl || ''),
      ).trim();
      const jambleToken = String(empresaCreds?.billingApiToken || '').trim();
      const jambleUser = String(empresaCreds?.billingApiUser || '').trim();
      const jamblePassword = String(empresaCreds?.billingApiPassword || '').trim();

      const comprobante = await this.prisma.comprobante.findFirst({
        where: { empresaId, documentoId: documentId },
        select: { documentoId: true, serie: true, correlativo: true, tipoDoc: true },
      });

      const externalId = comprobante?.documentoId || documentId;
      if (isApisunatProvider(billingProvider)) {
        if (!providerId || !providerToken) {
          throw new HttpException(
            'Proveedor APISUNAT: faltan credenciales. Configura providerId (personaId) y providerToken en la empresa.',
            400,
          );
        }

        console.log(`🚀 Enviando anulación a APISUNAT para el documento: ${externalId}`);
        const response = await this.apisPeruClient.voidBill({
          personaId: providerId,
          personaToken: providerToken,
          documentId: externalId,
          reason: motivo.substring(0, 100),
        });
        return response;
      }

      if (isJambleProvider(billingProvider)) {
        if (!jambleBaseUrl) {
          throw new HttpException('Proveedor JAMBLE: falta URL API para el entorno seleccionado en la empresa.', 400);
        }
        if (!jambleToken && !(jambleUser && jamblePassword)) {
          throw new HttpException(
            'Proveedor JAMBLE: configura billingApiToken o billingApiUser + billingApiPassword en la empresa.',
            400,
          );
        }

        const response = await this.jambleClient.anularDocumento(
          {
            baseUrl: jambleBaseUrl,
            token: jambleToken || null,
            username: jambleUser || null,
            password: jamblePassword || null,
          },
          externalId,
          motivo.substring(0, 100),
        );
        return response;
      }

      if (!qpseUsername || !qpsePassword) {
        throw new HttpException(
          'Credenciales QPSE no configuradas. Configure usuarioPse y contrasenaPse en la empresa.',
          400,
        );
      }

      const qpseAccess = await this.qpseClient.obtenerTokenAcceso({
        username: qpseUsername,
        password: qpsePassword,
        usaDemo,
      });

      console.log(`🚀 Enviando anulación a QPSE para el documento: ${externalId}`);

      const response = await this.qpseClient.anularComprobante({
        accessToken: qpseAccess.token_acceso!,
        externalId,
        motivo: motivo.substring(0, 100),
        usaDemo,
      });

      console.log('✅ Documento anulado en QPSE:', response);
      return response;
    } catch (err: any) {
      console.error('🚫 Error anulando en QPSE:', {
        documentId,
        error: err.response?.data || err.message,
      });
      const empresaCreds = await (this.prisma.empresa as any).findUnique({
        where: { id: empresaId },
        select: { usaDemo: true, billingProvider: true },
      }) as { usaDemo: boolean; billingProvider: string | null } | null;
      const provider = resolveBillingProvider(empresaCreds);
      throw new HttpException(
        `${provider} rechazó la anulación: ${err.response?.data?.message || err.message || 'Error desconocido'}`,
        502,
      );
    }
  }

  private extractHost(url: string | null | undefined): string | null {
    const raw = String(url || '').trim();
    if (!raw) return null;
    try {
      return new URL(raw).host || null;
    } catch {
      return raw.replace(/^https?:\/\//i, '').split('/')[0] || null;
    }
  }

  private maskJambleUser(user: string | null | undefined): string | null {
    const raw = String(user || '').trim();
    if (!raw) return null;
    const at = raw.indexOf('@');
    if (at > 1) {
      return `${raw.slice(0, 2)}***${raw.slice(at - 1)}`;
    }
    if (raw.length <= 3) return `${raw[0]}**`;
    return `${raw.slice(0, 2)}***${raw.slice(-1)}`;
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
