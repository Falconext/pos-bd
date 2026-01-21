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
            // Construir el documento en formato UBL para SUNAT
            const documentBody = this.buildSunatDocument(guia);

            // Construir el fileName según formato SUNAT: RUC-TipoDoc-Serie-Correlativo
            const fileName = `${guia.remitenteRuc}-09-${guia.serie}-${String(guia.correlativo).padStart(8, '0')}`;

            const payload = {
                personaId,
                personaToken,
                fileName,
                documentBody,
            };

            this.logger.log(`Enviando guía de remisión ${fileName} a SUNAT (APISUNAT)`);

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

            // Extract PDF URL if available
            const pdfUrl = finalResponse?.pdf?.A4 || finalResponse?.pdf?.['80mm'] || null;

            return {
                success,
                xml: finalResponse.xml || null,
                cdrResponse: JSON.stringify(finalResponse),
                cdrZip: finalResponse.cdr || null,
                documentoId: documentId,
                message: success ? 'Guía de remisión aceptada por SUNAT' : `Rechazado por SUNAT: ${finalResponse.error?.message || 'Error desconocido'}`,
                s3XmlUrl: null,
                s3CdrUrl: null,
                s3PdfUrl: pdfUrl,
                error: success ? null : (finalResponse.error?.message || 'Error desconocido'),
            };

        } catch (error) {
            this.logger.error(`Error al enviar guía a SUNAT: ${error.message}`, error.stack);

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

    private buildSunatDocument(guia: any): any {
        // Helper para limpiar unidades (UN/ECE Rec 20)
        const cleanUnit = (u: string) => {
            if (!u) return 'NIU';
            const unit = u.toUpperCase();
            if (unit === 'UNIDAD' || unit === 'UND') return 'NIU';
            if (unit === 'KILOS' || unit === 'KG') return 'KGM';
            return unit;
        };

        // Construir el documento según la estructura UBL 2.1 requerida por SUNAT (Formato estricto)
        const doc: any = {
            'cbc:UBLVersionID': { _text: '2.1' },
            'cbc:CustomizationID': { _text: '2.0' },
            'cbc:ID': { _text: `${guia.serie}-${String(guia.correlativo).padStart(8, '0')}` },
            'cbc:IssueDate': { _text: this.formatDate(guia.fechaEmision) },
            'cbc:IssueTime': { _text: guia.horaEmision || '00:00:00' },
            'cbc:DespatchAdviceTypeCode': { _text: '09' },

            // Remitente (DespatchSupplierParty)
            'cac:DespatchSupplierParty': {
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
            },

            // Destinatario (DeliveryCustomerParty)
            'cac:DeliveryCustomerParty': {
                'cac:Party': {
                    'cac:PartyIdentification': {
                        'cbc:ID': {
                            _attributes: { schemeID: this.getTipoDocumentoSchemeId(guia.destinatarioTipoDoc) },
                            _text: guia.destinatarioNumDoc,
                        },
                    },
                    'cac:PartyLegalEntity': {
                        'cbc:RegistrationName': {
                            _text: guia.destinatarioRazonSocial,
                        },
                    },
                },
            },

            // Shipment
            'cac:Shipment': {
                'cbc:ID': { _text: 'SUNAT_Envio' },
                'cbc:HandlingCode': { _text: guia.tipoTraslado },
                'cbc:GrossWeightMeasure': {
                    _attributes: { unitCode: cleanUnit(guia.unidadPeso) || 'KGM' },
                    _text: Number(guia.pesoTotal),
                },
                'cac:ShipmentStage': this.buildShipmentStage(guia),
                'cac:Delivery': {
                    'cac:DeliveryAddress': {
                        'cbc:ID': { _text: guia.llegadaUbigeo },
                        'cac:AddressLine': {
                            'cbc:Line': { _text: guia.llegadaDireccion },
                        },
                    },
                    'cac:Despatch': {
                        'cac:DespatchAddress': {
                            'cbc:ID': { _text: guia.partidaUbigeo },
                            'cac:AddressLine': {
                                'cbc:Line': { _text: guia.partidaDireccion },
                            },
                        },
                    },
                },
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

        return instructions.length > 0 ? instructions : [{ _text: 'SUNAT_Envio' }];
    }

    private buildShipmentStage(guia: any): any {
        const stage: any = {
            'cbc:TransportModeCode': { _text: guia.modoTransporte },
            'cac:TransitPeriod': {
                'cbc:StartDate': { _text: this.formatDate(guia.fechaInicioTraslado) },
            },
        };

        // Si es transporte público (01), agregar datos del transportista
        if (guia.modoTransporte === '01' && guia.transportistaRuc) {
            stage['cac:CarrierParty'] = {
                'cac:PartyIdentification': {
                    'cbc:ID': {
                        _attributes: { schemeID: '6' },
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

        // Si es transporte privado (02), agregar datos del conductor y vehículo
        if (guia.modoTransporte === '02') {
            if (guia.conductorNumDoc) {
                stage['cac:DriverPerson'] = {
                    'cbc:ID': {
                        _attributes: { schemeID: this.getTipoDocumentoSchemeId(guia.conductorTipoDoc || '1') },
                        _text: guia.conductorNumDoc,
                    },
                    'cbc:FirstName': { _text: guia.conductorNombre || '' },
                    'cac:IdentityDocumentReference': {
                        'cbc:ID': { _text: guia.conductorLicencia || '' },
                    },
                };
            }

            if (guia.vehiculoPlaca) {
                stage['cac:TransportMeans'] = {
                    'cac:RoadTransport': {
                        'cbc:LicensePlateID': { _text: guia.vehiculoPlaca },
                    },
                };
            }
        }

        return stage;
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
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
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
