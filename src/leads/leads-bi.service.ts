import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsConsultasService } from './leads-consultas.service';
import { EtapaCrm } from './leads-embudo';

/**
 * E2 — BI y analítica operativa (punto 27 del anexo).
 *
 * Lo que pidió Hierba Sana, textual: *"Reporte de productos más consultados
 * con disponibilidad vs. no disponibles. Métricas de malestares más
 * consultados, ticket promedio, tasa de conversión y balance de descuentos
 * otorgados. Reporte demográfico de clientes, hombres, mujeres, edad,
 * ubicación (Lima / provincias)"*.
 *
 * Cada número de acá sale de filas, no de releer los chats con IA: así el
 * reporte da lo mismo cada vez que se abre y no cuesta tokens.
 */

export interface RangoBi {
  desde?: string;
  hasta?: string;
}

@Injectable()
export class LeadsBiService {
  constructor(
    private prisma: PrismaService,
    private consultas: LeadsConsultasService,
  ) {}

  /** El rango como lo entiende el negocio: días de Lima, no UTC. */
  private rango(q: RangoBi) {
    if (!q.desde && !q.hasta) return undefined;
    return {
      ...(q.desde && { gte: new Date(`${q.desde}T00:00:00-05:00`) }),
      ...(q.hasta && { lte: new Date(`${q.hasta}T23:59:59-05:00`) }),
    };
  }

  async resumen(empresaId: number, q: RangoBi = {}) {
    const creadoEn = this.rango(q);
    const [productos, malestares, embudo, demografia] = await Promise.all([
      this.productosConsultados(empresaId, creadoEn),
      this.malestaresConsultados(empresaId, creadoEn),
      this.conversionYTicket(empresaId, creadoEn),
      this.demografia(empresaId, creadoEn),
    ]);
    return { productos, malestares, ...embudo, demografia };
  }

  /**
   * Productos más consultados, separando los que SÍ hay de los que no.
   *
   * La columna de "no habidos" es la más accionable de todo el reporte: es
   * demanda real que el negocio está perdiendo por no tener stock, con el
   * nombre tal como lo pide el cliente.
   */
  async productosConsultados(empresaId: number, creadoEn?: object) {
    const filas = await this.prisma.leadConsulta.groupBy({
      by: ['texto', 'hubo'],
      where: { empresaId, tipo: 'PRODUCTO' as never, ...(creadoEn && { creadoEn }) },
      _count: { _all: true },
      orderBy: { _count: { texto: 'desc' } },
      take: 100,
    });

    const agrupar = (hubo: boolean) =>
      filas
        .filter((f) => f.hubo === hubo)
        .map((f) => ({ texto: f.texto, veces: f._count._all }))
        .sort((a, b) => b.veces - a.veces)
        .slice(0, 20);

    const disponibles = agrupar(true);
    const noHabidos = agrupar(false);

    return {
      disponibles,
      noHabidos,
      totalConsultas: filas.reduce((a, f) => a + f._count._all, 0),
      // El porcentaje que se fue sin nada: la cifra que justifica reponer.
      porcentajeSinStock: this.porcentaje(
        noHabidos.reduce((a, f) => a + f.veces, 0),
        filas.reduce((a, f) => a + f._count._all, 0),
      ),
    };
  }

  /** Malestares más consultados: con qué llega la gente. */
  async malestaresConsultados(empresaId: number, creadoEn?: object) {
    const filas = await this.prisma.leadConsulta.groupBy({
      by: ['texto'],
      where: { empresaId, tipo: 'MALESTAR' as never, ...(creadoEn && { creadoEn }) },
      _count: { _all: true },
      orderBy: { _count: { texto: 'desc' } },
      take: 20,
    });
    return filas.map((f) => ({ texto: f.texto, veces: f._count._all }));
  }

