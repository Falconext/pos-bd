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
    return serializarComprobante(c as any, (c as any).empresa.apiPublicId);
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
}
