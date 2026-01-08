import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { numeroALetras } from './utils/numero-a-letras';
import axios from 'axios';


@Injectable()
export class EnviarSunatService {
  private readonly apiUrl = 'https://back.apisunat.com/personas/v1/sendBill';
  private readonly documentUrl = 'https://back.apisunat.com/documents';
  private readonly maxRetries = 3;
  private readonly retryInterval = 3000;

  // Retry configuration: max 5 hours window with 10 attempts
  private readonly maxRetryAttempts = 10;
  private readonly maxRetryHours = 5;

  // Debug: Set to true to simulate SUNAT failure for testing
  public simulateSunatFailure = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly pdfGenerator: PdfGeneratorService,
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

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: comp.empresaId },
      select: { providerToken: true, providerId: true, ruc: true },
    });

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

      payload = {
        personaId: empresa?.providerId,
        personaToken: empresa?.providerToken,
        fileName,
        documentBody: {
          'cbc:UBLVersionID': { _text: '2.1' },
          'cbc:CustomizationID': { _text: '2.0' },
          'cbc:ID': { _text: `${comp.serie}-${paddedCorrelativo}` },
          'cbc:IssueDate': { _text: issueDate },
          'cbc:IssueTime': { _text: issueTime },
          'cbc:InvoiceTypeCode': {
            _attributes: {
              listID: comp.tipoDetraccionId ? '1001' : (comp.tipoOperacion?.codigo || '0101')
            },
            _text: comp.tipoDoc,
          },
          'cbc:DocumentCurrencyCode': { _text: comp.tipoMoneda },
          'cbc:Note': [
            ...comp.leyendas.map((l: any) => ({
              _text: l.value,
              _attributes: { languageLocaleID: '1000' },
            })),
            ...(comp.tipoDetraccionId ? [{
              _text: 'OPERACIÓN SUJETA A DETRACCIÓN',
              _attributes: { languageLocaleID: '2006' },
            }] : []),
            // Nota para retención 3% (cuando NO es detracción pero hay monto de retención)
            ...(!comp.tipoDetraccionId && comp.montoDetraccion && comp.porcentajeDetraccion ? [{
              _text: 'OPERACIÓN SUJETA A RETENCIÓN DEL 3%',
              _attributes: { languageLocaleID: '2006' },
            }] : [])
          ],
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
          // AllowanceCharge para Retención 3% (cuando NO es detracción pero hay monto de retención)
          ...(!comp.tipoDetraccionId && comp.montoDetraccion && comp.porcentajeDetraccion ? [{
            'cac:AllowanceCharge': [{
              'cbc:ChargeIndicator': { _text: 'false' },
              'cbc:AllowanceChargeReasonCode': { _text: '62' }, // Código 62 = Retención
              'cbc:MultiplierFactorNumeric': { _text: Number((comp.porcentajeDetraccion / 100).toFixed(4)) },
              'cbc:Amount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: Number(Number(comp.montoDetraccion).toFixed(2)),
              },
              'cbc:BaseAmount': {
                _attributes: { currencyID: comp.tipoMoneda },
                _text: comp.mtoImpVenta,
              },
            }],
          }] : []).reduce((acc, curr) => ({ ...acc, ...curr }), {}),
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

        // Agregar Signature requerido para notas de crédito
        payload.documentBody['cac:Signature'] = {
          'cbc:ID': { _text: 'APISUNAT' },
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
              'cbc:URI': { _text: 'https://apisunat.com/' },
            },
          },
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

        delete payload.documentBody['cac:InvoiceLine'];
      }
      if (comp.tipoDoc === '08') {
        delete payload.documentBody['cbc:InvoiceTypeCode'];
        payload.documentBody['cac:DebitNoteLine'] =
          payload.documentBody['cac:InvoiceLine'];
        delete payload.documentBody['cac:InvoiceLine'];
        delete payload.documentBody['cac:LegalMonetaryTotal'];
        payload.documentBody['cac:RequestedMonetaryTotal'] = {
          'cbc:PayableAmount': {
            _attributes: { currencyID: comp.tipoMoneda },
            _text: comp.mtoImpVenta,
          },
        };
      }
    } catch (err) {
      throw new HttpException('Error armando payload para APISUNAT', 500);
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

      const initialResponse = await axios.post(`${this.apiUrl}`, payload);

      console.log('📥 Respuesta inicial de SUNAT:', {
        status: initialResponse.status,
        data: initialResponse.data,
      });

      const documentId = initialResponse.data.documentId;
      if (!documentId) {
        console.error('❌ Error: No se recibió documentId de SUNAT');
        throw new HttpException(
          'No se recibió documentId en la respuesta inicial',
          500,
        );
      }

      await this.prisma.comprobante.update({
        where: { id: comprobanteId },
        data: { documentoId: documentId, estadoEnvioSunat: 'PENDIENTE' },
      });

      let retries = 0;
      let status = initialResponse.data.status;

      console.log(`🔄 Estado inicial: ${status}, iniciando polling...`);

      while (status === 'PENDIENTE' && retries < this.maxRetries) {
        await new Promise((r) => setTimeout(r, this.retryInterval));

        console.log(
          `🔍 Consultando estado (intento ${retries + 1}/${this.maxRetries})...`,
        );

        const statusResponse = await axios.get(
          `${this.documentUrl}/${documentId}/getById?data=true`,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${empresa?.providerToken}`,
            },
          },
        );

        finalResponse = statusResponse.data;
        status = finalResponse.status;
        retries++;

        console.log(`📊 Estado actual: ${status}`, {
          intento: retries,
          response: finalResponse,
        });
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

          // Detectar MIME del logo
          const detectMime = (b64?: string) => {
            if (!b64) return undefined;
            if (b64.startsWith('data:')) return undefined;
            if (b64.startsWith('/9j/')) return 'image/jpeg';
            if (b64.startsWith('iVBOR')) return 'image/png';
            return 'image/png';
          };

          const rawLogo = comp.empresa.logo || null;
          const mime = detectMime(rawLogo || undefined);
          const logoDataUrl = rawLogo
            ? (rawLogo.startsWith('data:') ? rawLogo : `data:${mime};base64,${rawLogo}`)
            : undefined;

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
            qrCode: finalResponse.data?.qr?.qrCode ? `data:image/png;base64,${finalResponse.data.qr.qrCode}` : undefined,
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

          // Nota: Por solicitud, NO se sube XML ni CDR a S3 en esta etapa
        } catch (s3Error) {
          console.error('⚠️ Error subiendo archivos a S3:', s3Error.message);
          // No fallar el proceso si S3 falla, solo loguear
        }
      }

      if (status !== 'ACEPTADO') {
        console.error("❌ SUNAT Full Response:", JSON.stringify(finalResponse, null, 2));
      }

      await this.prisma.comprobante.update({
        where: { id: comprobanteId },
        data: {
          estadoEnvioSunat: status === 'ACEPTADO' ? 'EMITIDO' : 'PENDIENTE',
          sunatXml: finalResponse.xml || null,
          sunatCdrZip: finalResponse.cdr || null,
          sunatCdrResponse: JSON.stringify(finalResponse),
          sunatErrorMsg:
            status !== 'ACEPTADO'
              ? finalResponse.error?.message || 'Error desconocido'
              : null,
          s3PdfUrl,
        },
      });

      if (status === 'PENDIENTE') {
        console.log('⚠️ Documento queda PENDIENTE después del polling');
        return {
          status: 'PENDIENTE',
          documentId,
          message: 'El documento está pendiente de procesamiento por SUNAT.',
        };
      }

      if (status !== 'ACEPTADO') {
        console.error('❌ SUNAT rechazó el documento:', {
          status,
          error: finalResponse.error,
          fullResponse: finalResponse,
        });
        throw new HttpException(
          `APISUNAT rechazó el documento: ${finalResponse.error?.message || 'Error desconocido'}`,
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

      // Persist FALLIDO_ENVIO state so scheduler can retry later
      try {
        const currentComp = await this.prisma.comprobante.findUnique({
          where: { id: comprobanteId },
          select: { sunatRetriesCount: true, creadoEn: true },
        });

        if (currentComp) {
          const newRetryCount = (currentComp.sunatRetriesCount || 0) + 1;
          const isExpired = this.isRetryWindowExpired(currentComp);

          // If within 5-hour window and under max attempts, mark for retry
          if (!isExpired && newRetryCount < this.maxRetryAttempts) {
            await this.prisma.comprobante.update({
              where: { id: comprobanteId },
              data: {
                estadoEnvioSunat: 'FALLIDO_ENVIO',
                sunatRetriesCount: newRetryCount,
                sunatLastRetryAt: new Date(),
                sunatNextRetryAt: this.calculateNextRetry(newRetryCount),
                sunatErrorMsg: `Error de conexión (intento ${newRetryCount}): ${err.message}`,
              },
            });
            console.log(`📅 Comprobante ${comprobanteId} marcado para reintento #${newRetryCount}`);
          } else {
            // Exceeded retry window or max attempts, mark as permanently failed
            await this.prisma.comprobante.update({
              where: { id: comprobanteId },
              data: {
                estadoEnvioSunat: 'RECHAZADO',
                sunatErrorMsg: `Envío fallido después de ${newRetryCount} intentos en ${this.maxRetryHours}h: ${err.message}`,
              },
            });
            console.log(`❌ Comprobante ${comprobanteId} marcado como RECHAZADO (agotó reintentos)`);
          }
        }
      } catch (dbErr) {
        console.error('Error guardando estado de fallo:', dbErr);
      }

      throw new HttpException(
        `Error enviando a APISUNAT: ${err.response?.data?.message || err.message}`,
        502,
      );
    }
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

      const detectMime = (b64?: string) => {
        if (!b64) return undefined;
        if (b64.startsWith('data:')) return undefined;
        if (b64.startsWith('/9j/')) return 'image/jpeg';
        if (b64.startsWith('iVBOR')) return 'image/png';
        return 'image/png';
      };

      const rawLogo = (comp.empresa as any).logo || null;
      const mime = detectMime(rawLogo || undefined);
      const logoDataUrl = rawLogo
        ? (rawLogo.startsWith('data:') ? rawLogo : `data:${mime};base64,${rawLogo}`)
        : undefined;

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
            // Si es informal, también cambiar estado de pago
            ...(['TICKET', 'NV', 'RH', 'CP', 'NP', 'OT'].includes(
              comprobanteAfectado.tipoDoc,
            )
              ? { estadoPago: 'ANULADO', saldo: 0 }
              : {}),
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
   */
  isRetryWindowExpired(comprobante: any): boolean {
    const createdAt = new Date(comprobante.creadoEn);
    const maxRetryTime = new Date(createdAt.getTime() + (this.maxRetryHours * 60 * 60 * 1000));
    return new Date() > maxRetryTime;
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
