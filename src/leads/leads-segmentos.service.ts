import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsDisparadoresService } from './leads-disparadores.service';
import { CATALOGO_DISPAROS, ventanaAbierta } from './leads-disparadores';
import { esNumeroInterno, numerosInternos } from './numeros-internos';
import { EtapaCrm } from './leads-embudo';
import {
  Exclusion,
  FiltrosSegmento,
  HechosContacto,
  TEXTO_EXCLUSION,
  cumpleFiltros,
  exclusionDe,
  normalizarFiltros,
} from './segmentos';

/** Lo que no es una venta: cotizaciones, órdenes de trabajo y notas de crédito/débito. */
const TIPOS_QUE_NO_SON_COMPRA = ['COT', 'OT', '07', '08'];

/** Tope de contactos que se evalúan por segmento. Muy por encima del nivel de mensajería de Meta. */
const MAX_CONTACTOS = 10_000;

const DIA = 24 * 3600_000;

export interface ContactoDelSegmento {
  conversacionId: number;
  prospectoId: number | null;
  telefono: string;
  nombre: string | null;
  canal: string;
  ultimoMensajeDelCliente: Date | null;
  /** null = le llega. */
  exclusion: Exclusion | null;
}

export interface ResultadoSegmento {
  /** Cumplen los filtros. */
  cumplen: number;
  /** Les llegaría el mensaje. */
  recibiran: number;
  excluidos: Record<Exclusion, number>;
  porCanal: Record<string, number>;
  contactos: ContactoDelSegmento[];
}

/** Los últimos 9 dígitos: así se cruza "51987654321" con "987 654 321". */
const ultimos9 = (t: string | null | undefined) =>
  (t ?? '').replace(/\D/g, '').slice(-9);

/**
 * Segmentos: evaluar filtros sobre los contactos y guardarlos con nombre.
 *
 * Solo entran contactos que ya le escribieron al negocio (tienen
 * conversación y son lead). Un envío masivo a números que nunca escribieron
 * es spam aunque se tenga su teléfono, y es lo que hace que Meta bloquee el
 * número.
 */
