import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SunatGuiaService {
    private readonly logger = new Logger(SunatGuiaService.name);
    private readonly apiUrl = 'https://back.apisunat.com/personas/v1/sendBill';
    private readonly documentUrl = 'https://back.apisunat.com/documents';
    private readonly maxRetries = 3;
    private readonly retryInterval = 3000;

    constructor(private configService: ConfigService) { }

    async enviarGuia(guia: any, personaId: string, personaToken: string) {
        try {
            // Determinar código de tipo de documento según tipoGuia
            // GRE-R (Remitente) = 09, GRE-T (Transportista) = 31
            const tipoDocCodigo = guia.tipoGuia === 'TRANSPORTISTA' ? '31' : '09';
            
            // Construir el documento en formato UBL para SUNAT
            const documentBody = this.buildSunatDocument(guia, tipoDocCodigo);

            // Construir el fileName según formato SUNAT: RUC-TipoDoc-Serie-Correlativo
            // APISUNAT valida que el RUC del fileName pertenezca al proveedor asociado (empresa remitente)
            // incluso cuando la guía es de tipo TRANSPORTISTA, por lo que usamos siempre el RUC del remitente
            const rucEmisor = guia.remitenteRuc;
            const fileName = `${rucEmisor}-${tipoDocCodigo}-${guia.serie}-${String(guia.correlativo).padStart(8, '0')}`;

            const payload = {
                personaId,
                personaToken,
                fileName,
                documentBody,
            };

            this.logger.log(`Enviando guía de remisión ${fileName} a SUNAT (APISUNAT)`);
            const payloadForLog = {
                personaId,
                fileName,
                documentBody,
            };
            this.logger.debug(`Payload APISUNAT (sin token): ${JSON.stringify(payloadForLog)}`);

            // 1. Enviar documento a APISUNAT
            const initialResponse = await axios.post(this.apiUrl, payload);

            if (!initialResponse.data.documentId) {
                throw new Error('No se recibió documentId de la respuesta de APISUNAT');
            }

            const documentId = initialResponse.data.documentId;
            let status = initialResponse.data.status;
            let retries = 0;
            let finalResponse;

            this.logger.log(`Documento enviado. ID: ${documentId}. Estado inicial: ${status}. Iniciando polling...`);

            // 2. Polling para verificar estado
            while (status === 'PENDIENTE' && retries < this.maxRetries) {
                await new Promise((r) => setTimeout(r, this.retryInterval));

                const statusResponse = await axios.get(
                    `${this.documentUrl}/${documentId}/getById?data=true`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${personaToken}`,
                        },
                    }
                );

                finalResponse = statusResponse.data;
                status = finalResponse.status;
                retries++;
                this.logger.log(`Polling intento ${retries}: Estado ${status}`);
            }

            // Si después de reintentos sigue pendiente (o se resolvió)
            if (!finalResponse) {
                // Si salió del bucle sin finalResponse (raro, solo si maxRetries=0 y status=PENDIENTE inicial)
                // obtener estado final una ves más
                const statusResponse = await axios.get(
                    `${this.documentUrl}/${documentId}/getById?data=true`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${personaToken}`,
                        },
                    }
                );
                finalResponse = statusResponse.data;
                status = finalResponse.status;
            }

            // 3. Procesar respuesta final
            const success = status === 'ACEPTADO';
            const providerError = success ? null : this.extractProviderError(finalResponse, status);

            // Extract PDF URL if available
            const pdfUrl = finalResponse?.pdf?.A4 || finalResponse?.pdf?.['80mm'] || null;

            return {
                success,
                xml: finalResponse.xml || null,
                cdrResponse: JSON.stringify(finalResponse),
                cdrZip: finalResponse.cdr || null,
                documentoId: documentId,
                message: success ? 'Guía de remisión aceptada por SUNAT' : `Rechazado por SUNAT: ${providerError}`,
                s3XmlUrl: null,
                s3CdrUrl: null,
                s3PdfUrl: pdfUrl,
                error: providerError,
            };

        } catch (error) {
            this.logger.error(`Error al enviar guía a SUNAT: ${error.message}`, error.stack);
            if (error.response?.data) {
                this.logger.error(`Respuesta APISUNAT error.data: ${JSON.stringify(error.response.data)}`);
            }

            // Manejo de errores de axios
            const errorMsg = error.response?.data?.message || error.message || 'Error desconocido al conectar con APISUNAT';

            return {
                success: false,
                xml: null,
                cdrResponse: null,
                cdrZip: null,
                documentoId: null,
                message: 'Error de conexión o validación con SUNAT provider',
                s3XmlUrl: null,
                s3CdrUrl: null,
                error: errorMsg,
            };
        }
    }

    private buildSunatDocument(guia: any, tipoDocCodigo: string): any {
        // Helper para limpiar unidades (UN/ECE Rec 20)
        const cleanUnit = (u: string) => {
            if (!u) return 'NIU';
            const unit = u.toUpperCase();
            if (unit === 'UNIDAD' || unit === 'UND') return 'NIU';
            if (unit === 'KILOS' || unit === 'KG') return 'KGM';
            return unit;
        };

        const normalizeAddressTypeCode = (value: any) => {
            const code = String(value || '').trim();
            return code || '0000';
        };

        const isCompra = guia.tipoTraslado === '02';
        const remitenteRuc = String(guia.remitenteRuc || '').trim();
        const destinatarioRuc =
            String(guia.destinatarioTipoDoc || '') === '6'
                ? String(guia.destinatarioNumDoc || '').trim()
                : '';

        const partidaListId = isCompra ? (destinatarioRuc || remitenteRuc) : remitenteRuc;
        const llegadaListId = isCompra ? remitenteRuc : (destinatarioRuc || remitenteRuc);

        const buildParty = (tipoDoc: string, numDoc: string, razonSocial: string, direccion?: string) => {
            const party: any = {
                'cac:Party': {
                    'cac:PartyIdentification': {
                        'cbc:ID': {
                            _attributes: { schemeID: this.getTipoDocumentoSchemeId(tipoDoc) },
                            _text: numDoc,
                        },
                    },
                    'cac:PartyLegalEntity': {
                        'cbc:RegistrationName': {
                            _text: razonSocial,
                        },
                    },
                },
            };

            if (direccion) {
                party['cac:Party']['cac:PartyLegalEntity']['cac:RegistrationAddress'] = {
                    'cac:AddressLine': {
                        'cbc:Line': {
                            _text: direccion,
                        },
                    },
                };
            }

            return party;
        };

        const resolveDocType = (doc: string, fallback: string = '6') => {
            const clean = String(doc || '').trim();
            if (/^\d{8}$/.test(clean)) return '1';
            if (/^\d{11}$/.test(clean)) return '6';
            return fallback;
        };

        // Construir el documento según la estructura UBL 2.1 requerida por SUNAT
        // GRE-R (09) vs GRE-T (31) tienen estructuras diferentes
        const doc: any = {
            'cbc:UBLVersionID': { _text: '2.1' },
            'cbc:CustomizationID': { _text: '2.0' },
            'cbc:ID': { _text: `${guia.serie}-${String(guia.correlativo).padStart(8, '0')}` },
            'cbc:IssueDate': { _text: this.formatDate(guia.fechaEmision) },
            'cbc:IssueTime': { _text: guia.horaEmision || '00:00:00' },
            'cbc:DespatchAdviceTypeCode': { _text: tipoDocCodigo },

            // DespatchSupplierParty: Siempre corresponde a la empresa remitente (RUC asociado al proveedor)
            'cac:DespatchSupplierParty': this.buildDespatchSupplierParty(guia),

            // Destinatario (DeliveryCustomerParty)
            // Caso compra (tipoTraslado 04): el destinatario debe ser la empresa (remitente)
            'cac:DeliveryCustomerParty':
                tipoDocCodigo === '31'
                    ? buildParty(resolveDocType(guia.transportistaRuc), guia.transportistaRuc, guia.transportistaRazonSocial)
                    : isCompra
                        ? buildParty('6', guia.remitenteRuc, guia.remitenteRazonSocial)
                        : buildParty(guia.destinatarioTipoDoc, guia.destinatarioNumDoc, guia.destinatarioRazonSocial),

            // Caso compra (tipoTraslado 04): agregar proveedor (SellerSupplierParty)
            ...(isCompra
                ? {
                      'cac:SellerSupplierParty': buildParty(
                          guia.destinatarioTipoDoc,
                          guia.destinatarioNumDoc,
                          guia.destinatarioRazonSocial,
                      ),
                  }
                : {}),

            // Shipment
            'cac:Shipment': {
                'cbc:ID': { _text: 'SUNAT_Envio' },
                // GRE-R (09) incluye HandlingCode y SpecialInstructions; GRE-T (31) no los admite
                ...(tipoDocCodigo !== '31'
                    ? {
                          'cbc:HandlingCode': { _text: guia.tipoTraslado },
                      }
                    : {}),
                'cbc:GrossWeightMeasure': {
                    _attributes: { unitCode: cleanUnit(guia.unidadPeso) || 'KGM' },
                    _text: Number(guia.pesoTotal),
                },
                ...((() => {
                    const si = tipoDocCodigo !== '31' ? this.buildSpecialInstructions(guia) : [];
                    return si.length > 0 ? { 'cbc:SpecialInstructions': si } : {};
                })()),
                'cac:ShipmentStage': this.buildShipmentStage(guia, tipoDocCodigo),
                'cac:Delivery': {
                    'cac:DeliveryAddress': {
                        'cbc:ID': { _text: guia.llegadaUbigeo },
                        // GRE-T no admite AddressTypeCode en las direcciones
                        ...(tipoDocCodigo !== '31'
                            ? {
                                  'cbc:AddressTypeCode': {
                                      _attributes: { listID: llegadaListId },
                                      _text: normalizeAddressTypeCode(guia.llegadaCodigoEstablecimiento),
                                  },
                              }
                            : {}),
                        'cac:AddressLine': {
                            'cbc:Line': { _text: guia.llegadaDireccion },
                        },
                    },
                    'cac:Despatch': {
                        'cac:DespatchAddress': {
                            'cbc:ID': { _text: guia.partidaUbigeo },
                            ...(tipoDocCodigo !== '31'
                                ? {
                                      'cbc:AddressTypeCode': {
                                          _attributes: { listID: partidaListId },
                                          _text: normalizeAddressTypeCode(guia.partidaCodigoEstablecimiento),
                                      },
                                  }
                                : {}),
                            'cac:AddressLine': {
                                'cbc:Line': { _text: guia.partidaDireccion },
                            },
                        },
                        ...(tipoDocCodigo === '31'
                            ? {
                                  'cac:DespatchParty': buildParty(
                                      guia.destinatarioTipoDoc,
                                      guia.destinatarioNumDoc,
                                      guia.destinatarioRazonSocial,
                                  )['cac:Party'],
                              }
                            : {}),
                    },
                },
                ...(tipoDocCodigo === '31'
                    ? {
                          'cac:TransportHandlingUnit': this.buildTransportHandlingUnit(guia),
                      }
                    : {}),
            },

            // Líneas de detalle
            'cac:DespatchLine': guia.detalles.map((detalle, index) => ({
                'cbc:ID': { _text: index + 1 },
                'cbc:DeliveredQuantity': {
                    _attributes: { unitCode: cleanUnit(detalle.unidadMedida) },
                    _text: Number(detalle.cantidad),
                },
                'cac:OrderLineReference': {
                    'cbc:LineID': { _text: index + 1 },
                },
                'cac:Item': {
                    'cbc:Description': { _text: detalle.descripcion },
                },
            })),
        };

        return doc;
    }

    private buildDespatchSupplierParty(guia: any): any {
        return {
            'cac:Party': {
                'cac:PartyIdentification': {
                    'cbc:ID': {
                        _attributes: { schemeID: '6' },
                        _text: guia.remitenteRuc,
                    },
                },
                'cac:PartyLegalEntity': {
                    'cbc:RegistrationName': {
                        _text: guia.remitenteRazonSocial,
                    },
                    'cac:RegistrationAddress': {
                        'cac:AddressLine': {
                            'cbc:Line': {
                                _text: guia.remitenteDireccion,
                            },
                        },
                    },
                },
            },
        };
    }

    private buildSpecialInstructions(guia: any): any[] {
        const instructions: Array<{ _text: string }> = [];

        if (guia.transbordoProgramado) {
            instructions.push({ _text: 'SUNAT_Envio_IndicadorTransbordoProgramado' });
        }

        if (guia.retornoVehiculoVacio) {
            instructions.push({ _text: 'SUNAT_Envio_IndicadorRetornoVehiculoVacio' });
        }

        if (guia.retornoEnvasesVacios) {
            instructions.push({ _text: 'SUNAT_Envio_IndicadorRetornoEnvasesVacios' });
        }

        return instructions;
    }

    private buildShipmentStage(guia: any, tipoDocCodigo: string): any {
        const stage: any = {
            // GRE-T (31) no incluye TransportModeCode en ShipmentStage
            ...(tipoDocCodigo !== '31'
                ? { 'cbc:TransportModeCode': { _text: guia.modoTransporte } }
                : {}),
            'cac:TransitPeriod': {
                'cbc:StartDate': { _text: this.formatDate(guia.fechaInicioTraslado) },
            },
        };

        const includeCarrierParty = (guia.modoTransporte === '01' || tipoDocCodigo === '31') && guia.transportistaRuc;

        // Si es transporte público o guía transportista (31), agregar datos del transportista
        if (includeCarrierParty) {
            const carrierSchemeId = (() => {
                const doc = String(guia.transportistaRuc || '').trim();
                // RUC Perú: 11 dígitos
                if (/^\d{11}$/.test(doc)) return '6';
                return this.getTipoDocumentoSchemeId('1');
            })();

            stage['cac:CarrierParty'] = {
                'cac:PartyIdentification': {
                    'cbc:ID': {
                        _attributes: { schemeID: carrierSchemeId },
                        _text: guia.transportistaRuc,
                    },
                },
                'cac:PartyLegalEntity': {
                    'cbc:RegistrationName': {
                        _text: guia.transportistaRazonSocial,
                    },
                },
            };

            if (guia.transportistaMTC) {
                stage['cac:CarrierParty']['cac:PartyLegalEntity']['cbc:CompanyID'] = {
                    _text: guia.transportistaMTC,
                };
            }
        }

        const includeDriverData = guia.modoTransporte === '02' || tipoDocCodigo === '31';

        // Si es transporte privado o guía transportista, agregar datos del conductor
        if (includeDriverData && guia.conductorNumDoc) {
            const firstName = String(guia.conductorNombre || '').trim();
            const familyName = String(guia.conductorApellidos || '').trim();

            stage['cac:DriverPerson'] = [
                {
                    'cbc:ID': {
                        _attributes: { schemeID: this.getTipoDocumentoSchemeId(guia.conductorTipoDoc || '1') },
                        _text: guia.conductorNumDoc,
                    },
                    'cbc:FirstName': { _text: firstName },
                    ...(familyName ? { 'cbc:FamilyName': { _text: familyName } } : {}),
                    'cbc:JobTitle': { _text: 'Principal' },
                    'cac:IdentityDocumentReference': {
                        'cbc:ID': { _text: guia.conductorLicencia || '' },
                    },
                },
            ];
        }

        // En transporte privado se mantiene la estructura RoadTransport
        if (guia.modoTransporte === '02' && guia.vehiculoPlaca) {
            stage['cac:TransportMeans'] = {
                'cac:RoadTransport': {
                    'cbc:LicensePlateID': { _text: guia.vehiculoPlaca },
                },
            };
        }

        return stage;
    }

    private buildTransportHandlingUnit(guia: any): any {
        const placa = String(guia.vehiculoPlaca || '').trim();
        const autorizacion = String(guia.vehiculoAutorizacion || '').trim();

        if (!placa && !autorizacion) {
            return undefined;
        }

        return {
            'cac:TransportEquipment': {
                ...(placa ? { 'cbc:ID': { _text: placa } } : {}),
                ...(autorizacion
                    ? {
                          'cac:ApplicableTransportMeans': {
                              'cbc:RegistrationNationalityID': {
                                  _text: autorizacion,
                              },
                          },
                      }
                    : {}),
            },
        };
    }

    private getTipoDocumentoSchemeId(tipoDoc: string): string {
        const map = {
            '1': '1', // DNI
            '6': '6', // RUC
            '4': '4', // Carnet de Extranjería
            '7': '7', // Pasaporte
        };
        return map[tipoDoc] || '1';
    }

    private formatDate(date: Date | string): string {
        if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return date;
        }

        const d = new Date(date);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private extractProviderError(finalResponse: any, status?: string): string {
        const explicitError = finalResponse?.error?.message;
        if (explicitError) return explicitError;

        const firstFault = finalResponse?.faults?.[0];
        if (firstFault?.desError && firstFault?.numError) {
            return `${firstFault.desError} (Código ${firstFault.numError})`;
        }

        if (firstFault?.desError) return firstFault.desError;
        if (firstFault?.numError) return `Código SUNAT/APISUNAT: ${firstFault.numError}`;

        if (status) return `SUNAT devolvió estado: ${status}`;
        return 'Error desconocido';
    }

    private generateMockXml(guia: any): string {
        // Generar un XML de ejemplo (en producción, esto se generaría correctamente)
        return `<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2">
  <UBLVersionID>2.1</UBLVersionID>
  <ID>${guia.serie}-${String(guia.correlativo).padStart(8, '0')}</ID>
</DespatchAdvice>`;
    }
}
