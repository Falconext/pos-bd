import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { estaPausado } from './pausa-bot';
import { esNumeroInterno, numerosInternos } from './numeros-internos';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EtapaCrm, etapaDesdeDespacho } from './leads-embudo';
import { LeadsEmbudoService } from './leads-embudo.service';
import {
  CATALOGO_DISPAROS,
  CONFIG_DISPARADORES_DEFECTO,
  ConfigDisparadores,
  TipoDisparo,
  cuandoDisparar,
  decidirEnvio,
  demoraDe,
  elegirRecompra,
  pideBaja,
  proximoHorarioHabil,
  ventanaAbierta,
} from './leads-disparadores';
import { disponibilidadEfectiva } from '../producto/disponibilidad.util';

/**
 * F — el motor de disparadores y re-engagement.
 *
 * Programa los 7 avisos del anexo, y a la hora de mandarlos vuelve a evaluar
 * TODO: entre que se programa un aviso de recompra y el día en que sale pasan
 * 25 días, y en 25 días el cliente puede haberse dado de baja, haber
 * comprado, o el producto puede haberse agotado.
 *
 * Nada se manda dos veces: la clave única del disparo lo impide, por más
 * veces que corra el cron o se reinicie el servidor.
 */
@Injectable()
export class LeadsDisparadoresService {
  private readonly logger = new Logger(LeadsDisparadoresService.name);