  /**
   * Ticket promedio, conversión y balance de descuentos.
   *
   * Conversión = conversaciones con pedido registrado / conversaciones que
   * llegaron. Se cuenta sobre conversaciones y no sobre mensajes: lo que el
   * negocio quiere saber es de cada 10 personas que escriben, cuántas compran.
   */
  async conversionYTicket(empresaId: number, creadoEn?: object) {
    const [conversaciones, pedidos, porEtapa] = await Promise.all([
      this.prisma.leadConversacion.count({
        where: { empresaId, ...(creadoEn && { creadoEn }) },
      }),
      this.prisma.leadPedidoBorrador.findMany({
        where: {
          empresaId,
          comprobanteId: { not: null },
          ...(creadoEn && { registradoEn: creadoEn }),
        },
        select: { comprobanteId: true, descuentoAplicado: true },
      }),
      this.prisma.leadProspecto.groupBy({
        by: ['etapa'],
        where: { empresaId, ...(creadoEn && { creadoEn }) },
        _count: { _all: true },
      }),
    ]);

    const ids = pedidos
      .map((p) => p.comprobanteId)
      .filter((x): x is number => x != null);

    const comprobantes = ids.length
      ? await this.prisma.comprobante.findMany({
          where: { id: { in: ids }, empresaId },
          select: { mtoImpVenta: true },
        })
      : [];

    const montos = comprobantes.map((c) => Number(c.mtoImpVenta ?? 0));
    const vendido = montos.reduce((a, m) => a + m, 0);
    const descuentos = pedidos.reduce(
      (a, p) => a + Number(p.descuentoAplicado ?? 0),
      0,
    );

    return {
      conversaciones,
      pedidos: pedidos.length,
      tasaConversion: this.porcentaje(pedidos.length, conversaciones),
      vendido: this.dos(vendido),
      // Promedio sobre los pedidos que EXISTEN: dividir por las
      // conversaciones daría un "ticket promedio" que ningún cliente pagó.
      ticketPromedio: montos.length ? this.dos(vendido / montos.length) : 0,
      descuentosOtorgados: this.dos(descuentos),
      /// Cuánto del vendido se fue en descuentos: dice si la regla de packs
      /// está comprando ventas o regalando margen.
      pesoDescuentos: this.porcentaje(descuentos, vendido + descuentos),
      porEtapa: Object.values(EtapaCrm).map((etapa) => ({
        etapa,
        total:
          porEtapa.find((p) => String(p.etapa) === etapa)?._count._all ?? 0,
      })),
    };
  }

