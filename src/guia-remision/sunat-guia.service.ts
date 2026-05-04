import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SunatGuiaService {
    private readonly logger = new Logger(SunatGuiaService.name);
    private readonly apiUrl = 'https://back.apisunat.com/personas/v1/sendBill';
    private readonly documentUrl = 'https://back.apisunat.com/documents';
    private readonly maxRetries = 15;
    private readonly retryInterval = 5000;

    constructor(private configService: ConfigService) { }

    async enviarGuia(guia: any, personaId: string, personaToken: string) {
        try {
            const tipoDocCodigo = guia.tipoGuia === 'TRANSPORTISTA' ? '31' : '09';
            const documentBody = this.buildSunatDocument(guia, tipoDocCodigo);

            // APISUNAT valida que el RUC del fileName sea el del proveedor asociado.
            // Para GRE-T el emisor del documento sigue siendo el remitente (empresa).
            const rucEmisor = guia.remitenteRuc;
            const fileName = `${rucEmisor}-${tipoDocCodigo}-${guia.serie}-${String(guia.correlativo).padStart(8, '0')}`;

            const payload = { personaId, personaToken, fileName, documentBody };

            this.logger.log(`Enviando guía ${fileName} a SUNAT`);
            this.logger.debug(`Payload (sin token): ${JSON.stringify({ personaId, fileName, documentBody })}`);

            const initialResponse = await axios.post(this.apiUrl, payload);

            if (!initialResponse.data.documentId) {
                throw new Error('No se recibió documentId de APISUNAT');
            }

            const documentId = initialResponse.data.documentId;
            let status = initialResponse.data.status;
            let retries = 0;
            let finalResponse: any;

            this.logger.log(`Documento enviado. ID: ${documentId}. Estado inicial: ${status}. Iniciando polling…`);

            while (status === 'PENDIENTE' && retries < this.maxRetries) {
                await new Promise((r) => setTimeout(r, this.retryInterval));
                const statusResponse = await axios.get(
                    `${this.documentUrl}/${documentId}/getById?data=true`,
                    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${personaToken}` } },
                );
                finalResponse = statusResponse.data;
                status = finalResponse.status;
                retries++;
                this.logger.log(`Polling intento ${retries}: Estado ${status}`);
            }

            if (!finalResponse) {
                const statusResponse = await axios.get(
                    `${this.documentUrl}/${documentId}/getById?data=true`,
                    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${personaToken}` } },
                );
                finalResponse = statusResponse.data;
                status = finalResponse.status;
            }

            const success = status === 'ACEPTADO';
            const pendienteVerificacion = !success && status === 'PENDIENTE';
            const providerError = (success || pendienteVerificacion) ? null : this.extractProviderError(finalResponse, status);
            const pdfUrl = finalResponse?.pdf?.A4 || finalResponse?.pdf?.['80mm'] || null;

            if (pendienteVerificacion) {
                this.logger.warn(`Documento ${documentId} enviado pero aún en procesamiento tras ${this.maxRetries} intentos.`);
            }

            return {
                success,
                pendienteVerificacion,
                xml: finalResponse?.xml || null,
                cdrResponse: JSON.stringify(finalResponse),
                cdrZip: finalResponse?.cdr || null,
                documentoId: documentId,
                message: success
                    ? 'Guía de remisión aceptada por SUNAT'
                    : pendienteVerificacion
                        ? 'Documento enviado a SUNAT pero aún en procesamiento. Verifique el estado en unos minutos.'
                        : `Rechazado por SUNAT: ${providerError}`,
                s3XmlUrl: null,
                s3CdrUrl: null,
                s3PdfUrl: pdfUrl,
                error: providerError,
            };

        } catch (error: any) {
            this.logger.error(`Error al enviar guía a SUNAT: ${error.message}`, error.stack);
            if (error.response?.data) {
                this.logger.error(`Respuesta APISUNAT: ${JSON.stringify(error.response.data)}`);
            }

            const errorData = error.response?.data;
            const sunatErrorCode: string | null = errorData?.error?.code || null;
            const errorMsg = errorData?.error?.message || errorData?.message || error.message || 'Error desconocido al conectar con APISUNAT';

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
                sunatErrorCode,
            };
        }
    }

    // ─── Document dispatcher ───────────────────────────────────────────────────

    private buildSunatDocument(guia: any, tipoDocCodigo: string): any {
        return tipoDocCodigo === '31'
            ? this.buildGRETransportistaDocument(guia)
            : this.buildGRERemitenteDocument(guia);
    }

    // ─── GRE-R (09): Remitente ─────────────────────────────────────────────────
    //
    // Reglas SUNAT UBL 2.1:
    //  - HandlingCode (tipoTraslado) OBLIGATORIO
    //  - SpecialInstructions para indicadores de retorno/transbordo
    //  - AddressTypeCode en DeliveryAddress y DespatchAddress
    //  - ShipmentStage: TransportModeCode + CarrierParty (público) | DriverPerson (privado)
    //  - TransportHandlingUnit con SOLO placa en transporte privado
    //  - NUNCA incluir ApplicableTransportMeans (TUC) — causa error SUNAT 3452
    //  - DespatchParty NO requerido para GRE-R

    private buildGRERemitenteDocument(guia: any): any {
        const isCompra = guia.tipoTraslado === '02';
        const remitenteRuc = String(guia.remitenteRuc || '').trim();
        const destinatarioRuc = guia.destinatarioTipoDoc === '6'
            ? String(guia.destinatarioNumDoc || '').trim()
            : '';

        // Para compras los ubigeos de partida/llegada se invierten conceptualmente
        const partidaListId = isCompra ? (destinatarioRuc || remitenteRuc) : remitenteRuc;
        const llegadaListId = isCompra ? remitenteRuc : (destinatarioRuc || remitenteRuc);

        const deliveryCustomerParty = isCompra
            ? this.buildPartyCac('6', remitenteRuc, guia.remitenteRazonSocial)
            : this.buildPartyCac(guia.destinatarioTipoDoc, guia.destinatarioNumDoc, guia.destinatarioRazonSocial);

        const specialInstructions = this.buildSpecialInstructions(guia);

        return {
            ...this.buildDocumentHeader(guia, '09'),
            'cac:DespatchSupplierParty': this.buildDespatchSupplierParty(guia),
            'cac:DeliveryCustomerParty': deliveryCustomerParty,
            ...(isCompra ? {
                'cac:SellerSupplierParty': this.buildPartyCac(
                    guia.destinatarioTipoDoc,
                    guia.destinatarioNumDoc,
                    guia.destinatarioRazonSocial,
                ),
            } : {}),
            ...(guia.tipoTraslado === '03' && guia.compradorNumDoc ? {
                'cac:BuyerCustomerParty': this.buildPartyCac(
                    guia.compradorTipoDoc || '6',
                    guia.compradorNumDoc,
                    guia.compradorRazonSocial,
                ),
            } : {}),
            'cac:Shipment': {
                'cbc:ID': { _text: 'SUNAT_Envio' },
                'cbc:HandlingCode': { _text: guia.tipoTraslado },
                'cbc:GrossWeightMeasure': {
                    _attributes: { unitCode: this.cleanUnit(guia.unidadPeso) },
                    _text: Number(guia.pesoTotal),
                },
                ...(specialInstructions.length > 0 ? { 'cbc:SpecialInstructions': specialInstructions } : {}),
                // Orden UBL obligatorio: ShipmentStage → Delivery → TransportHandlingUnit
                'cac:ShipmentStage': this.buildShipmentStageRemitente(guia),
                'cac:Delivery': {
                    'cac:DeliveryAddress': {
                        'cbc:ID': { _text: guia.llegadaUbigeo },
                        'cbc:AddressTypeCode': {
                            _attributes: { listID: llegadaListId },
                            _text: this.normalizeEstablishmentCode(guia.llegadaCodigoEstablecimiento),
                        },
                        'cac:AddressLine': { 'cbc:Line': { _text: guia.llegadaDireccion } },
                    },
                    'cac:Despatch': {
                        'cac:DespatchAddress': {
                            'cbc:ID': { _text: guia.partidaUbigeo },
                            'cbc:AddressTypeCode': {
                                _attributes: { listID: partidaListId },
                                _text: this.normalizeEstablishmentCode(guia.partidaCodigoEstablecimiento),
                            },
                            'cac:AddressLine': { 'cbc:Line': { _text: guia.partidaDireccion } },
                        },
                        // GRE-R no incluye DespatchParty
                    },
                },
                // GRE-R transporte privado: placa va AQUÍ. NUNCA ApplicableTransportMeans (error 3452).
                ...(guia.modoTransporte === '02' && String(guia.vehiculoPlaca || '').trim()
                    ? { 'cac:TransportHandlingUnit': this.buildTransportHandlingUnitRemitente(guia) }
                    : {}),
            },
            'cac:DespatchLine': this.buildDespatchLines(guia),
        };
    }

    // ─── GRE-T (31): Transportista ────────────────────────────────────────────
    //
    // Reglas SUNAT UBL 2.1:
    //  - NO HandlingCode, NO SpecialInstructions
    //  - NO AddressTypeCode en las direcciones
    //  - NO TransportModeCode en ShipmentStage
    //  - CarrierParty OBLIGATORIO en ShipmentStage (con CompanyID/MTC)
    //  - DriverPerson OBLIGATORIO en ShipmentStage
    //  - DespatchParty OBLIGATORIO en Despatch (remitente de los bienes)
    //  - TransportHandlingUnit OBLIGATORIO con placa + ApplicableTransportMeans (TUC)

    private buildGRETransportistaDocument(guia: any): any {
        const carrierRuc = String(guia.transportistaRuc || guia.remitenteRuc || '').trim();
        const carrierRazonSocial = String(guia.transportistaRazonSocial || guia.remitenteRazonSocial || '').trim();

        const greTRemitenteRuc = String(guia.greTRemitenteNumDoc || guia.destinatarioNumDoc || '').trim();
        const greTRemitenteNombre = String(guia.greTRemitenteRazonSocial || guia.destinatarioRazonSocial || '').trim();

        return {
            ...this.buildDocumentHeader(guia, '31'),
            'cac:DespatchSupplierParty': this.buildDespatchSupplierParty(guia),
            // GRE-T: DeliveryCustomerParty = el mismo transportista
            'cac:DeliveryCustomerParty': this.buildPartyCac('6', carrierRuc, carrierRazonSocial),
            'cac:Shipment': {
                'cbc:ID': { _text: 'SUNAT_Envio' },
                // GRE-T: NO HandlingCode, NO SpecialInstructions
                'cbc:GrossWeightMeasure': {
                    _attributes: { unitCode: this.cleanUnit(guia.unidadPeso) },
                    _text: Number(guia.pesoTotal),
                },
                // Orden UBL obligatorio: ShipmentStage → Delivery → TransportHandlingUnit
                'cac:ShipmentStage': this.buildShipmentStageTransportista(guia),
                'cac:Delivery': {
                    // GRE-T: NO AddressTypeCode en las direcciones
                    'cac:DeliveryAddress': {
                        'cbc:ID': { _text: guia.llegadaUbigeo },
                        'cac:AddressLine': { 'cbc:Line': { _text: guia.llegadaDireccion } },
                    },
                    'cac:Despatch': {
                        'cac:DespatchAddress': {
                            'cbc:ID': { _text: guia.partidaUbigeo },
                            'cac:AddressLine': { 'cbc:Line': { _text: guia.partidaDireccion } },
                        },
                        // GRE-T: DespatchParty OBLIGATORIO — remitente real de los bienes
                        'cac:DespatchParty': this.buildPartyCac('6', greTRemitenteRuc, greTRemitenteNombre),
                    },
                },
                // GRE-T: TransportHandlingUnit OBLIGATORIO con placa + TUC (ApplicableTransportMeans)
                'cac:TransportHandlingUnit': this.buildTransportHandlingUnitTransportista(guia),
            },
            'cac:DespatchLine': this.buildDespatchLines(guia),
        };
    }

    // ─── ShipmentStage builders ────────────────────────────────────────────────

    private buildShipmentStageRemitente(guia: any): any {
        const stage: any = {
            'cbc:TransportModeCode': { _text: guia.modoTransporte },
            'cac:TransitPeriod': {
                'cbc:StartDate': { _text: this.formatDate(guia.fechaInicioTraslado) },
            },
        };

        // Transporte público: datos del transportista contratado
        if (guia.modoTransporte === '01' && String(guia.transportistaRuc || '').trim()) {
            const ruc = String(guia.transportistaRuc).trim();
            stage['cac:CarrierParty'] = {
                'cac:PartyIdentification': {
                    'cbc:ID': {
                        _attributes: { schemeID: /^\d{11}$/.test(ruc) ? '6' : '1' },
                        _text: ruc,
                    },
                },
                'cac:PartyLegalEntity': {
                    'cbc:RegistrationName': { _text: guia.transportistaRazonSocial || '' },
                    ...(guia.transportistaMTC
                        ? { 'cbc:CompanyID': { _text: guia.transportistaMTC } }
                        : {}),
                },
            };
        }

        // Transporte privado: datos del conductor en DriverPerson.
        // La placa va en TransportHandlingUnit — NO en TransportMeans aquí para GRE-R.
        if (guia.modoTransporte === '02' && String(guia.conductorNumDoc || '').trim()) {
            stage['cac:DriverPerson'] = [this.buildDriverPerson(guia)];
        }

        return stage;
    }

    private buildShipmentStageTransportista(guia: any): any {
        const carrierRuc = String(guia.transportistaRuc || guia.remitenteRuc || '').trim();
        const stage: any = {
            // GRE-T: NO TransportModeCode
            'cac:TransitPeriod': {
                'cbc:StartDate': { _text: this.formatDate(guia.fechaInicioTraslado) },
            },
            // GRE-T: CarrierParty siempre obligatorio con MTC
            'cac:CarrierParty': {
                'cac:PartyIdentification': {
                    'cbc:ID': {
                        _attributes: { schemeID: '6' },
                        _text: carrierRuc,
                    },
                },
                'cac:PartyLegalEntity': {
                    'cbc:RegistrationName': {
                        _text: guia.transportistaRazonSocial || guia.remitenteRazonSocial || '',
                    },
                    // MTC obligatorio para GRE-T
                    ...(guia.transportistaMTC
                        ? { 'cbc:CompanyID': { _text: guia.transportistaMTC } }
                        : {}),
                },
            },
            // GRE-T: DriverPerson siempre obligatorio
            // La placa NO va aquí — va en TransportHandlingUnit
            'cac:DriverPerson': [this.buildDriverPerson(guia)],
        };

        return stage;
    }

    // ─── TransportHandlingUnit builders ───────────────────────────────────────

    /** GRE-R (09) transporte privado: solo placa. NUNCA ApplicableTransportMeans (TUC). */
    private buildTransportHandlingUnitRemitente(guia: any): any {
        const placa = String(guia.vehiculoPlaca || '').trim();
        if (!placa) return undefined;

        return {
            'cac:TransportEquipment': {
                'cbc:ID': { _text: placa },
                // ApplicableTransportMeans EXCLUIDO intencionalmente — causa error SUNAT 3452 en GRE-R
            },
        };
    }

    /** GRE-T (31): placa + ApplicableTransportMeans (TUC) — ambos obligatorios. */
    private buildTransportHandlingUnitTransportista(guia: any): any {
        const placa = String(guia.vehiculoPlaca || '').trim();
        const tuc = String(guia.vehiculoAutorizacion || '').trim();

        return {
            'cac:TransportEquipment': {
                ...(placa ? { 'cbc:ID': { _text: placa } } : {}),
                // TUC obligatorio para GRE-T
                ...(tuc ? {
                    'cac:ApplicableTransportMeans': {
                        'cbc:RegistrationNationalityID': { _text: tuc },
                    },
                } : {}),
            },
        };
    }

    // ─── Shared helpers ────────────────────────────────────────────────────────

    private buildDocumentHeader(guia: any, tipoDocCodigo: string): any {
        return {
            'cbc:UBLVersionID': { _text: '2.1' },
            'cbc:CustomizationID': { _text: '2.0' },
            'cbc:ID': { _text: `${guia.serie}-${String(guia.correlativo).padStart(8, '0')}` },
            'cbc:IssueDate': { _text: this.formatDate(guia.fechaEmision) },
            'cbc:IssueTime': { _text: guia.horaEmision || '00:00:00' },
            'cbc:DespatchAdviceTypeCode': { _text: tipoDocCodigo },
        };
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
                    'cbc:RegistrationName': { _text: guia.remitenteRazonSocial },
                    'cac:RegistrationAddress': {
                        'cac:AddressLine': {
                            'cbc:Line': { _text: guia.remitenteDireccion },
                        },
                    },
                },
            },
        };
    }

    /**
     * Construye un nodo cac:Party con wrapping correcto.
     * Retorna { 'cac:Party': { ... } } para uso directo en DespatchSupplierParty,
     * DeliveryCustomerParty, SellerSupplierParty y DespatchParty.
     */
    private buildPartyCac(tipoDoc: string, numDoc: string, razonSocial: string, direccion?: string): any {
        const party: any = {
            'cac:Party': {
                'cac:PartyIdentification': {
                    'cbc:ID': {
                        _attributes: { schemeID: this.getTipoDocumentoSchemeId(tipoDoc) },
                        _text: numDoc,
                    },
                },
                'cac:PartyLegalEntity': {
                    'cbc:RegistrationName': { _text: razonSocial },
                },
            },
        };

        if (direccion) {
            party['cac:Party']['cac:PartyLegalEntity']['cac:RegistrationAddress'] = {
                'cac:AddressLine': { 'cbc:Line': { _text: direccion } },
            };
        }

        return party;
    }

    private buildDriverPerson(guia: any): any {
        const firstName = String(guia.conductorNombre || '').trim();
        const familyName = String(guia.conductorApellidos || '').trim();

        return {
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
        };
    }

    private buildSpecialInstructions(guia: any): Array<{ _text: string }> {
        const si: Array<{ _text: string }> = [];
        if (guia.transbordoProgramado) si.push({ _text: 'SUNAT_Envio_IndicadorTransbordoProgramado' });
        if (guia.retornoVehiculoVacio) si.push({ _text: 'SUNAT_Envio_IndicadorRetornoVehiculoVacio' });
        if (guia.retornoEnvasesVacios) si.push({ _text: 'SUNAT_Envio_IndicadorRetornoEnvasesVacios' });
        return si;
    }

    private buildDespatchLines(guia: any): any[] {
        return guia.detalles.map((detalle: any, index: number) => ({
            'cbc:ID': { _text: index + 1 },
            'cbc:DeliveredQuantity': {
                _attributes: { unitCode: this.cleanUnit(detalle.unidadMedida) },
                _text: Number(detalle.cantidad),
            },
            'cac:OrderLineReference': {
                'cbc:LineID': { _text: index + 1 },
            },
            'cac:Item': {
                'cbc:Description': { _text: detalle.descripcion },
            },
        }));
    }

    // ─── Utility methods ───────────────────────────────────────────────────────

    private cleanUnit(u: string): string {
        if (!u) return 'NIU';
        const unit = u.toUpperCase();
        if (unit === 'UNIDAD' || unit === 'UND') return 'NIU';
        if (unit === 'KILOS' || unit === 'KG') return 'KGM';
        return unit;
    }

    private normalizeEstablishmentCode(value: any): string {
        const code = String(value || '').trim();
        return code || '0000';
    }

    private getTipoDocumentoSchemeId(tipoDoc: string): string {
        const map: Record<string, string> = { '1': '1', '6': '6', '4': '4', '7': '7' };
        return map[tipoDoc] || '1';
    }

    private formatDate(date: Date | string): string {
        if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
        const d = new Date(date);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private extractProviderError(finalResponse: any, status?: string): string {
        if (finalResponse?.error?.message) return finalResponse.error.message;
        const firstFault = finalResponse?.faults?.[0];
        if (firstFault?.desError && firstFault?.numError) return `${firstFault.desError} (Código ${firstFault.numError})`;
        if (firstFault?.desError) return firstFault.desError;
        if (firstFault?.numError) return `Código SUNAT: ${firstFault.numError}`;
        if (status) return `SUNAT devolvió estado: ${status}`;
        return 'Error desconocido';
    }
}