  /** Cuántos avisos como máximo por corrida, para no saturar la API de Meta. */
  private readonly POR_CORRIDA = 50;

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
    private embudo: LeadsEmbudoService,
  ) {}

  /** La configuración de disparadores de la empresa, sobre los valores por defecto. */
  /** Guarda qué avisos están encendidos, sin tocar el resto de la config. */
  async guardarActivos(
    empresaId: number,
    activos: string[],
  ): Promise<ConfigDisparadores> {
    const validos = Object.values(TipoDisparo) as string[];
    const desconocidos = activos.filter((a) => !validos.includes(a));
    if (desconocidos.length) {
      throw new BadRequestException(
        `Avisos desconocidos: ${desconocidos.join(', ')}. Válidos: ${validos.join(', ')}.`,
      );
    }
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true },
    });
    const actual = (empresa?.iaVentasConfigJson ?? {}) as Record<string, unknown>;
    const disparadores = {
      ...((actual.disparadores as Record<string, unknown>) ?? {}),
      activos: [...new Set(activos)],
    };
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { iaVentasConfigJson: { ...actual, disparadores } as never },
    });
    return this.configDe(empresaId);
  }

  async configDe(empresaId: number): Promise<ConfigDisparadores> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true },
    });
    const guardada = (empresa?.iaVentasConfigJson as Record<string, unknown>)
      ?.disparadores as Partial<ConfigDisparadores> | undefined;
    return { ...CONFIG_DISPARADORES_DEFECTO, ...(guardada ?? {}) };
  }

  /**
   * Agenda un aviso. Idempotente: llamarlo dos veces por el mismo hecho deja
   * un solo disparo programado.
   *
   * No valida nada más que "el disparador está encendido": el resto se mira
   * al enviar, porque es entonces cuando importa.
   */
  async programar(datos: {
    empresaId: number;
    tipo: TipoDisparo;
    telefono: string;
    referencia: string;
    desde?: Date;
    /** Fecha exacta (la que dijo el cliente). Se corre al horario hábil. */
    programadoPara?: Date;
    prospectoId?: number | null;
    conversacionId?: number | null;
  }) {
    const config = await this.configDe(datos.empresaId);
    if (!config.activos.includes(datos.tipo)) {
      return { programado: false, motivo: 'disparador apagado' };
    }
    // Los números del propio negocio no reciben avisos automáticos. Ya no
    // entran al embudo; recibir recordatorios de recompra tampoco tiene
    // sentido, y mientras el dueño prueba el bot le caerían a él mismo.
    // Se corta acá y no al enviar: así no se acumulan disparos que nunca van
    // a salir y que después hay que explicar en el panel.
    if (await this.esNumeroDeLaEmpresa(datos.empresaId, datos.telefono)) {
      return { programado: false, motivo: 'número interno del negocio' };
    }

    const programadoPara = datos.programadoPara
      ? proximoHorarioHabil(datos.programadoPara, config)
      : cuandoDisparar(datos.tipo, datos.desde ?? new Date(), config);

    try {
      await this.prisma.leadDisparo.upsert({
        where: {
          empresaId_tipo_telefono_referencia: {
            empresaId: datos.empresaId,
            tipo: datos.tipo as never,
            telefono: datos.telefono,
            referencia: datos.referencia,
          },
        },
        create: {
          empresaId: datos.empresaId,
          tipo: datos.tipo as never,
          telefono: datos.telefono,
          referencia: datos.referencia,
          programadoPara,
          prospectoId: datos.prospectoId ?? null,
          conversacionId: datos.conversacionId ?? null,
        },
        // Si ya existe no se reprograma: el hecho que lo originó es el mismo,
        // y correrle la fecha cada vez que pasa algo lo dejaría para siempre
        // en el futuro sin salir nunca.
        update: {},
      });
      return { programado: true, programadoPara };
    } catch (e: any) {
      this.logger.warn(`No se pudo programar el aviso: ${e?.message}`);
      return { programado: false, motivo: e?.message };
    }
  }

  /**
   * Cancela los avisos que ya no corresponden.
   *
   * El caso que más importa: el cliente contestó. Un recordatorio de
   * "¿seguimos con tu pedido?" después de que el cliente ya respondió deja al
   * negocio como si no leyera sus mensajes.
   */
  async cancelar(
    empresaId: number,
    telefono: string,
    tipos: TipoDisparo[],
    motivo: string,
  ) {
    const { count } = await this.prisma.leadDisparo.updateMany({
      where: {
        empresaId,
        telefono,
        tipo: { in: tipos as never[] },
        estado: 'PROGRAMADO',
      },
      data: { estado: 'CANCELADO', motivo },
    });
    return { cancelados: count };
  }

  /**
   * El cliente pidió la baja. Se registra y se cancela todo lo pendiente.
   *
   * Es lo que promete el pie de cada plantilla de marketing. Dejarlo sin
   * cumplir es lo que hace que reporten el número.
   */
  async registrarBaja(empresaId: number, telefono: string, mensaje?: string) {
    await this.prisma.leadBajaAvisos.upsert({
      where: { empresaId_telefono: { empresaId, telefono } },
      create: { empresaId, telefono, mensaje: mensaje?.slice(0, 300) ?? null },
      update: {},
    });
    const { count } = await this.prisma.leadDisparo.updateMany({
      where: { empresaId, telefono, estado: 'PROGRAMADO' },
      data: { estado: 'CANCELADO', motivo: 'El cliente pidió la baja' },
    });
    this.logger.log(
      `Baja de avisos: ${telefono} (empresa ${empresaId}), ${count} pendientes cancelados.`,
    );
    return { dadoDeBaja: true, cancelados: count };
  }

  /** ¿Este número pidió la baja? */
  /**
   * ¿El número es del propio negocio (el dueño, su equipo, un número de
   * pruebas)? Esos no son clientes: no se les manda publicidad ni
   * recordatorios.
   *
   * Ante un error de consulta devuelve false: dejar de avisarle a un cliente
   * de verdad es peor que mandarle un aviso al dueño.
   */
  async esNumeroDeLaEmpresa(
    empresaId: number,
    telefono: string,
  ): Promise<boolean> {
    try {
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
      return esNumeroInterno(
        telefono,
        numerosInternos(
          admins.map((a) => a.celular),
          cfg.numerosInternos ?? [],
        ),
      );
    } catch (e: any) {
      this.logger.warn(
        `No se pudo saber si ${telefono} es interno de la empresa ${empresaId}: ${e?.message}`,
      );
      return false;
    }
  }

  async estaDeBaja(empresaId: number, telefono: string): Promise<boolean> {
    const fila = await this.prisma.leadBajaAvisos.findUnique({
      where: { empresaId_telefono: { empresaId, telefono } },
      select: { id: true },
    });
    return !!fila;
  }

  /**
   * Si el mensaje entrante es una baja, la registra.
   *
   * Lo llama el processor con cada mensaje: tiene que funcionar incluso con
   * la IA apagada, porque la obligación de respetar la baja no depende de
   * que el bot esté respondiendo.
   */
  async atenderSiEsBaja(empresaId: number, telefono: string, texto: string) {
    if (!pideBaja(texto)) return { eraBaja: false };
    await this.registrarBaja(empresaId, telefono, texto);
    return { eraBaja: true };
  }

  /** El cron: cada 15 minutos mira qué toca mandar. */
  @Cron('*/15 * * * *', { name: 'leads-disparadores' })
  async ejecutar(): Promise<void> {
    const pendientes = await this.prisma.leadDisparo.findMany({
      where: { estado: 'PROGRAMADO', programadoPara: { lte: new Date() } },
      orderBy: { programadoPara: 'asc' },
      take: this.POR_CORRIDA,
    });
    if (!pendientes.length) return;

    let enviados = 0;
    let omitidos = 0;
    for (const d of pendientes) {
      try {
        const r = await this.procesarUno(d.id);
        if (r.enviado) enviados++;
        else omitidos++;
      } catch (e: any) {
        this.logger.warn(`Aviso ${d.id} falló: ${e?.message}`);
        await this.prisma.leadDisparo.update({
          where: { id: d.id },
          data: {
            estado: 'FALLIDO',
            motivo: String(e?.message).slice(0, 300),
            intentos: { increment: 1 },
          },
        });
      }
    }
    this.logger.log(
      `Disparadores: ${enviados} enviados, ${omitidos} no enviados de ${pendientes.length} vencidos.`,
    );
  }

  /**
   * Un aviso, de principio a fin: reunir la situación, decidir, y mandar.
   *
   * Público para poder correrlo desde el panel ("mandar ahora") y desde el QA.
   */
  async procesarUno(disparoId: number): Promise<{
    enviado: boolean;
    motivo?: string;
    via?: string;
  }> {
    const d = await this.prisma.leadDisparo.findUnique({
      where: { id: disparoId },
    });
    if (!d || d.estado !== 'PROGRAMADO') {
      return { enviado: false, motivo: 'ya no está programado' };
    }

    const empresaId = d.empresaId;
    const tipo = d.tipo as unknown as TipoDisparo;
    const def = CATALOGO_DISPAROS[tipo];
    const config = await this.configDe(empresaId);
    const ahora = new Date();

    const [deBaja, situacionChat, marketingRecientes, disponible] =
      await Promise.all([
        // Los internos cuentan como baja al enviar: cubre lo que quedó
        // programado antes de marcar el número como interno.
        Promise.all([
          this.estaDeBaja(empresaId, d.telefono),
          this.esNumeroDeLaEmpresa(empresaId, d.telefono),
        ]).then(([baja, interno]) => baja || interno),
        this.situacionDelChat(empresaId, d.telefono),
        this.marketingRecientes(empresaId, d.telefono, config),
        def.exigeProductoDisponible
          ? this.productoSigueDisponible(empresaId, d.referencia)
          : Promise.resolve(true),
      ]);

    // El seguimiento de la demo no tiene plantilla en Meta: con la ventana
    // cerrada no hay cómo mandarlo. Y si el prospecto siguió conversando
    // después de recibirla, la pregunta ya se respondió sola.
    if (tipo === TipoDisparo.SEGUIMIENTO_DEMO) {
      const ultimo = situacionChat.ultimoMensajeDelCliente;
      const motivo =
        ultimo && ultimo.getTime() > d.creadoEn.getTime() + 3600_000
          ? 'El cliente siguió conversando después de recibir la demo.'
          : !ventanaAbierta(ultimo, ahora)
            ? 'Pasaron más de 24 h desde su último mensaje y este aviso no tiene plantilla.'
            : null;
      if (motivo) {
        await this.prisma.leadDisparo.update({
          where: { id: d.id },
          data: { estado: 'OMITIDO', motivo },
        });
        return { enviado: false, motivo };
      }
    }

    const veredicto = decidirEnvio({
      tipo,
      config,
      ahora,
      dioDeBaja: deBaja,
      ultimoMensajeDelCliente: situacionChat.ultimoMensajeDelCliente,
      botPausado: situacionChat.botPausado,
      plantillaAprobada: true,
      marketingRecientes,
      productoDisponible: disponible,
    });

    if (!veredicto.enviar) {
      if (veredicto.reprogramar) {
        // Se corre a la próxima hora hábil y se vuelve a intentar. Un aviso
        // que no sale por el reloj o porque hay un asesor atendiendo no es un
        // aviso que no corresponda.
        await this.prisma.leadDisparo.update({
          where: { id: d.id },
          data: {
            programadoPara: cuandoDisparar(tipo, ahora, {
              ...config,
              demorasHoras: { ...config.demorasHoras, [tipo]: 1 },
            }),
            motivo: veredicto.motivo,
            intentos: { increment: 1 },
          },
        });
        return { enviado: false, motivo: veredicto.motivo };
      }
      await this.prisma.leadDisparo.update({
        where: { id: d.id },
        data: { estado: 'OMITIDO', motivo: veredicto.motivo },
      });
      return { enviado: false, motivo: veredicto.motivo };
    }

    const { texto, parametros } = await this.armarMensaje(
      empresaId,
      tipo,
      d.referencia,
      situacionChat.nombre,
    );

    const envio =
      veredicto.via === 'texto'
        ? await this.whatsapp.enviarTexto(d.telefono, texto, empresaId)
        : await this.whatsapp.enviarPlantilla(
            d.telefono,
            def.plantilla,
            'es',
            parametros,
            empresaId,
          );

    if (!envio.success) {
      await this.prisma.leadDisparo.update({
        where: { id: d.id },
        data: {
          estado: 'FALLIDO',
          motivo: String(envio.error ?? 'error de WhatsApp').slice(0, 300),
          intentos: { increment: 1 },
        },
      });
      return { enviado: false, motivo: envio.error };
    }

    // Al chat, para que la IA sepa qué preguntó cuando el prospecto conteste.
    if (tipo === TipoDisparo.SEGUIMIENTO_DEMO && situacionChat.id) {
      await this.prisma.leadMensaje
        .create({
          data: {
            conversacionId: situacionChat.id,
            rol: 'ASISTENTE',
            contenido: texto,
          },
        })
        .catch(() => undefined);
    }

    await this.prisma.leadDisparo.update({
      where: { id: d.id },
      data: {
        estado: 'ENVIADO',
        enviadoEn: new Date(),
        plantilla: veredicto.via === 'plantilla' ? def.plantilla : null,
        parametrosJson: parametros,
        textoEnviado: veredicto.via === 'texto' ? texto : null,
        motivo: null,
        intentos: { increment: 1 },
      },
    });
    return { enviado: true, via: veredicto.via };
  }

  /** Lo que hace falta saber del chat: si hay alguien atendiendo y si la ventana sigue abierta. */
  private async situacionDelChat(empresaId: number, telefono: string) {
    const conv = await this.prisma.leadConversacion.findUnique({
      where: { empresaId_telefonoProspecto: { empresaId, telefonoProspecto: telefono } },
      select: {
        id: true,
        nombreProspecto: true,
        // La pausa de la conversación, que es la que respeta el processor.
        botActivo: true,
        pausadoHasta: true,
        mensajes: {
          where: { rol: 'USUARIO' },
          orderBy: { creadoEn: 'desc' },
          take: 1,
          select: { creadoEn: true },
        },
      },
    });

    const pausadoAhora = estaPausado(conv);

    return {
      id: conv?.id ?? null,
      nombre: conv?.nombreProspecto ?? null,
      botPausado: pausadoAhora,
      ultimoMensajeDelCliente: conv?.mensajes[0]?.creadoEn ?? null,
    };
  }

  /** Cuántos avisos de MARKETING recibió en la ventana del tope. */
  private async marketingRecientes(
    empresaId: number,
    telefono: string,
    config: ConfigDisparadores,
  ): Promise<number> {
    const desde = new Date(
      Date.now() - config.topeMarketingDias * 24 * 3600_000,
    );
    const tiposMarketing = Object.values(CATALOGO_DISPAROS)
      .filter((d) => d.categoria === 'MARKETING')
      .map((d) => d.tipo);
    return this.prisma.leadDisparo.count({
      where: {
        empresaId,
        telefono,
        estado: 'ENVIADO',
        tipo: { in: tiposMarketing as never[] },
        enviadoEn: { gte: desde },
      },
    });
  }

  /**
   * Punto 33.7: ¿el producto del aviso sigue disponible?
   *
   * Se mira AHORA y no al programar. Un aviso de recompra agendado hace 25
   * días sobre algo que se agotó ayer manda al cliente a pedir lo que no hay.
   */
  private async productoSigueDisponible(
    empresaId: number,
    referencia: string,
  ): Promise<boolean> {
    const productoId = this.idDeReferencia(referencia, 'producto');
    if (!productoId) return true;
    const p = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { disponibilidad: true, stock: true },
    });
    if (!p) return false;
    return disponibilidadEfectiva(p) === 'INMEDIATA';
  }

  /**
   * El id de una parte de la referencia. Una referencia puede llevar varias
   * ("producto:12:comprobante:829", la recompra de esa compra).
   */
  private idDeReferencia(referencia: string, prefijo: string): number | null {
    const m = new RegExp(`(?:^|:)${prefijo}:(\\d+)(?=:|$)`).exec(referencia);
    return m ? Number(m[1]) : null;
  }

  /**
   * El texto del aviso y los parámetros de su plantilla.
   *
   * Los dos tienen que decir lo MISMO: el cliente no sabe si está dentro o
   * fuera de la ventana de 24 h, y recibir dos redacciones distintas del
   * mismo aviso según la hora se lee como desorden.
   */
  private async armarMensaje(
    empresaId: number,
    tipo: TipoDisparo,
    referencia: string,
    nombreGuardado: string | null,
  ): Promise<{ texto: string; parametros: string[] }> {
    const nombre = (nombreGuardado ?? '').trim().split(' ')[0] || 'hola';
    const saludo = nombre === 'hola' ? 'Hola' : `Hola ${nombre}`;

    const productoId = this.idDeReferencia(referencia, 'producto');
    const producto = productoId
      ? await this.prisma.producto.findFirst({
          where: { id: productoId, empresaId },
          select: { descripcion: true },
        })
      : null;
    const nombreProducto = producto?.descripcion ?? 'tu producto';

    const comprobanteId = this.idDeReferencia(referencia, 'comprobante');
    const comprobante = comprobanteId
      ? await this.prisma.comprobante.findFirst({
          where: { id: comprobanteId, empresaId },
          select: { serie: true, correlativo: true },
        })
      : null;
    const codigo = comprobante
      ? `${comprobante.serie}-${comprobante.correlativo}`
      : 'tu pedido';

    switch (tipo) {
      case TipoDisparo.VUELTA_DISPONIBILIDAD:
        return {
          texto: `${saludo}, buenas noticias: ${nombreProducto} ya está disponible nuevamente. Escríbenos y coordinamos tu pedido.`,
          parametros: [nombre, nombreProducto],
        };
      case TipoDisparo.RECUPERAR_COTIZACION:
        return {
          texto: `${saludo}, ¿seguimos con tu pedido? Te dejé la cotización más temprano y puedo coordinar el despacho cuando me digas.`,
          parametros: [nombre],
        };
      case TipoDisparo.CARRITO_EN_ESPERA:
        return {
          texto: `${saludo}, te escribo como quedamos. Tu pedido sigue reservado; dime si lo preparamos hoy.`,
          parametros: [nombre],
        };
      case TipoDisparo.POST_ENTREGA:
        return {
          texto: `${saludo}, esperamos que estés disfrutando tu pedido ${codigo}. ¿Nos cuentas qué te pareció? Tu opinión nos ayuda a mejorar.`,
          parametros: [nombre, codigo],
        };
      case TipoDisparo.RECOMPRA:
        return {
          texto: `${saludo}, han pasado unas semanas desde que te llevaste ${nombreProducto}. Si ya estás por terminarlo, podemos preparar tu reposición.`,
          parametros: [nombre, nombreProducto],
        };
      case TipoDisparo.REACTIVACION:
        return {
          texto: `${saludo}, hace un tiempo que no sabemos de ti. Tenemos novedades en el catálogo y seguimos a tu disposición.`,
          parametros: [nombre],
        };
      case TipoDisparo.SEGUIMIENTO_DEMO:
        return {
          texto: `${saludo}, ¿qué tal te pareció el sistema? ¿Pudiste revisar la demo? Si tienes alguna duda o quieres ver algo en particular, aquí estoy.`,
          parametros: [nombre],
        };
      case TipoDisparo.RECORDATORIO_ACORDADO:
        return {
          texto: `${saludo}, te escribo como quedamos para retomar tu pedido. ¿Seguimos? Cualquier duda, aquí estoy.`,
          parametros: [nombre],
        };
    }
  }

  /**
   * 33.1 — un producto volvió a estar disponible: avisar a quien lo pidió.
   *
   * La lista de espera sale de LeadConsulta: quien preguntó por ese producto
   * y se fue sin nada. No hace falta que nadie se anote a mano.
   */
  async avisarVueltaDeDisponibilidad(empresaId: number, productoId: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { descripcion: true, disponibilidad: true, stock: true },
    });
    if (!producto) return { avisados: 0 };
    if (disponibilidadEfectiva(producto) !== 'INMEDIATA') {
      return { avisados: 0, motivo: 'el producto no está disponible' };
    }

    // Quienes lo consultaron y no lo pudieron llevar, en los últimos 90 días.
    // Más atrás, el interés ya no es interés.
    const desde = new Date(Date.now() - 90 * 24 * 3600_000);
    const esperando = await this.prisma.leadConsulta.findMany({
      where: {
        empresaId,
        creadoEn: { gte: desde },
        OR: [{ productoId, hubo: false }, { productoId, disponibilidad: { not: 'INMEDIATA' } }],
      },
      distinct: ['telefono'],
      select: { telefono: true, conversacionId: true, prospectoId: true },
    });

    let avisados = 0;
    for (const e of esperando) {
      const r = await this.programar({
        empresaId,
        tipo: TipoDisparo.VUELTA_DISPONIBILIDAD,
        telefono: e.telefono,
        referencia: `producto:${productoId}`,
        prospectoId: e.prospectoId,
        conversacionId: e.conversacionId,
      });
      if (r.programado) avisados++;
    }
    this.logger.log(
      `Vuelta a disponibilidad de "${producto.descripcion}": ${avisados} avisos programados.`,
    );
    return { avisados };
  }

  /**
   * 33.1 — red de seguridad: productos que volvieron a estar disponibles y
   * tienen gente esperando a la que nadie avisó.
   *
   * El aviso inmediato sale cuando el negocio cambia la disponibilidad desde
   * el editor. Pero la disponibilidad también cambia por importación de
   * Excel, desde la app móvil o por una venta que repone stock, y por esos
   * caminos nadie llama a nada. Esto lo cubre: busca lo que quedó sin avisar
   * y lo programa. Es idempotente, así que no duplica lo ya avisado.
   */
  @Cron('0 14 * * *', { name: 'leads-vueltas-disponibilidad' })
  async revisarVueltasDeDisponibilidad(): Promise<void> {
    const empresas = await this.prisma.empresa.findMany({
      where: { iaVentasActiva: true },
      select: { id: true },
    });

    for (const { id: empresaId } of empresas) {
      const config = await this.configDe(empresaId);
      if (!config.activos.includes(TipoDisparo.VUELTA_DISPONIBILIDAD)) continue;

      // Productos que alguien pidió y no pudo llevarse en los últimos 90 días.
      const desde = new Date(Date.now() - 90 * 24 * 3600_000);
      const esperados = await this.prisma.leadConsulta.findMany({
        where: {
          empresaId,
          creadoEn: { gte: desde },
          productoId: { not: null },
          OR: [{ hubo: false }, { disponibilidad: { not: 'INMEDIATA' } }],
        },
        distinct: ['productoId'],
        select: { productoId: true },
      });
      if (!esperados.length) continue;

      let programados = 0;
      for (const e of esperados) {
        const r = await this.avisarVueltaDeDisponibilidad(
          empresaId,
          e.productoId as number,
        );
        programados += r.avisados;
      }
      if (programados) {
        this.logger.log(
          `Vueltas a disponibilidad (empresa ${empresaId}): ${programados} avisos programados.`,
        );
      }
    }
  }

  /**
   * 33.6 — reactivación de inactivos.
   *
   * Corre una vez al día, no con cada mensaje: la inactividad es una
   * condición del tiempo, no de un hecho puntual. A las 10 de la mañana de
   * Lima, que es cuando la gente mira el teléfono.
   */
  @Cron('0 15 * * *', { name: 'leads-reactivacion' })
  async programarReactivaciones(): Promise<void> {
    const empresas = await this.prisma.empresa.findMany({
      where: { iaVentasActiva: true },
      select: { id: true },
    });

    for (const { id: empresaId } of empresas) {
      const config = await this.configDe(empresaId);
      if (!config.activos.includes(TipoDisparo.REACTIVACION)) continue;

      const dias =
        (config.demorasHoras?.[TipoDisparo.REACTIVACION] ??
          CATALOGO_DISPAROS[TipoDisparo.REACTIVACION].demoraHoras) / 24;
      const corte = new Date(Date.now() - dias * 24 * 3600_000);

      // "Clientes habituales", como dice el anexo: los que YA compraron. A
      // quien nunca compró no se le reactiva nada — eso es prospección, y
      // molesta.
      const candidatos = await this.prisma.leadPedidoBorrador.findMany({
        where: { empresaId, comprobanteId: { not: null } },
        distinct: ['conversacionId'],
        select: {
          conversacionId: true,
          registradoEn: true,
          conversacion: {
            select: { telefonoProspecto: true, actualizadoEn: true },
          },
        },
      });

      let programados = 0;
      for (const c of candidatos) {
        const ultimaActividad = c.conversacion?.actualizadoEn;
        if (!ultimaActividad || ultimaActividad > corte) continue;
        const telefono = c.conversacion?.telefonoProspecto;
        if (!telefono) continue;
        // La referencia lleva el mes: así se puede reactivar de nuevo el año
        // que viene, pero no dos veces el mismo mes.
        const periodo = ultimaActividad.toISOString().slice(0, 7);
        const r = await this.programar({
          empresaId,
          tipo: TipoDisparo.REACTIVACION,
          telefono,
          referencia: `inactivo:${periodo}`,
          desde: new Date(),
          conversacionId: c.conversacionId,
        });
        if (r.programado) programados++;
      }
      if (programados) {
        this.logger.log(
          `Reactivación (empresa ${empresaId}): ${programados} avisos programados.`,
        );
      }
    }
  }

  /**
   * Pone el embudo al día con la logística y programa lo que nace de ahí
   * (33.4 post-entrega y 33.5 recompra).
   *
   * Es una reconciliación y no un aviso que el despacho empuje, por dos
   * razones: el módulo de despacho no puede depender del de leads sin crear
   * un ciclo, y una reconciliación arregla también lo que quedó atrás —un
   * empujón solo arregla lo que pasa desde que se instala.
   *
   * Es idempotente: mover a una etapa en la que ya está no hace nada, y los
   * disparos tienen clave única.
   */
  @Cron('*/15 * * * *', { name: 'leads-sync-despacho' })
  async reconciliarConDespachos(): Promise<void> {
    const pedidos = await this.prisma.leadPedidoBorrador.findMany({
      where: { comprobanteId: { not: null } },
      select: {
        empresaId: true,
        conversacionId: true,
        comprobanteId: true,
        itemsJson: true,
        conversacion: { select: { telefonoProspecto: true } },
      },
      orderBy: { registradoEn: 'desc' },
      take: 300,
    });
    if (!pedidos.length) return;

    const despachos = await this.prisma.envioDespacho.findMany({
      where: {
        comprobanteId: {
          in: pedidos.map((p) => p.comprobanteId as number),
        },
      },
      select: { comprobanteId: true, estado: true, entregadoEn: true },
    });
    const porComprobante = new Map(
      despachos.map((d) => [d.comprobanteId, d]),
    );

    let movidos = 0;
    let programados = 0;
    for (const p of pedidos) {
      const despacho = porComprobante.get(p.comprobanteId as number);
      if (!despacho) continue;
      const telefono = p.conversacion?.telefonoProspecto;
      if (!telefono) continue;

      const etapa = etapaDesdeDespacho(String(despacho.estado));
      if (etapa) {
        const prospecto = await this.prisma.leadProspecto.findFirst({
          where: { conversacionId: p.conversacionId, empresaId: p.empresaId },
          select: { id: true },
        });
        if (prospecto) {
          // La logística es una persona del equipo reportando, así que puede
          // mover etapas con candado humano (REPROGRAMADO por devolución).
          const r = await this.embudo.mover(
            prospecto.id,
            p.empresaId,
            etapa,
            { usuario: { nombre: 'logística' }, nota: `Despacho en ${despacho.estado}` },
          );
          if (r.movido) movidos++;
        }
      }

      if (etapa !== EtapaCrm.ENTREGADO) continue;

      // 33.4 — reseña a las 24 h de la entrega CONFIRMADA. Se cuenta desde la
      // hora real de entrega, no desde ahora: si el cron descubre la entrega
      // tres días después, el aviso no puede salir con tres días de retraso.
      const entregadoEn = despacho.entregadoEn ?? new Date();
      const r1 = await this.programar({
        empresaId: p.empresaId,
        tipo: TipoDisparo.POST_ENTREGA,
        telefono,
        referencia: `comprobante:${p.comprobanteId}`,
        desde: entregadoEn,
        conversacionId: p.conversacionId,
      });
      if (r1.programado) programados++;

      // 33.5 — recompra: cada producto dice a los cuántos días se acaba
      // (25 por defecto). Ver elegirRecompra.
      if (await this.programarRecompra(p, telefono, entregadoEn)) programados++;
    }

    if (movidos || programados) {
      this.logger.log(
        `Sincronización con despacho: ${movidos} etapas al día, ${programados} avisos programados.`,
      );
    }
  }

  /**
   * El aviso de recompra de una compra entregada.
   *
   * La referencia lleva la compra: antes era solo el producto, y como un
   * aviso no se repite, el cliente que compraba lo mismo cada mes recibía el
   * recordatorio una sola vez en la vida. Cada cliente tiene un solo pedido
   * de chat (el nuevo reemplaza al anterior), así que si volvió a comprar
   * antes de que saliera el aviso viejo, ese aviso ya no corresponde.
   */
  private async programarRecompra(
    p: { empresaId: number; conversacionId: number; comprobanteId: number | null; itemsJson: unknown },
    telefono: string,
    entregadoEn: Date,
  ): Promise<boolean> {
    const items = Array.isArray(p.itemsJson)
      ? (p.itemsJson as { productoId?: number }[])
      : [];
    const ids = items
      .map((i) => Number(i?.productoId))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length || !p.comprobanteId) return false;

    const [productos, config] = await Promise.all([
      this.prisma.producto.findMany({
        where: { id: { in: ids }, empresaId: p.empresaId },
        select: {
          id: true,
          diasRecompra: true,
          productoPadre: { select: { diasRecompra: true } },
        },
      }),
      this.configDe(p.empresaId),
    ]);
    const eleccion = elegirRecompra(
      ids,
      productos.map((x) => ({
        id: x.id,
        diasRecompra: x.diasRecompra,
        diasRecompraPadre: x.productoPadre?.diasRecompra ?? null,
      })),
      demoraDe(TipoDisparo.RECOMPRA, config) / 24,
    );
    if (!eleccion) return false;

    const referencia = `producto:${eleccion.productoId}:comprobante:${p.comprobanteId}`;
    const r = await this.programar({
      empresaId: p.empresaId,
      tipo: TipoDisparo.RECOMPRA,
      telefono,
      referencia,
      programadoPara: new Date(entregadoEn.getTime() + eleccion.dias * 24 * 3600_000),
      conversacionId: p.conversacionId,
    });
    if (!r.programado) return false;
    await this.prisma.leadDisparo.updateMany({
      where: {
        empresaId: p.empresaId,
        telefono,
        tipo: TipoDisparo.RECOMPRA as never,
        estado: 'PROGRAMADO',
        referencia: { not: referencia },
      },
      data: { estado: 'CANCELADO', motivo: 'Volvió a comprar: el aviso va por la compra nueva' },
    });
    return true;
  }

  /** Lo que el panel muestra: qué está por salir y qué salió. */
  async listar(
    empresaId: number,
    filtros: { estado?: string; tipo?: string } = {},
  ) {
    const where = {
      empresaId,
      ...(filtros.estado ? { estado: filtros.estado as never } : {}),
      ...(filtros.tipo ? { tipo: filtros.tipo as never } : {}),
    };
    const [filas, porEstado, bajas] = await Promise.all([
      this.prisma.leadDisparo.findMany({
        where,
        orderBy: [{ programadoPara: 'desc' }],
        take: 100,
        select: {
          id: true,
          tipo: true,
          telefono: true,
          referencia: true,
          programadoPara: true,
          estado: true,
          motivo: true,
          plantilla: true,
          textoEnviado: true,
          enviadoEn: true,
        },
      }),
      this.prisma.leadDisparo.groupBy({
        by: ['estado'],
        where: { empresaId },
        _count: { _all: true },
      }),
      this.prisma.leadBajaAvisos.count({ where: { empresaId } }),
    ]);

    return {
      disparos: filas,
      porEstado: porEstado.map((p) => ({
        estado: String(p.estado),
        total: p._count._all,
      })),
      bajas,
    };
  }
}