  /**
   * Demografía: hombres, mujeres, edad y Lima vs. provincias.
   *
   * Sexo y edad solo se cuentan cuando el cliente los dijo. Lo demás va a
   * "sin dato" en vez de inferirse del nombre: un reporte con el 40% de los
   * clientes adivinados es peor que uno que admite lo que no sabe.
   */
  async demografia(empresaId: number, creadoEn?: object) {
    const [prospectos, borradores] = await Promise.all([
      this.prisma.leadProspecto.findMany({
        where: { empresaId, ...(creadoEn && { creadoEn }) },
        select: { sexo: true, edad: true },
      }),
      this.prisma.leadPedidoBorrador.findMany({
        where: { empresaId, ...(creadoEn && { creadoEn: creadoEn }) },
        select: { zona: true, tipoZona: true, destinoRegion: true, lugar: true },
      }),
    ]);

    const sexo = { hombres: 0, mujeres: 0, sinDato: 0 };
    for (const p of prospectos) {
      const v = (p.sexo ?? '').trim().toUpperCase();
      if (v.startsWith('M') && v !== 'MUJER') sexo.hombres++;
      else if (v.startsWith('F') || v === 'MUJER') sexo.mujeres++;
      else sexo.sinDato++;
    }

    // Tramos pensados para este rubro: quién consume suplementos y para qué.
    const TRAMOS: [string, number, number][] = [
      ['18-29', 18, 29],
      ['30-44', 30, 44],
      ['45-59', 45, 59],
      ['60+', 60, 200],
    ];
    const edades = TRAMOS.map(([etiqueta, min, max]) => ({
      etiqueta,
      total: prospectos.filter(
        (p) => p.edad != null && p.edad >= min && p.edad <= max,
      ).length,
    }));
    edades.push({
      etiqueta: 'sin dato',
      total: prospectos.filter((p) => p.edad == null).length,
    });

    // Lima vs. provincias sale de la zona que ya resolvió el envío: es el
    // dato más confiable que hay, porque de él depende cuánto se cobró.
    const ubicacion = { lima: 0, provincia: 0, recojo: 0, sinDato: 0 };
    const distritos = new Map<string, number>();
    for (const b of borradores) {
      const zona = (b.zona ?? '').toLowerCase();
      if (b.tipoZona === 'RECOJO') ubicacion.recojo++;
      else if (zona.includes('lima')) ubicacion.lima++;
      else if (zona) ubicacion.provincia++;
      else ubicacion.sinDato++;
      const lugar = (b.lugar ?? '').trim();
      if (lugar) distritos.set(lugar, (distritos.get(lugar) ?? 0) + 1);
    }

    return {
      sexo,
      edades,
      ubicacion,
      topDistritos: [...distritos.entries()]
        .map(([lugar, total]) => ({ lugar, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 15),
    };
  }

  /**
   * E3 — historial 360° por cliente (punto 28).
   *
   * La vista se arma por TELÉFONO, que es la llave real: en WhatsApp el
   * cliente no tiene usuario ni se identifica. Si tiene DNI, se suman los
   * demás números con el mismo DNI: es la misma persona escribiendo desde
   * otro equipo, y verla partida en dos es la razón por la que se le repite
   * el mismo diagnóstico.
   */
  async historial360(empresaId: number, telefono: string) {
    const base = telefono.replace(/\D/g, '');
    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { empresaId, telefonoProspecto: { contains: base.slice(-9) } },
      select: {
        id: true,
        telefonoProspecto: true,
        nombreProspecto: true,
        etapa: true,
        etapaEn: true,
        estado: true,
        puntaje: true,
        sexo: true,
        edad: true,
        resumen: true,
        puntosClave: true,
        clienteId: true,
        conversacionId: true,
        creadoEn: true,
      },
    });
    if (!prospecto) return null;

    const dni = await this.dniDe(empresaId, prospecto.conversacionId);
    const telefonos = await this.telefonosDelMismoCliente(
      empresaId,
      prospecto.telefonoProspecto,
      dni,
    );

    const [pedidos, consultas, etapas, pagos] = await Promise.all([
      this.pedidosDe(empresaId, telefonos),
      this.consultas.historialDe(empresaId, telefonos),
      this.prisma.leadEtapaHistorial.findMany({
        where: { prospectoId: prospecto.id, empresaId },
        orderBy: { creadoEn: 'asc' },
        select: { desde: true, hacia: true, actor: true, nota: true, creadoEn: true },
      }),
      this.prisma.leadComprobantePago.findMany({
        where: { prospectoId: prospecto.id, empresaId },
        orderBy: { recibidoEn: 'desc' },
        select: {
          id: true,
          url: true,
          recibidoEn: true,
          validadoEn: true,
          validadoPor: true,
          rechazadoEn: true,
          rechazadoMotivo: true,
        },
      }),
    ]);

    const gastado = pedidos.reduce((a, p) => a + p.monto, 0);

    return {
      cliente: {
        ...prospecto,
        dni,
        // Los números unidos. Si hay más de uno, el panel lo muestra: explica
        // por qué aparecen pedidos que no son de este chat.
        telefonos,
        unidoPorDni: telefonos.length > 1,
      },
      pedidos,
      resumenCompras: {
        cantidad: pedidos.length,
        gastado: this.dos(gastado),
        ticketPromedio: pedidos.length ? this.dos(gastado / pedidos.length) : 0,
        ultimaCompra: pedidos[0]?.fecha ?? null,
      },
      consultasDeSalud: consultas.malestares,
      productosConsultados: consultas.productos,
      /// Lo que pidió y no tenemos. Cuando llega, hay a quién avisarle.
      noHabidos: consultas.noHabidos,
      historialEtapas: etapas,
      comprobantesPago: pagos,
    };
  }

