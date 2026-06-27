import { Injectable, Logger, HttpException } from '@nestjs/common';
import { QpseClient, QpseSendResponse } from '../common/utils/qpse.client';
import { buildUblXml } from '../common/utils/ubl-xml';
import axios from 'axios';

@Injectable()
export class SunatGuiaService {
    private readonly logger = new Logger(SunatGuiaService.name);
    private readonly maxRetries = 12;
    private readonly retryInterval = 5000;

    constructor(
        private readonly qpseClient: QpseClient,
    ) {}

    async enviarGuia(
        guia: any,
        usuarioPse: string,
        contrasenaPse: string,
        usaDemo?: boolean,
    ) {
        const tipoDocCodigo = guia.tipoGuia === 'TRANSPORTISTA' ? '31' : '09';
        const rucEmisor = String(guia.remitenteRuc || '').trim();
        const paddedCorrelativo = String(guia.correlativo).padStart(8, '0');
        const xmlFilename = `${rucEmisor}-${tipoDocCodigo}-${guia.serie}-${paddedCorrelativo}`;

        const documentBody = this.buildSunatDocument(guia, tipoDocCodigo);

        const xmlContent = buildUblXml('DespatchAdvice', documentBody);
        const xmlContentBase64 = Buffer.from(xmlContent, 'utf8').toString('base64');

        // APISUNAT temporalmente desactivado (rollback rápido pendiente si se requiere reactivar).

        this.logger.log(`Enviando guía ${xmlFilename} a SUNAT vía QPSE`);

        // 1. Obtener token QPSE
        const qpseAccess = await this.qpseClient.obtenerTokenAcceso({
            username: usuarioPse,
            password: contrasenaPse,
            usaDemo,
        });
        const accessToken = qpseAccess.token_acceso;
        if (!accessToken) {
            throw new HttpException('No se pudo obtener el token de acceso de QPSE', 502);
        }

        // 2. Firmar XML
        console.log(xmlContent);
        const signResponse = await this.qpseClient.firmarXML({
            accessToken,
            xmlFilename,
            xmlContentBase64,
            usaDemo,
        });
        if (!signResponse.xml) {
            throw new HttpException('QPSE no devolvió el XML firmado', 502);
        }

        const signedXmlBase64 = signResponse.xml;
        const signedXmlContent = Buffer.from(signedXmlBase64, 'base64').toString('utf8');

        // 3. Enviar a SUNAT
        let initialResponse = await this.qpseClient.enviarXML({
            accessToken,
            xmlFilename,
            externalId: signResponse.external_id,
            xmlSignedBase64: signedXmlBase64,
            usaDemo,
        });

        // 4. Manejar numeración repetida — retornar flag para que el caller avance correlativo
        if (this.isNumeracionRepetida(initialResponse)) {
            return {
                success: false,
                numeracionRepetida: true,
                xml: signedXmlContent,
                cdrResponse: JSON.stringify(initialResponse),
                cdrZip: null,
                documentoId: null,
                message: 'Numeración repetida en SUNAT',
                error: 'Numeración repetida en SUNAT',
            };
        }

        let finalResponse: QpseSendResponse = initialResponse;
        const qpseTicket = initialResponse.ticket;
        const documentId = String(xmlFilename);
        let status = this.normalizeStatus(initialResponse);

        // 5. Polling asíncrono. Para GRE, QPSE resuelve mejor la consulta por xml_filename.
        if (qpseTicket && status === 'PENDIENTE') {
            let retries = 0;
            this.logger.log(`[QPSE] Estado inicial: ${status}. Polling por archivo ${xmlFilename}…`);
            while (status === 'PENDIENTE' && retries < this.maxRetries) {
                await new Promise(r => setTimeout(r, this.retryInterval));
                try {
                    finalResponse = await this.qpseClient.consultarTicket(xmlFilename, accessToken, usaDemo);
                } catch (error) {
                    this.logger.warn(`[QPSE] Consulta por archivo falló. Reintentando por ticket ${qpseTicket}`);
                    finalResponse = await this.qpseClient.consultarTicket(qpseTicket, accessToken, usaDemo);
                }
                status = this.normalizeStatus(finalResponse);
                retries++;
                this.logger.log(`[QPSE] Polling intento ${retries}: ${status}`);
            }
        } else if (!qpseTicket) {
            this.logger.log(`[QPSE] Respuesta síncrona (sin ticket): ${status}`);
        }

        const success = status === 'ACEPTADO';
        const pendiente = status === 'PENDIENTE';

        return {
            success,
            numeracionRepetida: false,
            pendienteVerificacion: pendiente,
            xml: signedXmlContent,
            cdrResponse: JSON.stringify(finalResponse),
            cdrZip: finalResponse.cdr || null,
            documentoId: documentId,
            message: success
                ? 'Guía de remisión aceptada por SUNAT'
                : pendiente
                    ? 'Enviada a SUNAT pero aún en procesamiento. El estado se actualizará automáticamente.'
                    : `Rechazada por SUNAT: ${this.extractMessage(finalResponse)}`,
            error: !success && !pendiente ? this.extractMessage(finalResponse) : null,
        };
    }

