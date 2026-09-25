import { Injectable, Logger, HttpException } from '@nestjs/common';
import { QpseClient, QpseSendResponse } from '../common/utils/qpse.client';
import { buildUblXml } from '../common/utils/ubl-xml';
import { DOC_RELACIONADO_LABEL } from './dto/create-guia-remision.dto';
import axios from 'axios';

@Injectable()
export class SunatGuiaService {
  private readonly logger = new Logger(SunatGuiaService.name);
  private readonly maxRetries = 12;
  private readonly retryInterval = 5000;

  constructor(private readonly qpseClient: QpseClient) {}

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
      throw new HttpException(
        'No se pudo obtener el token de acceso de QPSE',
        502,
      );
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
    const signedXmlContent = Buffer.from(signedXmlBase64, 'base64').toString(
      'utf8',
    );

    // 3. Enviar a SUNAT
    let initialResponse: QpseSendResponse;
    try {
      initialResponse = await this.qpseClient.enviarXML({
        accessToken,
        xmlFilename,
        externalId: signResponse.external_id,
        xmlSignedBase64: signedXmlBase64,
        usaDemo,
      });
    } catch (error: any) {
      // QPSE puede devolver el 1033 (numeración repetida) como error HTTP y no
      // como respuesta estructurada. Si no lo tratamos aquí, la guía queda en
      // reintentos infinitos con el MISMO número → 1033 eterno. Lo convertimos en
      // el flag de numeración repetida para que el caller avance el correlativo.
      const errPayload = {
        message: error?.message,
        data: error?.response?.data ?? (error as any)?.response,
      };
      if (this.isNumeracionRepetida(errPayload)) {
        this.logger.warn(
          `[QPSE] 1033 recibido como excepción para ${xmlFilename}. ` +
            `Se marca numeración repetida para avanzar correlativo.`,
        );
        return {
          success: false,
          numeracionRepetida: true,
          xml: signedXmlContent,
          cdrResponse: JSON.stringify(errPayload),
          cdrZip: null,
          documentoId: null,
          message: 'Numeración repetida en SUNAT',
          error: 'Numeración repetida en SUNAT',
        };
      }
      throw error;
    }

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
      this.logger.log(
        `[QPSE] Estado inicial: ${status}. Polling por archivo ${xmlFilename}…`,
      );
      while (status === 'PENDIENTE' && retries < this.maxRetries) {
        await new Promise((r) => setTimeout(r, this.retryInterval));
        try {
          finalResponse = await this.qpseClient.consultarTicket(
            xmlFilename,
            accessToken,
            usaDemo,
          );
        } catch (error) {
          this.logger.warn(
            `[QPSE] Consulta por archivo falló. Reintentando por ticket ${qpseTicket}`,
          );
          finalResponse = await this.qpseClient.consultarTicket(
            qpseTicket,
            accessToken,
            usaDemo,
          );
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

  private normalizeStatus(
    response: QpseSendResponse,
  ): 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' {
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
    )
      return 'ACEPTADO';
    if (
      stateLabel === 'rechazado' ||
      code === '99' ||
      (response?.sunat_success === false && (hasErrors || hasCdr))
    )
      return 'RECHAZADO';
    if (
      stateLabel === 'enviado' ||
      stateLabel === 'pendiente' ||
      stateLabel === 'en_proceso' ||
      stateLabel === 'indeterminado' ||
      code === '98' ||
      response?.sunat_success == null ||
      response?.success === true
    )
      return 'PENDIENTE';
    return 'RECHAZADO';
  }