  /**
   * Otros números del mismo cliente. Solo se unen por DNI: es el único dato
   * que identifica a una persona sin lugar a duda. Por nombre se SUGIERE, no
   * se une — "Rosa Quispe" hay muchas, y mezclar dos clientes distintos les
   * muestra el historial médico del otro.
   */
  private async telefonosDelMismoCliente(
    empresaId: number,
    telefono: string,
    dni: string | null,
  ): Promise<string[]> {
    if (!dni) return [telefono];
    const otros = await this.prisma.leadPedidoBorrador.findMany({
      where: { empresaId, dni },
      select: { conversacion: { select: { telefonoProspecto: true } } },
    });
    const todos = new Set<string>([telefono]);
    for (const o of otros) {
      if (o.conversacion?.telefonoProspecto) {
        todos.add(o.conversacion.telefonoProspecto);
      }
    }
    return [...todos];
  }

  /**
   * Clientes que PODRÍAN ser el mismo por nombre parecido, para que una
   * persona decida. Nunca se unen solos.
   */
  async sugerenciasDeUnion(empresaId: number, telefono: string) {
    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { empresaId, telefonoProspecto: telefono },
      select: { nombreProspecto: true, telefonoProspecto: true },
    });
    const nombre = (prospecto?.nombreProspecto ?? '').trim();
    if (nombre.length < 4) return [];

    // word_similarity de pg_trgm: tolera tildes, abreviaturas y el orden de
    // nombre y apellido, que es como la gente se guarda en WhatsApp.
    return this.prisma.$queryRaw<
      { telefono: string; nombre: string; parecido: number }[]
    >`
      SELECT "telefonoProspecto" AS telefono,
             "nombreProspecto"   AS nombre,
             word_similarity(${nombre}, "nombreProspecto") AS parecido
        FROM "LeadProspecto"
       WHERE "empresaId" = ${empresaId}
         AND "telefonoProspecto" <> ${telefono}
         AND "nombreProspecto" IS NOT NULL
         AND word_similarity(${nombre}, "nombreProspecto") > 0.5
       ORDER BY parecido DESC
       LIMIT 5`;
  }

  private async dniDe(empresaId: number, conversacionId: number) {
    const b = await this.prisma.leadPedidoBorrador.findFirst({
      where: { empresaId, conversacionId, dni: { not: null } },
      select: { dni: true },
    });
    return b?.dni ?? null;
  }

  private async pedidosDe(empresaId: number, telefonos: string[]) {
    const borradores = await this.prisma.leadPedidoBorrador.findMany({
      where: {
        empresaId,
        comprobanteId: { not: null },
        conversacion: { telefonoProspecto: { in: telefonos } },
      },
      orderBy: { registradoEn: 'desc' },
      select: {
        comprobanteId: true,
        registradoEn: true,
        descuentoAplicado: true,
        zona: true,
        lugar: true,
      },
    });
    const ids = borradores
      .map((b) => b.comprobanteId)
      .filter((x): x is number => x != null);
    const comprobantes = ids.length
      ? await this.prisma.comprobante.findMany({
          where: { id: { in: ids }, empresaId },
          select: {
            id: true,
            serie: true,
            correlativo: true,
            mtoImpVenta: true,
            fechaEmision: true,
            estadoPago: true,
          },
        })
      : [];
    const porId = new Map(comprobantes.map((c) => [c.id, c]));

    return borradores.map((b) => {
      const c = porId.get(b.comprobanteId as number);
      return {
        comprobanteId: b.comprobanteId,
        comprobante: c ? `${c.serie}-${c.correlativo}` : null,
        monto: Number(c?.mtoImpVenta ?? 0),
        descuento: Number(b.descuentoAplicado ?? 0),
        estadoPago: c?.estadoPago ?? null,
        fecha: b.registradoEn ?? c?.fechaEmision ?? null,
        destino: [b.zona, b.lugar].filter(Boolean).join(' · ') || null,
      };
    });
  }

  private dos(n: number) {
    return Math.round(n * 100) / 100;
  }

  private porcentaje(parte: number, total: number) {
    if (!total) return 0;
    return Math.round((parte / total) * 1000) / 10;
  }
}