@Injectable()
export class LeadsSegmentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disparadores: LeadsDisparadoresService,
  ) {}

  normalizar(filtros: unknown): FiltrosSegmento {
    return normalizarFiltros(filtros, Object.values(EtapaCrm));
  }

  /**
   * Quiénes cumplen el filtro y, de ellos, a quiénes les llegaría. La
   * decisión final se vuelve a tomar al enviar (entre hoy y el envío alguien
   * puede darse de baja), pero la cuenta tiene que salir con las mismas
   * reglas para que no haya sorpresas.
   */
  async evaluar(
    empresaId: number,
    crudo: unknown,
    ahora = new Date(),
  ): Promise<ResultadoSegmento> {
    const f = this.normalizar(crudo);

    const convs = await this.prisma.leadConversacion.findMany({
      where: {
        empresaId,
        // `is` ya exige que exista; sin filtros de prospecto basta con que lo haya.
        prospecto:
          f.temperaturas || f.etapas
            ? {
                is: {
                  ...(f.temperaturas
                    ? { estado: { in: f.temperaturas as never[] } }
                    : {}),
                  ...(f.etapas ? { etapa: { in: f.etapas as never[] } } : {}),
                },
              }
            : { isNot: null },
        ...(f.canales ? { canal: { in: f.canales } } : {}),
        ...(f.anuncioIds
          ? { anuncios: { some: { anuncioId: { in: f.anuncioIds } } } }
          : {}),
      },
      orderBy: { actualizadoEn: 'desc' },
      take: MAX_CONTACTOS,
      select: {
        id: true,
        telefonoProspecto: true,
        nombreProspecto: true,
        canal: true,
        prospecto: { select: { id: true } },
        etiquetas: { select: { etiquetaId: true } },
      },
    });
    if (!convs.length) return this.vacio();

    const ids = convs.map((c) => c.id);
    const [ultimos, compras, consultas] = await Promise.all([
      this.ultimosMensajes(ids),
      f.compras
        ? this.comprasDe(empresaId, convs)
        : Promise.resolve(new Map<number, HechosContacto['compras']>()),
      f.consultas
        ? this.consultasDe(empresaId, ids)
        : Promise.resolve(new Map<number, HechosContacto['consultas']>()),
    ]);

    const cumplen = convs.filter((c) =>
      cumpleFiltros(
        f,
        {
          etiquetaIds: c.etiquetas.map((e) => e.etiquetaId),
          compras: compras.get(c.id) ?? [],
          consultas: consultas.get(c.id) ?? [],
          ultimoMensajeDelCliente: ultimos.get(c.id) ?? null,
        },
        ahora,
      ),
    );
    if (!cumplen.length) return this.vacio();

    const telefonos = cumplen.map((c) => c.telefonoProspecto);
    const [config, bajas, internos, recientes] = await Promise.all([
      this.disparadores.configDe(empresaId),
      this.prisma.leadBajaAvisos.findMany({
        where: { empresaId, telefono: { in: telefonos } },
        select: { telefono: true },
      }),
      this.internosDe(empresaId),
      this.marketingRecientesPorTelefono(empresaId, telefonos, ahora),
    ]);
    const deBaja = new Set(bajas.map((b) => b.telefono));

    const contactos: ContactoDelSegmento[] = cumplen.map((c) => {
      const ultimo = ultimos.get(c.id) ?? null;
      return {
        conversacionId: c.id,
        prospectoId: c.prospecto?.id ?? null,
        telefono: c.telefonoProspecto,
        nombre: c.nombreProspecto,
        canal: c.canal,
        ultimoMensajeDelCliente: ultimo,
        exclusion: exclusionDe({
          interno: esNumeroInterno(c.telefonoProspecto, internos),
          deBaja: deBaja.has(c.telefonoProspecto),
          marketingRecientes: recientes.get(c.telefonoProspecto) ?? 0,
          tope: config.topeMarketing,
          canal: c.canal,
          ventanaAbierta: ventanaAbierta(ultimo, ahora),
        }),
      };
    });

    const excluidos = {
      BAJA: 0,
      TOPE: 0,
      SIN_VENTANA: 0,
      INTERNO: 0,
    } as Record<Exclusion, number>;
    const porCanal: Record<string, number> = {};
    let recibiran = 0;
    for (const c of contactos) {
      if (c.exclusion) {
        excluidos[c.exclusion]++;
        continue;
      }
      recibiran++;
      porCanal[c.canal] = (porCanal[c.canal] ?? 0) + 1;
    }
    return {
      cumplen: contactos.length,
      recibiran,
      excluidos,
      porCanal,
      contactos,
    };
  }

  /** Para el panel: la cuenta y una muestra, no los 10 000 contactos. */
  async previsualizar(empresaId: number, filtros: unknown) {
    const r = await this.evaluar(empresaId, filtros);
    // Primero los que reciben, después los excluidos con su motivo.
    const orden = [...r.contactos].sort(
      (a, b) => Number(!!a.exclusion) - Number(!!b.exclusion),
    );
    return {
      cumplen: r.cumplen,
      recibiran: r.recibiran,
      excluidos: r.excluidos,
      porCanal: r.porCanal,
      muestra: orden.slice(0, 50).map((c) => ({
        conversacionId: c.conversacionId,
        nombre: c.nombre,
        telefono: c.telefono,
        canal: c.canal,
        ultimoMensajeDelCliente: c.ultimoMensajeDelCliente,
        motivo: c.exclusion ? TEXTO_EXCLUSION[c.exclusion] : null,
      })),
    };
  }

  // ─── Segmentos guardados ───────────────────────────────────────────────

  async listar(empresaId: number) {
    return this.prisma.leadSegmento.findMany({
      where: { empresaId },
      orderBy: { actualizadoEn: 'desc' },
      select: {
        id: true,
        nombre: true,
        filtrosJson: true,
        actualizadoEn: true,
      },
    });
  }

  async guardar(
    empresaId: number,
    datos: { id?: number; nombre?: string; filtros?: unknown },
  ) {
    const nombre = (datos.nombre ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (!nombre) throw new BadRequestException('Ponle un nombre al segmento.');
    const filtrosJson = this.normalizar(datos.filtros) as object;
    const repetido = await this.prisma.leadSegmento.findFirst({
      where: {
        empresaId,
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(datos.id ? { id: { not: datos.id } } : {}),
      },
      select: { id: true },
    });
    if (repetido)
      throw new BadRequestException(
        `Ya tienes un segmento llamado "${nombre}".`,
      );

    if (datos.id) {
      await this.segmentoDe(empresaId, datos.id);
      return this.prisma.leadSegmento.update({
        where: { id: datos.id },
        data: { nombre, filtrosJson },
        select: {
          id: true,
          nombre: true,
          filtrosJson: true,
          actualizadoEn: true,
        },
      });
    }
    return this.prisma.leadSegmento.create({
      data: { empresaId, nombre, filtrosJson },
      select: {
        id: true,
        nombre: true,
        filtrosJson: true,
        actualizadoEn: true,
      },
    });
  }

  async eliminar(empresaId: number, id: number) {
    await this.segmentoDe(empresaId, id);
    await this.prisma.leadSegmento.delete({ where: { id } });
    return { eliminado: true };
  }

  async segmentoDe(empresaId: number, id: number) {
    const s = await this.prisma.leadSegmento.findFirst({
      where: { id, empresaId },
    });
    if (!s) throw new NotFoundException('Segmento no encontrado');
    return s;
  }

  /** Opciones para armar el filtro: etapas, anuncios y productos/categorías que aparecen. */
  async opciones(empresaId: number) {
    const [anuncios, categorias] = await Promise.all([
      this.prisma.leadAnuncioOrigen.groupBy({
        by: ['anuncioId'],
        where: { empresaId },
        _count: { _all: true },
        _max: { titulo: true, creadoEn: true },
        orderBy: { _max: { creadoEn: 'desc' } },
        take: 50,
      }),
      this.prisma.categoria.findMany({
        where: { empresaId },
        orderBy: { nombre: 'asc' },
        select: { id: true, nombre: true },
        take: 300,
      }),
    ]);
    return {
      etapas: Object.values(EtapaCrm),
      anuncios: anuncios.map((a) => ({
        id: a.anuncioId,
        titulo: a._max.titulo || `Anuncio ${a.anuncioId}`,
        contactos: a._count._all,
      })),
      categorias,
    };
  }

  /**
   * Busca productos por nombre para el filtro de compras/consultas. Con `ids`
   * devuelve esos (el nombre de los que ya están en un segmento guardado).
   */
  async buscarProductos(empresaId: number, q: string, ids?: number[]) {
    if (ids?.length) {
      return this.prisma.producto.findMany({
        where: { empresaId, id: { in: ids.slice(0, 200) } },
        select: { id: true, descripcion: true },
      });
    }
    const texto = (q ?? '').trim();
    if (texto.length < 2) return [];
    return this.prisma.producto.findMany({
      where: {
        empresaId,
        descripcion: { contains: texto, mode: 'insensitive' },
      },
      orderBy: { descripcion: 'asc' },
      take: 20,
      select: { id: true, descripcion: true },
    });
  }

  // ─── Hechos de cada contacto ───────────────────────────────────────────

  private vacio(): ResultadoSegmento {
    return {
      cumplen: 0,
      recibiran: 0,
      excluidos: { BAJA: 0, TOPE: 0, SIN_VENTANA: 0, INTERNO: 0 },
      porCanal: {},
      contactos: [],
    };
  }

  /** Último mensaje del CLIENTE por conversación (el del bot no abre la ventana de Meta). */
  private async ultimosMensajes(ids: number[]): Promise<Map<number, Date>> {
    const out = new Map<number, Date>();
    for (let i = 0; i < ids.length; i += 5000) {
      const grupos = await this.prisma.leadMensaje.groupBy({
        by: ['conversacionId'],
        where: {
          conversacionId: { in: ids.slice(i, i + 5000) },
          rol: 'USUARIO',
        },
        _max: { creadoEn: true },
      });
      for (const g of grupos)
        if (g._max.creadoEn) out.set(g.conversacionId, g._max.creadoEn);
    }
    return out;
  }

  /**
   * Compras de cada contacto, por los dos caminos por los que se registra una
   * venta: el pedido que se cerró en el chat y el comprobante emitido en caja
   * a un cliente con el mismo celular. Solo con el primero, quien compró en
   * la tienda física quedaba como "no compró" y recibía la promo de
   * bienvenida.
   */
  async comprasDe(
    empresaId: number,
    convs: { id: number; telefonoProspecto: string }[],
  ): Promise<Map<number, HechosContacto['compras']>> {
    const ids = convs.map((c) => c.id);
    const porUltimos9 = new Map<string, number[]>();
    for (const c of convs) {
      const k = ultimos9(c.telefonoProspecto);
      if (k.length === 9)
        porUltimos9.set(k, [...(porUltimos9.get(k) ?? []), c.id]);
    }

    const [pedidos, clientes] = await Promise.all([
      this.prisma.leadPedidoBorrador.findMany({
        where: {
          empresaId,
          conversacionId: { in: ids },
          comprobanteId: { not: null },
        },
        select: { conversacionId: true, comprobanteId: true },
      }),
      porUltimos9.size
        ? // Por sus comprobantes en esta empresa y no por Cliente.empresaId,
          // que puede venir vacío en clientes compartidos.
          this.prisma.cliente.findMany({
            where: {
              telefono: { not: null },
              comprobantes: { some: { empresaId } },
            },
            select: { id: true, telefono: true },
          })
        : Promise.resolve([]),
    ]);

    // Cliente del ERP → conversaciones con su celular.
    const convsDeCliente = new Map<number, number[]>();
    for (const cl of clientes) {
      const convIds = porUltimos9.get(ultimos9(cl.telefono));
      if (convIds) convsDeCliente.set(cl.id, convIds);
    }

    const comprobantes = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        tipoDoc: { notIn: TIPOS_QUE_NO_SON_COMPRA },
        OR: [
          { id: { in: pedidos.map((p) => p.comprobanteId as number) } },
          ...(convsDeCliente.size
            ? [{ clienteId: { in: [...convsDeCliente.keys()] } }]
            : []),
        ],
      },
      select: {
        id: true,
        clienteId: true,
        fechaEmision: true,
        estadoPago: true,
        estadoEnvioSunat: true,
        mtoImpVenta: true,
        detalles: {
          select: {
            productoId: true,
            producto: { select: { categoriaId: true } },
          },
        },
      },
    });

    const convsDePedido = new Map<number, number[]>();
    for (const p of pedidos) {
      const k = p.comprobanteId as number;
      convsDePedido.set(k, [...(convsDePedido.get(k) ?? []), p.conversacionId]);
    }

    const out = new Map<number, HechosContacto['compras']>();
    for (const c of comprobantes) {
      if (
        String(c.estadoPago) === 'ANULADO' ||
        String(c.estadoEnvioSunat) === 'ANULADO'
      )
        continue;
      const compra = {
        fecha: c.fechaEmision,
        monto: Number(c.mtoImpVenta ?? 0),
        productoIds: c.detalles
          .map((d) => d.productoId)
          .filter((x): x is number => x != null),
        categoriaIds: c.detalles
          .map((d) => d.producto?.categoriaId)
          .filter((x): x is number => x != null),
      };
      const destinos = new Set([
        ...(convsDePedido.get(c.id) ?? []),
        ...(convsDeCliente.get(c.clienteId) ?? []),
      ]);
      for (const convId of destinos)
        out.set(convId, [...(out.get(convId) ?? []), compra]);
    }
    return out;
  }

  private async consultasDe(empresaId: number, ids: number[]) {
    const filas = await this.prisma.leadConsulta.findMany({
      where: { empresaId, conversacionId: { in: ids } },
      select: {
        conversacionId: true,
        productoId: true,
        hubo: true,
        creadoEn: true,
      },
    });
    const out = new Map<number, HechosContacto['consultas']>();
    for (const q of filas) {
      out.set(q.conversacionId, [
        ...(out.get(q.conversacionId) ?? []),
        { fecha: q.creadoEn, productoId: q.productoId, hubo: q.hubo },
      ]);
    }
    return out;
  }

  async internosDe(empresaId: number): Promise<string[]> {
    const [admins, empresa] = await Promise.all([
      this.prisma.usuario.findMany({
        where: { empresaId, rol: 'ADMIN_EMPRESA' },
        select: { celular: true },
      }),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { iaVentasConfigJson: true },
      }),
    ]);
    const cfg = (empresa?.iaVentasConfigJson ?? {}) as {
      numerosInternos?: string[];
    };
    return numerosInternos(
      admins.map((a) => a.celular),
      cfg.numerosInternos ?? [],
    );
  }

  /** Mensajes comerciales recibidos en la ventana del tope, por teléfono. */
  async marketingRecientesPorTelefono(
    empresaId: number,
    telefonos: string[],
    ahora = new Date(),
  ): Promise<Map<string, number>> {
    const config = await this.disparadores.configDe(empresaId);
    const desde = new Date(ahora.getTime() - config.topeMarketingDias * DIA);
    const grupos = await this.prisma.leadDisparo.groupBy({
      by: ['telefono'],
      where: {
        empresaId,
        telefono: { in: telefonos },
        estado: 'ENVIADO',
        tipo: { in: tiposMarketing() as never[] },
        enviadoEn: { gte: desde },
      },
      _count: { _all: true },
    });
    return new Map(grupos.map((g) => [g.telefono, g._count._all]));
  }
}

/** Los tipos de aviso que cuentan para el tope de mensajes comerciales. */
export function tiposMarketing(): string[] {
  return [
    ...Object.values(CATALOGO_DISPAROS)
      .filter((d) => d.categoria === 'MARKETING')
      .map((d) => d.tipo as string),
    'ENVIO_MASIVO',
  ];
}
