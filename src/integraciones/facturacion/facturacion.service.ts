import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ComprobanteService } from '../../comprobante/comprobante.service';
import { EnviarSunatService } from '../../comprobante/enviar-sunat.service';
import { EmisoresService } from '../emisores/emisores.service';
import {
  ComprobantePublico,
  clienteNormalizado,
  traducirComprobante,
  validarEntrada,
} from './fachada';
import { nuevoIdPublico, serializarComprobante } from './serializador';
import { ErrorDeContrato } from './fachada';
import { esFinal, estadoPublico } from './estado-publico';

/**
 * La API de facturación, apoyada en el motor que ya factura para 61 empresas.
 *
 * No reimplementa nada fiscal: traduce, delega en `ComprobanteService` y
 * traduce de vuelta. La regla es que un comprobante emitido por la API y uno
 * emitido desde el panel sean el mismo comprobante — mismo cálculo de IGV,
 * mismo correlativo, mismo XML. Una segunda implementación "para la API"
 * divergiría en el primer cambio tributario y nadie se enteraría hasta que
 * SUNAT rechazara.
 */
@Injectable()
export class FacturacionApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comprobantes: ComprobanteService,
    private readonly enviarSunat: EnviarSunatService,
    private readonly emisores: EmisoresService,
  ) {}

  /** Lo que se le pide al cliente: todo, y siempre acotado al emisor. */
  private readonly incluirParaSerializar = {
    cliente: { include: { tipoDocumento: { select: { codigo: true } } } },
    detalles: true,
  } as const;

  /**
   * Busca el cliente por su documento dentro del emisor, o lo crea.
   *
   * Por documento y no por nombre: el nombre varía entre integradores para el
   * mismo RUC y crearía un cliente nuevo en cada emisión, llenando la cartera
   * del empresario de duplicados.
   *
   * El alcance es el emisor, no el integrador: dos emisores distintos tienen
   * carteras distintas aunque el cliente final sea el mismo.
   */
  private async resolverCliente(
    empresaId: number,
    publico: NonNullable<ComprobantePublico['customer']>,
  ): Promise<number> {
    const c = clienteNormalizado(publico);
    const tipo = await this.prisma.tipoDocumento.findUnique({
      where: { codigo: c.tipoDocumento },
      select: { id: true },
    });

    const existente = await this.prisma.cliente.findFirst({
      where: { empresaId, nroDoc: c.numeroDocumento },
      select: { id: true, email: true, direccion: true },
    });
    if (existente) {
      // Se completan los datos que llegaron y faltaban, pero no se pisa lo
      // que el empresario ya tenía cargado: su cartera es suya.
      const faltantes: Record<string, string> = {};
      if (c.email && !existente.email) faltantes.email = c.email;
      if (c.direccion && !existente.direccion) faltantes.direccion = c.direccion;
      if (Object.keys(faltantes).length) {
        await this.prisma.cliente.update({ where: { id: existente.id }, data: faltantes });
      }
      return existente.id;
    }

    const creado = await this.prisma.cliente.create({
      data: {
        empresaId,
        nombre: c.nombre,
        nroDoc: c.numeroDocumento,
        tipoDocumentoId: tipo?.id ?? null,
        email: c.email ?? null,
        direccion: c.direccion ?? null,
      },
      select: { id: true },
    });
    return creado.id;
  }

  /** `0101 VENTA INTERNA`: lo que emite el 99% de las operaciones. */
  private async tipoOperacionPorDefecto(): Promise<number> {
    const t = await this.prisma.tipoOperacion.findUnique({
      where: { codigo: '0101' },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Falta el catálogo de tipos de operación.');
    return t.id;
  }

  /**
   * Emite y devuelve de inmediato.
   *
   * El envío a SUNAT no se espera: puede tardar, y hacer que el integrador
   * aguante ese tiempo en su propio request lo obliga a subir timeouts y a
   * reintentar por los suyos, que es justo donde nacen los duplicados. Se
   * devuelve `pending` y el resultado llega por webhook.
   *
   * Si el disparo falla, el comprobante igual queda en `PENDIENTE` y el
   * scheduler lo recoge: no se pierde.
   */
  async emitir(integradorId: number, entrada: ComprobantePublico) {
    const emisor = await this.emisores.resolverParaIntegrador(
      integradorId,
      String(entrada.issuer_id ?? ''),
    );

    // Validar ANTES de resolver el cliente. Al revés, una factura a un DNI
    // —que siempre va a ser rechazada— dejaba igual un cliente nuevo en la
    // cartera del empresario. Lo encontró la QA funcional.
    validarEntrada(entrada);

    const clienteId = await this.resolverCliente(emisor.id, entrada.customer!);
    const dto = traducirComprobante(entrada, {
      clienteId,
      tipoOperacionId: await this.tipoOperacionPorDefecto(),
    });

    const creado = await this.comprobantes.crearFormal(
      dto,
      emisor.id,
      dto.tipoDoc === '01' ? '01' : '03',
    );

    const apiPublicId = nuevoIdPublico('inv');
    await this.prisma.comprobante.update({
      where: { id: creado.id },
      data: { apiPublicId },
    });

    // Se dispara sin esperar. El `catch` no es decoración: una promesa
    // rechazada sin manejar tumba el proceso de Node.
    void this.enviarSunat.execute(creado.id).catch((e) => {
      console.error(`[api-facturacion] envío a SUNAT falló para ${apiPublicId}:`, e?.message);
    });

    const completo = await this.prisma.comprobante.findUnique({
      where: { id: creado.id },
      include: this.incluirParaSerializar,
    });
    return serializarComprobante(completo as any, emisor.apiPublicId!);
  }

  /**
   * Un comprobante por su id público.
   *
   * La consulta exige que el emisor pertenezca al integrador. Sin esa
   * condición, un id adivinado o filtrado dejaría leer el comprobante de otro
   * — y con él, el nombre y el documento de su cliente.
   */
  async obtener(integradorId: number, invoiceId: string) {
    const c = await this.comprobanteDelIntegrador(integradorId, invoiceId);
    return serializarComprobante(c, c.empresa.apiPublicId);
  }


  /**
   * El listado, siempre acotado al integrador y opcionalmente a un emisor.
   *
   * Se pagina por cursor y no por página: con `offset` una emisión nueva
   * corre las filas y el integrador que recorre su historial se saltea
   * comprobantes sin notarlo.
   */
  async listar(
    integradorId: number,
    opciones: { issuerId?: string; limite?: number; cursor?: string } = {},
  ) {
    const limite = Math.min(Math.max(Number(opciones.limite) || 20, 1), 100);
    const emisor = opciones.issuerId
      ? await this.emisores.resolverParaIntegrador(integradorId, opciones.issuerId)
      : null;

    const filas = await this.prisma.comprobante.findMany({
      where: {
        apiPublicId: { not: null },
        empresa: { integradorId },
        ...(emisor ? { empresaId: emisor.id } : {}),
        ...(opciones.cursor ? { id: { lt: Number(opciones.cursor) || 0 } } : {}),
      },
      include: { ...this.incluirParaSerializar, empresa: { select: { apiPublicId: true } } },
      orderBy: { id: 'desc' },
      take: limite + 1, // uno de más: así se sabe si hay página siguiente
    });

    const hayMas = filas.length > limite;
    const pagina = hayMas ? filas.slice(0, limite) : filas;
    return {
      object: 'list',
      data: pagina
        .map((c: any) => serializarComprobante(c, c.empresa.apiPublicId))
        .filter(Boolean),
      has_more: hayMas,
      next_cursor: hayMas ? String(pagina[pagina.length - 1].id) : null,
    };
  }

  /**
   * El comprobante interno detrás de un id público, ya verificado.
   *
   * Todas las operaciones sobre un comprobante pasan por acá: si la condición
   * del integrador se olvidara en una sola de ellas, esa sería la que deje
   * leer o anular lo ajeno.
   */
  private async comprobanteDelIntegrador(integradorId: number, invoiceId: string) {
    const c = await this.prisma.comprobante.findFirst({
      where: { apiPublicId: invoiceId, empresa: { integradorId } },
      include: { ...this.incluirParaSerializar, empresa: { select: { apiPublicId: true } } },
    });
    if (!c) {
      throw new NotFoundException({
        code: 'resource_missing',
        message: `No existe el comprobante ${invoiceId}.`,
      });
    }
    return c as any;
  }

  /**
   * El XML firmado.
   *
   * Existe desde que el comprobante se firma, incluso si SUNAT todavía no
   * contestó: es lo que prueba qué se envió.
   */
  async xml(integradorId: number, invoiceId: string) {
    const c = await this.comprobanteDelIntegrador(integradorId, invoiceId);
    if (!c.sunatXml && !c.s3XmlUrl) {
      throw new NotFoundException({
        code: 'file_not_ready',
        message: 'El XML todavía no está listo. Llega cuando el comprobante se firma.',
      });
    }
    return this.comprobantes.obtenerXmlComprobante(c.empresaId, c.id);
  }

  /**
   * El CDR, la constancia de SUNAT.
   *
   * Se niega explícitamente cuando el estado no lo tiene —`pending`, `sent`,
   * `reconciling`— en vez de devolver un 404 pelado. La diferencia importa:
   * en `reconciling` el comprobante EXISTE para SUNAT y lo que falta es el
   * papel, así que el integrador tiene que esperar, no reemitir.
   */
  async cdr(integradorId: number, invoiceId: string) {
    const c = await this.comprobanteDelIntegrador(integradorId, invoiceId);
    const estado = estadoPublico(c);
    if (!c.sunatCdrZip && !c.s3CdrUrl) {
      throw new NotFoundException({
        code: 'file_not_ready',
        message:
          estado === 'reconciling'
            ? 'SUNAT da el comprobante por registrado pero todavía no entregó el CDR. No lo reemitas: te avisamos por webhook cuando llegue.'
            : 'El CDR todavía no está. Llega cuando SUNAT responde.',
      });
    }
    return {
      buffer: Buffer.from(c.sunatCdrZip ?? '', 'base64'),
      filename: `${c.serie}-${String(c.correlativo).padStart(8, '0')}-CDR.zip`,
      contentType: 'application/zip',
    };
  }

  /** El PDF. Se genera a demanda, así que está desde el primer momento. */
  async pdf(integradorId: number, invoiceId: string, formato: 'a4' | 'a5' | 'ticket' = 'a4') {
    const c = await this.comprobanteDelIntegrador(integradorId, invoiceId);
    const { buffer } = await this.comprobantes.generarBufferPdf(c.id, formato as any);
    return {
      buffer,
      filename: `${c.serie}-${String(c.correlativo).padStart(8, '0')}.pdf`,
      contentType: 'application/pdf',
    };
  }

  /**
   * La comunicación de baja.
   *
   * Solo se puede anular lo que SUNAT aceptó: pedirlo sobre algo que todavía
   * está en camino no es un error del integrador, es que llegó temprano, y el
   * mensaje lo dice así. Sobre un rechazado directamente no tiene sentido —
   * ese comprobante nunca existió para SUNAT.
   */
  async anular(integradorId: number, invoiceId: string, motivo: string) {
    const c = await this.comprobanteDelIntegrador(integradorId, invoiceId);
    const estado = estadoPublico(c);

    if (estado === 'voided') {
      throw new ErrorDeContrato('already_voided', 'Este comprobante ya fue dado de baja.');
    }
    if (estado !== 'accepted' && estado !== 'observed') {
      throw new ErrorDeContrato(
        'invalid_state',
        estado === 'rejected'
          ? 'Un comprobante rechazado no se da de baja: SUNAT nunca lo registró. Emite uno nuevo.'
          : `Solo se da de baja un comprobante aceptado por SUNAT. Este está en "${estado}"; espera el webhook.`,
        'status',
      );
    }
    const texto = String(motivo ?? '').trim();
    if (!texto) {
      throw new ErrorDeContrato('parameter_missing', 'El campo reason es obligatorio: SUNAT exige el motivo de la baja.', 'reason');
    }
    if (texto.length > 100) {
      throw new ErrorDeContrato('parameter_invalid', 'El campo reason no puede superar los 100 caracteres.', 'reason');
    }

    await this.comprobantes.anularComprobante(c.id, texto, c.empresaId);
    const actualizado = await this.comprobanteDelIntegrador(integradorId, invoiceId);
    return serializarComprobante(actualizado, actualizado.empresa.apiPublicId);
  }

  /** Lo que el contrato admite como sustento de una nota de crédito. */
  private static readonly MOTIVOS_NOTA = new Set(
    ['01','02','03','04','05','06','07','08','09','10','11','12','13'],
  );

  /**
   * Una nota de crédito contra un comprobante ya aceptado.
   *
   * El comprobante afectado se resuelve por su id público y se verifica que
   * sea del integrador: sin eso, conocer un `inv_…` ajeno bastaría para
   * emitir notas contra las ventas de otro.
   */
  async crearNotaCredito(integradorId: number, entrada: any) {
    const emisor = await this.emisores.resolverParaIntegrador(
      integradorId,
      String(entrada?.issuer_id ?? ''),
    );
    const afectado = await this.comprobanteDelIntegrador(
      integradorId,
      String(entrada?.affects_invoice_id ?? ''),
    );
    if (afectado.empresaId !== emisor.id) {
      throw new ErrorDeContrato(
        'parameter_invalid',
        'El comprobante afectado pertenece a otro emisor.',
        'affects_invoice_id',
      );
    }

    const estado = estadoPublico(afectado);
    if (estado !== 'accepted' && estado !== 'observed') {
      throw new ErrorDeContrato(
        'invalid_state',
        `Solo se emite una nota de crédito contra un comprobante aceptado. El afectado está en "${estado}".`,
        'affects_invoice_id',
      );
    }

    const motivo = String(entrada?.reason_code ?? '');
    if (!FacturacionApiService.MOTIVOS_NOTA.has(motivo)) {
      throw new ErrorDeContrato(
        'parameter_invalid',
        'reason_code debe ser un código del catálogo 09 de SUNAT (01 a 13).',
        'reason_code',
      );
    }
    const descripcion = String(entrada?.description ?? '').trim();
    if (!descripcion) {
      throw new ErrorDeContrato('parameter_missing', 'El campo description es obligatorio: es el sustento de la nota.', 'description');
    }

    const creada = await this.comprobantes.crearNotaCredito(
      {
        tipoDoc: '07',
        serie: entrada?.series?.trim() || undefined,
        fechaEmision: entrada?.issue_date,
        tipoMoneda: afectado.tipoMoneda ?? 'PEN',
        formaPagoMoneda: afectado.tipoMoneda ?? 'PEN',
        formaPagoTipo: 'Contado',
        clienteId: afectado.clienteId,
        clienteName: afectado.cliente?.nombre ?? '',
        tipoOperacionId: await this.tipoOperacionPorDefecto(),
        motivoId: Number(motivo),
        tipDocAfectado: afectado.tipoDoc,
        numDocAfectado: `${afectado.serie}-${afectado.correlativo}`,
        leyenda: descripcion,
        observaciones: descripcion,
        // Sin líneas propias, la nota afecta el total del comprobante.
        detalles: (afectado.detalles ?? []).map((d: any) => ({
          productoId: d.productoId ?? null,
          descripcion: d.descripcion,
          cantidad: d.cantidad,
          nuevoValorUnitario: d.mtoValorUnitario,
          unidadVenta: d.unidad,
          tipoAfectacionIGV: String(d.tipAfeIgv ?? '10'),
        })),
      },
      emisor.id,
    );

    const apiPublicId = nuevoIdPublico('cn');
    await this.prisma.comprobante.update({
      where: { id: creada.id },
      data: { apiPublicId },
    });
    void this.enviarSunat.execute(creada.id).catch((e) => {
      console.error(`[api-facturacion] envío de nota ${apiPublicId} falló:`, e?.message);
    });

    const completa = await this.prisma.comprobante.findUnique({
      where: { id: creada.id },
      include: this.incluirParaSerializar,
    });
    return {
      ...serializarComprobante(completa as any, emisor.apiPublicId!),
      affects_invoice_id: afectado.apiPublicId,
      reason_code: motivo,
      description: descripcion,
    };
  }

  /** Una nota de crédito por su id público. */
  async obtenerNotaCredito(integradorId: number, id: string) {
    const c = await this.comprobanteDelIntegrador(integradorId, id);
    return serializarComprobante(c, c.empresa.apiPublicId);
  }

  /** Lo usa el serializador de estado para decidir si vale la pena reconsultar. */
  static estadoEsFinal(estado: string): boolean {
    return esFinal(estado as any);
  }
}