    // ─── Status helpers ────────────────────────────────────────────────────────

    private normalizeStatus(response: QpseSendResponse): 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' {
        const stateLabel = String(response?.state_label || '').toLowerCase();
        const code = String(response?.code ?? '');
        const hasCdr = Boolean(response?.cdr);
        const hasErrors = Array.isArray(response?.errors)
            ? response.errors.length > 0
            : Boolean(response?.errors);

        if (
            stateLabel === 'aceptado' ||
            stateLabel === 'observado' ||
            (code === '0' && hasCdr)
        ) return 'ACEPTADO';
        if (
            stateLabel === 'rechazado' ||
            code === '99' ||
            (response?.sunat_success === false && (hasErrors || hasCdr))
        ) return 'RECHAZADO';
        if (
            stateLabel === 'enviado' ||
            stateLabel === 'pendiente' ||
            stateLabel === 'en_proceso' ||
            stateLabel === 'indeterminado' ||
            code === '98' ||
            response?.sunat_success == null ||
            response?.success === true
        ) return 'PENDIENTE';
        return 'RECHAZADO';
    }

    private normalizeApisunatStatus(response: any): 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' {
        const status = String(response?.status || '').toUpperCase();
        if (status === 'ACEPTADO') return 'ACEPTADO';
        if (status === 'PENDIENTE') return 'PENDIENTE';
        return 'RECHAZADO';
    }

    private isNumeracionRepetida(response: any): boolean {
        const text = JSON.stringify(response || {}).toLowerCase();
        const code = String(response?.code ?? response?.error?.code ?? '');
        return code === '1033' || text.includes('1033') || text.includes('numeraci');
    }

    private extractMessage(response: QpseSendResponse): string {
        return (
            response?.message ||
            response?.mensaje ||
            response?.errors?.join(' | ') ||
            response?.errores?.join(' | ') ||
            response?.notes?.join(' | ') ||
            response?.observaciones?.join(' | ') ||
            'Error desconocido'
        );
    }

    private extractApisunatMessage(response: any): string {
        const faults = Array.isArray(response?.faults) ? response.faults.join(' | ') : response?.faults;
        const notes = Array.isArray(response?.notes) ? response.notes.join(' | ') : response?.notes;
        const nestedError =
            response?.error?.message ||
            response?.error?.descripcion ||
            response?.error?.detail ||
            (typeof response?.error === 'string' ? response.error : null);
        return (
            response?.message ||
            nestedError ||
            faults ||
            notes ||
            'Error desconocido'
        );
    }

    private async downloadTextFromUrl(url: string): Promise<string> {
        const resp = await axios.get(url, { responseType: 'text', timeout: 30000 });
        return String(resp.data || '');
    }

    private async downloadBinaryAsBase64(url: string): Promise<string> {
        const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 30000 });
        return Buffer.from(resp.data as any).toString('base64');
    }

    // ─── Document dispatcher ───────────────────────────────────────────────────

    private buildSunatDocument(guia: any, tipoDocCodigo: string): any {
        return tipoDocCodigo === '31'
            ? this.buildGRETransportistaDocument(guia)
            : this.buildGRERemitenteDocument(guia);
    }

    // ─── GRE-R (09): Remitente ─────────────────────────────────────────────────

    private buildGRERemitenteDocument(guia: any): any {
        const isCompra = guia.tipoTraslado === '02';
        const isEmisorItineranteCp = guia.tipoTraslado === '18';
        const remitenteRuc = String(guia.remitenteRuc || '').trim();
        const destinatarioRuc = guia.destinatarioTipoDoc === '6'
            ? String(guia.destinatarioNumDoc || '').trim()
            : '';

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
                'cac:ShipmentStage': this.buildShipmentStageRemitente(guia),
                'cac:Delivery': {
                    'cac:DeliveryAddress': {
                        'cbc:ID': { _text: guia.llegadaUbigeo },
                        ...(!isEmisorItineranteCp ? {
                            'cbc:AddressTypeCode': {
                                _attributes: { listID: llegadaListId },
                                _text: this.getEstablishmentCode(guia, guia.llegadaCodigoEstablecimiento),
                            },
                        } : {}),
                        'cac:AddressLine': { 'cbc:Line': { _text: guia.llegadaDireccion } },
                    },
                    'cac:Despatch': {
                        'cac:DespatchAddress': {
                            'cbc:ID': { _text: guia.partidaUbigeo },
                            ...(!isEmisorItineranteCp ? {
                                'cbc:AddressTypeCode': {
                                    _attributes: { listID: partidaListId },
                                    _text: this.getEstablishmentCode(guia, guia.partidaCodigoEstablecimiento),
                                },
                            } : {}),
                            'cac:AddressLine': { 'cbc:Line': { _text: guia.partidaDireccion } },
                        },
                    },
                },
                ...(guia.modoTransporte === '02' && String(guia.vehiculoPlaca || '').trim()
                    ? { 'cac:TransportHandlingUnit': this.buildTransportHandlingUnitRemitente(guia) }
                    : {}),
            },
            'cac:DespatchLine': this.buildDespatchLines(guia),
        };
    }

    // ─── GRE-T (31): Transportista ────────────────────────────────────────────

    private buildGRETransportistaDocument(guia: any): any {
        const carrierRuc = String(guia.transportistaRuc || guia.remitenteRuc || '').trim();
        const carrierRazonSocial = String(guia.transportistaRazonSocial || guia.remitenteRazonSocial || '').trim();
        const greTRemitenteRuc = String(guia.greTRemitenteNumDoc || guia.destinatarioNumDoc || '').trim();
        const greTRemitenteNombre = String(guia.greTRemitenteRazonSocial || guia.destinatarioRazonSocial || '').trim();

        return {
            ...this.buildDocumentHeader(guia, '31'),
            'cac:DespatchSupplierParty': this.buildDespatchSupplierParty(guia),
            'cac:DeliveryCustomerParty': this.buildPartyCac('6', carrierRuc, carrierRazonSocial),
            'cac:Shipment': {
                'cbc:ID': { _text: 'SUNAT_Envio' },
                'cbc:GrossWeightMeasure': {
                    _attributes: { unitCode: this.cleanUnit(guia.unidadPeso) },
                    _text: Number(guia.pesoTotal),
                },
                'cac:ShipmentStage': this.buildShipmentStageTransportista(guia),
                'cac:Delivery': {
                    'cac:DeliveryAddress': {
                        'cbc:ID': { _text: guia.llegadaUbigeo },
                        'cac:AddressLine': { 'cbc:Line': { _text: guia.llegadaDireccion } },
                    },
                    'cac:Despatch': {
                        'cac:DespatchAddress': {
                            'cbc:ID': { _text: guia.partidaUbigeo },
                            'cac:AddressLine': { 'cbc:Line': { _text: guia.partidaDireccion } },
                        },
                        'cac:DespatchParty': this.buildPartyCac('6', greTRemitenteRuc, greTRemitenteNombre),
                    },
                },
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
                    ...(guia.transportistaMTC ? { 'cbc:CompanyID': { _text: guia.transportistaMTC } } : {}),
                },
            };
        }

        stage['cac:LoadingTransportEvent'] = {
            'cbc:OccurrenceDate': { _text: this.formatDate(guia.fechaInicioTraslado) }
        };

        if (guia.modoTransporte === '02' && String(guia.conductorNumDoc || '').trim()) {
            stage['cac:DriverPerson'] = [this.buildDriverPerson(guia)];
        }

        return stage;
    }

    private buildShipmentStageTransportista(guia: any): any {
        const carrierRuc = String(guia.transportistaRuc || guia.remitenteRuc || '').trim();
        return {
            'cac:TransitPeriod': {
                'cbc:StartDate': { _text: this.formatDate(guia.fechaInicioTraslado) },
            },
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
                    ...(guia.transportistaMTC ? { 'cbc:CompanyID': { _text: guia.transportistaMTC } } : {}),
                },
            },
            'cac:LoadingTransportEvent': {
                'cbc:OccurrenceDate': { _text: this.formatDate(guia.fechaInicioTraslado) }
            },
            'cac:DriverPerson': [this.buildDriverPerson(guia)],
        };
    }

    // ─── TransportHandlingUnit builders ───────────────────────────────────────

    private buildTransportHandlingUnitRemitente(guia: any): any {
        const placa = String(guia.vehiculoPlaca || '').trim();
        if (!placa) return undefined;
        return {
            'cac:TransportEquipment': {
                'cbc:ID': { _text: placa },
                // ApplicableTransportMeans excluido — causa error SUNAT 3452 en GRE-R
            },
        };
    }

    private buildTransportHandlingUnitTransportista(guia: any): any {
        const placa = String(guia.vehiculoPlaca || '').trim();
        const tuc = String(guia.vehiculoAutorizacion || '').trim();
        return {
            'cac:TransportEquipment': {
                ...(placa ? { 'cbc:ID': { _text: placa } } : {}),
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
        return String(value || '').trim() || '0000';
    }

    private getEstablishmentCode(guia: any, value: any): string {
        const code = this.normalizeEstablishmentCode(value);
        return guia.tipoTraslado === '04' && code === '0000' ? '0700' : code;
    }

    private getTipoDocumentoSchemeId(tipoDoc: string): string {
        const map: Record<string, string> = { '0': '0', '1': '1', '6': '6', '4': '4', '7': '7' };
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
}