  private normalizeApisunatStatus(
    response: any,
  ): 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' {
    const status = String(response?.status || '').toUpperCase();
    if (status === 'ACEPTADO') return 'ACEPTADO';
    if (status === 'PENDIENTE') return 'PENDIENTE';
    return 'RECHAZADO';
  }

  private isNumeracionRepetida(response: any): boolean {
    const text = JSON.stringify(response || {}).toLowerCase();
    const code = String(response?.code ?? response?.error?.code ?? '');
    return (
      code === '1033' ||
      text.includes('1033') ||
      text.includes('numeraci') ||
      // Texto SUNAT del 1033 (llega así cuando QPSE lo lanza como excepción, sin el código)
      text.includes('registrado previamente')
    );
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
    const faults = Array.isArray(response?.faults)
      ? response.faults.join(' | ')
      : response?.faults;
    const notes = Array.isArray(response?.notes)
      ? response.notes.join(' | ')
      : response?.notes;
    const nestedError =
      response?.error?.message ||
      response?.error?.descripcion ||
      response?.error?.detail ||
      (typeof response?.error === 'string' ? response.error : null);
    return (
      response?.message || nestedError || faults || notes || 'Error desconocido'
    );
  }

  private async downloadTextFromUrl(url: string): Promise<string> {
    const resp = await axios.get(url, { responseType: 'text', timeout: 30000 });
    return String(resp.data || '');
  }

  private async downloadBinaryAsBase64(url: string): Promise<string> {
    const resp = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
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
    const destinatarioRuc =
      guia.destinatarioTipoDoc === '6'
        ? String(guia.destinatarioNumDoc || '').trim()
        : '';

    // El RUC que acompaña al código de establecimiento es el del DUEÑO de ese
    // punto. Si la contraparte no tiene RUC (persona natural con DNI) NO se puede
    // rellenar con el del remitente: SUNAT rechaza con 3411 ("el RUC del punto de
    // llegada no debe ser igual al del remitente"). En ese caso se omite el
    // código, que es opcional en el UBL.
    // Motivo 04 (traslado entre establecimientos de la misma empresa): los dos
    // puntos son del remitente.
    const mismaEmpresa =
      guia.tipoTraslado === '04' ||
      (!!destinatarioRuc && destinatarioRuc === remitenteRuc);
    const partidaListId =
      isCompra && !mismaEmpresa ? destinatarioRuc : remitenteRuc;
    const llegadaListId =
      isCompra || mismaEmpresa ? remitenteRuc : destinatarioRuc;

    const deliveryCustomerParty = isCompra
      ? this.buildPartyCac('6', remitenteRuc, guia.remitenteRazonSocial)
      : this.buildPartyCac(
          guia.destinatarioTipoDoc,
          guia.destinatarioNumDoc,
          guia.destinatarioRazonSocial,
        );

    const specialInstructions = this.buildSpecialInstructions(guia);

    return {
      ...this.buildDocumentHeader(guia, '09'),
      // Va aquí a propósito: el esquema espera AdditionalDocumentReference
      // después de la cabecera y antes de DespatchSupplierParty.
      ...(this.buildAdditionalDocumentReference(guia)
        ? { 'cac:AdditionalDocumentReference': this.buildAdditionalDocumentReference(guia) }
        : {}),
      'cac:DespatchSupplierParty': this.buildDespatchSupplierParty(guia),
      'cac:DeliveryCustomerParty': deliveryCustomerParty,
      ...(isCompra
        ? {
            'cac:SellerSupplierParty': this.buildPartyCac(
              guia.destinatarioTipoDoc,
              guia.destinatarioNumDoc,
              guia.destinatarioRazonSocial,
            ),
          }
        : {}),
      ...(guia.tipoTraslado === '03' && guia.compradorNumDoc
        ? {
            'cac:BuyerCustomerParty': this.buildPartyCac(
              guia.compradorTipoDoc || '6',
              guia.compradorNumDoc,
              guia.compradorRazonSocial,
            ),
          }
        : {}),
      'cac:Shipment': {
        'cbc:ID': { _text: 'SUNAT_Envio' },
        'cbc:HandlingCode': {
          _attributes: {
            listAgencyName: 'PE:SUNAT',
            listName: 'Motivo de traslado',
            listURI:
              'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo20',
          },
          _text: guia.tipoTraslado,
        },
        // Descripción del motivo de traslado (Catálogo 20). Obligatorio para
        // motivo '13' (Otros) y para '05' (Consignación); se envía siempre por
        // consistencia con el CPE aceptado por SUNAT.
        'cbc:HandlingInstructions': {
          _text: this.motivoTrasladoDescripcion(guia),
        },
        'cbc:GrossWeightMeasure': {
          _attributes: { unitCode: this.cleanUnit(guia.unidadPeso) },
          _text: Number(guia.pesoTotal),
        },
        ...(specialInstructions.length > 0
          ? { 'cbc:SpecialInstructions': specialInstructions }
          : {}),
        'cac:ShipmentStage': this.buildShipmentStageRemitente(guia),
        'cac:Delivery': {
          'cac:DeliveryAddress': {
            'cbc:ID': { _text: guia.llegadaUbigeo },
            ...(!isEmisorItineranteCp && llegadaListId
              ? {
                  'cbc:AddressTypeCode': {
                    _attributes: { listID: llegadaListId },
                    _text: this.getEstablishmentCode(
                      guia,
                      guia.llegadaCodigoEstablecimiento,
                    ),
                  },
                }
              : {}),
            'cac:AddressLine': { 'cbc:Line': { _text: guia.llegadaDireccion } },
          },
          'cac:Despatch': {
            'cac:DespatchAddress': {
              'cbc:ID': { _text: guia.partidaUbigeo },
              ...(!isEmisorItineranteCp && partidaListId
                ? {
                    'cbc:AddressTypeCode': {
                      _attributes: { listID: partidaListId },
                      _text: this.getEstablishmentCode(
                        guia,
                        guia.partidaCodigoEstablecimiento,
                      ),
                    },
                  }
                : {}),
              'cac:AddressLine': {
                'cbc:Line': { _text: guia.partidaDireccion },
              },
            },
          },
        },
        ...(guia.modoTransporte === '02' &&
        !guia.vehiculoM1oL &&
        String(guia.vehiculoPlaca || '').trim()
          ? {
              'cac:TransportHandlingUnit':
                this.buildTransportHandlingUnitRemitente(guia),
            }
          : {}),
      },
      'cac:DespatchLine': this.buildDespatchLines(guia),
    };
  }

  // ─── GRE-T (31): Transportista ────────────────────────────────────────────

  private buildGRETransportistaDocument(guia: any): any {
    const carrierRuc = String(
      guia.transportistaRuc || guia.remitenteRuc || '',
    ).trim();
    const carrierRazonSocial = String(
      guia.transportistaRazonSocial || guia.remitenteRazonSocial || '',
    ).trim();
    const greTRemitenteRuc = String(
      guia.greTRemitenteNumDoc || guia.destinatarioNumDoc || '',
    ).trim();
    const greTRemitenteNombre = String(
      guia.greTRemitenteRazonSocial || guia.destinatarioRazonSocial || '',
    ).trim();

    return {
      ...this.buildDocumentHeader(guia, '31'),
      // Va aquí a propósito: el esquema espera AdditionalDocumentReference
      // después de la cabecera y antes de DespatchSupplierParty.
      ...(this.buildAdditionalDocumentReference(guia)
        ? { 'cac:AdditionalDocumentReference': this.buildAdditionalDocumentReference(guia) }
        : {}),
      'cac:DespatchSupplierParty': this.buildDespatchSupplierParty(guia),
      'cac:DeliveryCustomerParty': this.buildPartyCac(
        '6',
        carrierRuc,
        carrierRazonSocial,
      ),
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
              'cac:AddressLine': {
                'cbc:Line': { _text: guia.partidaDireccion },
              },
            },
            // cac:DespatchParty es de tipo PartyType: sus hijos (PartyIdentification,
            // PartyLegalEntity) van directos, SIN el wrapper cac:Party (que sí aplica a
            // DeliveryCustomerParty/DespatchSupplierParty). Con el wrapper SUNAT rechaza
            // por XSD (0306: "Element cac:Party is not expected").
            'cac:DespatchParty': this.buildPartyCac(
              '6',
              greTRemitenteRuc,
              greTRemitenteNombre,
            )['cac:Party'],
          },
        },
        'cac:TransportHandlingUnit':
          this.buildTransportHandlingUnitTransportista(guia),
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

    if (
      guia.modoTransporte === '01' &&
      String(guia.transportistaRuc || '').trim()
    ) {
      const ruc = String(guia.transportistaRuc).trim();
      stage['cac:CarrierParty'] = {
        'cac:PartyIdentification': {
          'cbc:ID': {
            _attributes: { schemeID: /^\d{11}$/.test(ruc) ? '6' : '1' },
            _text: ruc,
          },
        },
        'cac:PartyLegalEntity': {
          'cbc:RegistrationName': {
            _text: guia.transportistaRazonSocial || '',
          },
          ...(guia.transportistaMTC
            ? { 'cbc:CompanyID': { _text: guia.transportistaMTC } }
            : {}),
        },
      };
    }

    // cac:LoadingTransportEvent es la FECHA DE ENTREGA de los bienes al
    // transportista, no la de inicio de traslado (esa va en cac:TransitPeriod).
    // Si la guía no la trae, se mantiene el comportamiento anterior.
    stage['cac:LoadingTransportEvent'] = {
      'cbc:OccurrenceDate': {
        _text: this.formatDate(guia.fechaEntregaBienes || guia.fechaInicioTraslado),
      },
    };

    if (
      guia.modoTransporte === '02' &&
      !guia.vehiculoM1oL &&
      String(guia.conductorNumDoc || '').trim()
    ) {
      stage['cac:DriverPerson'] = this.buildDriverPersons(guia);
    }

    return stage;
  }

  private buildShipmentStageTransportista(guia: any): any {
    const carrierRuc = String(
      guia.transportistaRuc || guia.remitenteRuc || '',
    ).trim();
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
            _text:
              guia.transportistaRazonSocial || guia.remitenteRazonSocial || '',
          },
          ...(guia.transportistaMTC
            ? { 'cbc:CompanyID': { _text: guia.transportistaMTC } }
            : {}),
        },
      },
      'cac:LoadingTransportEvent': {
        'cbc:OccurrenceDate': {
          _text: this.formatDate(guia.fechaEntregaBienes || guia.fechaInicioTraslado),
        },
      },
      'cac:DriverPerson': this.buildDriverPersons(guia),
    };
  }

  // ─── TransportHandlingUnit builders ───────────────────────────────────────

  /**
   * Vehículos secundarios (cac:AttachedTransportEquipment) y autorización
   * especial (cac:ShipmentDocumentReference). Se comparten entre GRE-R y GRE-T.
   */
  private buildVehiculosSecundarios(guia: any): any[] {
    const secundarios = Array.isArray(guia.vehiculosSecundarios)
      ? guia.vehiculosSecundarios
      : [];
    return secundarios
      .filter((v: any) => v && String(v.placa || '').trim())
      .map((v: any) => {
        const tuce = String(v.tuce || '').trim();
        return {
          'cbc:ID': { _text: String(v.placa).trim().toUpperCase() },
          ...(tuce
            ? {
                'cac:ApplicableTransportMeans': {
                  'cbc:RegistrationNationalityID': { _text: tuce },
                },
              }
            : {}),
        };
      });
  }

  private buildAutorizacionEspecial(guia: any): any | undefined {
    const nro = String(guia.vehiculoNroAutorizacion || '').trim();
    if (!nro) return undefined;
    const emisor = String(guia.vehiculoEntidadEmisora || '').trim();
    return {
      'cbc:ID': {
        _attributes: {
          ...(emisor ? { schemeID: emisor } : {}),
          schemeName: 'Entidad Autorizadora',
          schemeAgencyName: 'PE:SUNAT',
        },
        _text: nro,
      },
    };
  }

  private buildTransportHandlingUnitRemitente(guia: any): any {
    const placa = String(guia.vehiculoPlaca || '').trim();
    if (!placa) return undefined;
    const secundarios = this.buildVehiculosSecundarios(guia);
    const autorizacion = this.buildAutorizacionEspecial(guia);
    return {
      'cac:TransportEquipment': {
        'cbc:ID': { _text: placa },
        // ApplicableTransportMeans excluido — causa error SUNAT 3452 en GRE-R
        ...(secundarios.length
          ? { 'cac:AttachedTransportEquipment': secundarios }
          : {}),
        ...(autorizacion ? { 'cac:ShipmentDocumentReference': autorizacion } : {}),
      },
    };
  }

  private buildTransportHandlingUnitTransportista(guia: any): any {
    const placa = String(guia.vehiculoPlaca || '').trim();
    const tuc = String(guia.vehiculoAutorizacion || '').trim();
    const secundarios = this.buildVehiculosSecundarios(guia);
    const autorizacion = this.buildAutorizacionEspecial(guia);
    return {
      'cac:TransportEquipment': {
        ...(placa ? { 'cbc:ID': { _text: placa } } : {}),
        ...(tuc
          ? {
              'cac:ApplicableTransportMeans': {
                'cbc:RegistrationNationalityID': { _text: tuc },
              },
            }
          : {}),
        ...(secundarios.length
          ? { 'cac:AttachedTransportEquipment': secundarios }
          : {}),
        ...(autorizacion ? { 'cac:ShipmentDocumentReference': autorizacion } : {}),
      },
    };
  }

  // ─── Shared helpers ────────────────────────────────────────────────────────

  private buildDocumentHeader(guia: any, tipoDocCodigo: string): any {
    return {
      'cbc:UBLVersionID': { _text: '2.1' },
      'cbc:CustomizationID': { _text: '2.0' },
      'cbc:ID': {
        _text: `${guia.serie}-${String(guia.correlativo).padStart(8, '0')}`,
      },
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

  private buildPartyCac(
    tipoDoc: string,
    numDoc: string,
    razonSocial: string,
    direccion?: string,
  ): any {
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

  /**
   * Conductores del traslado: el principal y los que la guía traiga además.
   * SUNAT los distingue por cbc:JobTitle ("Principal" / "Secundario").
   */
  private buildDriverPersons(guia: any): any[] {
    const lista: any[] = [];
    if (String(guia.conductorNumDoc || '').trim()) {
      lista.push(this.buildDriverPerson(guia));
    }
    const secundarios = Array.isArray(guia.conductoresSecundarios)
      ? guia.conductoresSecundarios
      : [];
    for (const c of secundarios) {
      // SUNAT exige documento y licencia: un conductor a medias tumba la guía.
      if (!c || !String(c.numDoc || '').trim() || !String(c.licencia || '').trim())
        continue;
      lista.push({
        'cbc:ID': {
          _attributes: {
            schemeID: this.getTipoDocumentoSchemeId(c.tipoDoc || '1'),
          },
          _text: String(c.numDoc).trim(),
        },
        'cbc:FirstName': { _text: String(c.nombres || '').trim() },
        ...(String(c.apellidos || '').trim()
          ? { 'cbc:FamilyName': { _text: String(c.apellidos).trim() } }
          : {}),
        'cbc:JobTitle': { _text: 'Secundario' },
        'cac:IdentityDocumentReference': {
          'cbc:ID': { _text: String(c.licencia).trim().toUpperCase() },
        },
      });
    }
    return lista;
  }

  private buildDriverPerson(guia: any): any {
    const firstName = String(guia.conductorNombre || '').trim();
    const familyName = String(guia.conductorApellidos || '').trim();
    return {
      'cbc:ID': {
        _attributes: {
          schemeID: this.getTipoDocumentoSchemeId(guia.conductorTipoDoc || '1'),
        },
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
    if (guia.transbordoProgramado)
      si.push({ _text: 'SUNAT_Envio_IndicadorTransbordoProgramado' });
    if (guia.retornoVehiculoVacio)
      si.push({ _text: 'SUNAT_Envio_IndicadorRetornoVehiculoVacio' });
    if (guia.retornoEnvasesVacios)
      si.push({ _text: 'SUNAT_Envio_IndicadorRetornoEnvasesVacios' });
    if (guia.vehiculoM1oL)
      si.push({ _text: 'SUNAT_Envio_IndicadorTrasladoVehiculoM1L' });
    return si;
  }

  /**
   * Documentos relacionados al traslado (cac:AdditionalDocumentReference):
   * la factura/boleta que origina el envío, la DAM, la constancia de detracción…
   * El tipo va con el Catálogo 61 y el RUC del emisor con el Catálogo 06.
   */
  private buildAdditionalDocumentReference(guia: any): any[] | undefined {
    const docs = Array.isArray(guia.documentosRelacionados)
      ? guia.documentosRelacionados
      : [];
    const items = docs
      .filter((d: any) => d && String(d.tipo || '').trim() && String(d.numero || '').trim())
      .map((d: any) => {
        const tipo = String(d.tipo).trim();
        const emisor = String(d.emisorNumDoc || '').trim();
        return {
          'cbc:ID': { _text: String(d.numero).trim().toUpperCase() },
          'cbc:DocumentTypeCode': {
            _attributes: {
              listAgencyName: 'PE:SUNAT',
              listName: 'Documento relacionado al transporte',
              listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo61',
            },
            _text: tipo,
          },
          // Descripción legible del tipo. En el esquema UBL va justo después del
          // código y es lo que emiten las implementaciones de referencia; SUNAT
          // la trata como texto libre.
          'cbc:DocumentType': {
            _text: DOC_RELACIONADO_LABEL[tipo] || 'Documento relacionado',
          },
          ...(emisor
            ? {
                'cac:IssuerParty': {
                  'cac:PartyIdentification': {
                    'cbc:ID': {
                      _attributes: {
                        schemeID: /^\d{11}$/.test(emisor) ? '6' : '1',
                        schemeName: 'Documento de Identidad',
                        schemeAgencyName: 'PE:SUNAT',
                        schemeURI:
                          'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
                      },
                      _text: emisor,
                    },
                  },
                },
              }
            : {}),
        };
      });
    return items.length > 0 ? items : undefined;
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
        // Código del bien en el catálogo del emisor. Antes no viajaba: se
        // guardaba en la guía pero no llegaba a SUNAT ni salía en su formato.
        ...(String(detalle.codigoProducto || '').trim()
          ? {
              'cac:SellersItemIdentification': {
                'cbc:ID': { _text: String(detalle.codigoProducto).trim() },
              },
            }
          : {}),
        ...(String(detalle.codigoProductoSunat || '').trim()
          ? {
              'cac:CommodityClassification': {
                'cbc:ItemClassificationCode': {
                  _attributes: {
                    listID: 'UNSPSC',
                    listAgencyName: 'GS1 US',
                    listName: 'Item Classification',
                  },
                  _text: String(detalle.codigoProductoSunat).trim(),
                },
              },
            }
          : {}),
      },
    }));
  }

  // ─── Utility methods ───────────────────────────────────────────────────────

  /**
   * Descripción del motivo de traslado según Catálogo SUNAT N° 20.
   * Se envía en cbc:HandlingInstructions. Si la guía trae observaciones y el
   * motivo es '13' (Otros) o '05' (Consignación), se prioriza el texto libre.
   */
  private motivoTrasladoDescripcion(guia: any): string {
    const descripciones: Record<string, string> = {
      '01': 'VENTA',
      '02': 'COMPRA',
      '03': 'VENTA CON ENTREGA A TERCEROS',
      '04': 'TRASLADO ENTRE ESTABLECIMIENTOS DE LA MISMA EMPRESA',
      '05': 'CONSIGNACION',
      '06': 'DEVOLUCION',
      '07': 'RECOJO DE BIENES TRANSFORMADOS',
      '08': 'IMPORTACION',
      '09': 'EXPORTACION',
      '13': 'OTROS',
      '14': 'VENTA SUJETA A CONFIRMACION DEL COMPRADOR',
      '17': 'TRASLADO DE BIENES PARA TRANSFORMACION',
      '18': 'TRASLADO POR EMISOR ITINERANTE DE COMPROBANTES DE PAGO',
      '19': 'TRASLADO DE MERCANCIA EXTRANJERA',
    };
    const code = String(guia.tipoTraslado || '').trim();
    const base = descripciones[code] || 'OTROS';
    // Para 'Otros' la descripción libre es obligatoria en SUNAT.
    if (code === '13') {
      const obs = String(guia.observaciones || '').trim();
      return obs || base;
    }
    return base;
  }

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
    const map: Record<string, string> = {
      '0': '0',
      '1': '1',
      '6': '6',
      '4': '4',
      '7': '7',
    };
    return map[tipoDoc] || '1';
  }

  private formatDate(date: Date | string): string {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
      return date;
    const d = new Date(date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
