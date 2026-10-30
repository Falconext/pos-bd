import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NOTA_SIN_CONVERTIR } from '../comprobante/convertidos';
import {
  MAX_INTENTOS,
  TIPOS_VENTA,
  VENTANA_MS,
  armarEvento,
  celular9,
  claveDeLead,
  claveDeVenta,
  clicAtribuible,
  errorDeMeta,
  type Clic,
  type EventoMeta,
} from './meta-conversiones';

interface ConfigConversiones {
  activo?: boolean;
  /** Dataset de Meta de cada WABA: se pide una vez y se recuerda. */
  datasets?: Record<string, string>;
  /** Último problema al hablar con Meta, para mostrarlo en el panel. */
  ultimoError?: string | null;
}

interface ChatConClic {
  id: number;
  numeroWhatsappId: string | null;
  telefonoProspecto: string;
  canal: string;
  clienteId: number | null;
  comprobanteId: number | null;
  notificadoEn: Date | null;
  clics: Clic[];
}

const anulado = (c: { estadoPago?: unknown; estadoEnvioSunat?: unknown }) =>
  String(c.estadoPago) === 'ANULADO' ||
  ['ANULADO', 'RECHAZADO'].includes(String(c.estadoEnvioSunat));

/**
 * API de Conversiones de Meta (ver meta-conversiones.ts).
 *
 * No se engancha a cada lugar donde nace una venta (POS, nota desde el chat,
 * pedido de la tienda, conversión de NV…): cada 10 minutos mira las ventas de
 * los últimos 7 días y busca las de clientes que llegaron por un anuncio. Así
 * cuenta también la nota hecha a mano para ese cliente, y avisar a Meta nunca
 * puede trabar una venta.
 */
@Injectable()
export class MetaConversionesService {
  private readonly logger = new Logger(MetaConversionesService.name);
  private corriendo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private get graph(): string {
    return (process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
  }

  private async configDe(empresaId: number): Promise<ConfigConversiones> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true },
    });
    return ((e?.iaVentasConfigJson as Record<string, unknown>)?.metaConversiones ?? {}) as ConfigConversiones;
  }

  private async guardarConfig(empresaId: number, cambios: ConfigConversiones) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true },
    });
    const json = { ...((e?.iaVentasConfigJson as Record<string, unknown>) ?? {}) };
    const previa = (json.metaConversiones as ConfigConversiones) ?? {};
    json.metaConversiones = {
      ...previa,
      ...cambios,
      datasets: { ...(previa.datasets ?? {}), ...(cambios.datasets ?? {}) },
    };
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { iaVentasConfigJson: json as never },
    });
  }

  // ─── Panel ────────────────────────────────────────────────────────────────

  async estado(empresaId: number) {
    const desde = new Date(Date.now() - 30 * 24 * 3600_000);
    const [config, cuenta, filas, ultimos] = await Promise.all([
      this.configDe(empresaId),
      this.whatsapp.cuentaMetaDelChat(empresaId),
      this.prisma.metaEventoConversion.groupBy({
        by: ['evento', 'estado'],
        where: { empresaId, creadoEn: { gte: desde } },
        _count: { _all: true },
        _sum: { valor: true },
      }),
      this.prisma.metaEventoConversion.findMany({
        where: { empresaId },
        orderBy: { creadoEn: 'desc' },
        take: 10,
        select: {
          id: true,
          evento: true,
          valor: true,
          moneda: true,
          estado: true,
          error: true,
          ocurridoEn: true,
          comprobanteId: true,
          conversacionId: true,
        },
      }),
    ]);

    const contar = (evento: string, estado: string) =>
      filas.find((f) => f.evento === evento && f.estado === estado)?._count._all ?? 0;
    const compras = filas.filter((f) => f.evento === 'Purchase' && f.estado === 'ENVIADO');

    const [comprobantes, prospectos] = await Promise.all([
      this.prisma.comprobante.findMany({
        where: { id: { in: ultimos.map((u) => u.comprobanteId).filter((x): x is number => x != null) } },
        select: { id: true, serie: true, correlativo: true },
      }),
      this.prisma.leadProspecto.findMany({
        where: { conversacionId: { in: ultimos.map((u) => u.conversacionId) } },
        select: { conversacionId: true, nombreProspecto: true, telefonoProspecto: true },
      }),
    ]);

    return {
      activo: config.activo === true,
      conectado: !!cuenta,
      datasetId: cuenta ? (config.datasets?.[cuenta.wabaId] ?? null) : null,
      ultimoError: config.ultimoError ?? null,
      ultimos30Dias: {
        comprasAvisadas: compras.reduce((a, f) => a + f._count._all, 0),
        montoAvisado: compras.reduce((a, f) => a + Number(f._sum.valor ?? 0), 0),
        leadsAvisados: contar('LeadSubmitted', 'ENVIADO'),
        pendientes: filas.filter((f) => f.estado === 'PENDIENTE').reduce((a, f) => a + f._count._all, 0),
        conError: filas.filter((f) => f.estado === 'ERROR').reduce((a, f) => a + f._count._all, 0),
      },
      ultimos: ultimos.map((u) => {
        const c = comprobantes.find((x) => x.id === u.comprobanteId);
        const p = prospectos.find((x) => x.conversacionId === u.conversacionId);
        return {
          id: u.id,
          evento: u.evento,
          valor: u.valor != null ? Number(u.valor) : null,
          moneda: u.moneda,
          estado: u.estado,
          error: u.error,
          ocurridoEn: u.ocurridoEn,
          comprobante: c ? `${c.serie}-${c.correlativo}` : null,
          cliente: p?.nombreProspecto || p?.telefonoProspecto || null,
        };
      }),
    };
  }

  async activar(empresaId: number, activo: boolean) {
    if (activo) {
      const cuenta = await this.whatsapp.cuentaMetaDelChat(empresaId);
      if (!cuenta) {
        throw new BadRequestException(
          'Primero conecta el WhatsApp de tu negocio: Meta solo recibe compras de la cuenta donde corren tus anuncios.',
        );
      }
    }
    await this.guardarConfig(empresaId, { activo });
    if (activo) {
      // Que el panel diga enseguida si Meta acepta, y que lo de los últimos
      // 7 días salga ya y no en el próximo turno del cron.
      await this.sincronizar(empresaId).catch((e) =>
        this.logger.warn(`Conversiones empresa ${empresaId}: ${e?.message}`),
      );
    }
    return this.estado(empresaId);
  }

  /**
   * Verifica la conexión con Meta (obtiene o crea el dataset de la WABA) y
   * manda lo pendiente.
   *
   * Con `testEventCode` (Administrador de eventos → Probar eventos) manda en
   * cambio UNA compra de prueba con el último clic real: aparece ahí en vivo
   * y no se mezcla con las ventas de verdad, que Meta no usaría si llegaran
   * marcadas como prueba.
   */
  async probar(empresaId: number, testEventCode?: string) {
    const cuenta = await this.whatsapp.cuentaMetaDelChat(empresaId);
    if (!cuenta) throw new BadRequestException('Tu WhatsApp no está conectado.');
    const codigo = testEventCode?.trim();
    try {
      const dataset = await this.datasetDe(empresaId, cuenta.wabaId, cuenta.token, true);
      if (codigo) {
        const clic = await this.prisma.leadAnuncioOrigen.findFirst({
          where: { empresaId, ctwaClid: { not: null } },
          orderBy: { creadoEn: 'desc' },
          select: { ctwaClid: true },
        });
        if (!clic?.ctwaClid) {
          throw new BadRequestException(
            'Todavía no te escribió nadie desde un anuncio: la prueba necesita un clic real de anuncio.',
          );
        }
        await axios.post(
          `${this.graph}/${dataset}/events`,
          {
            data: [
              armarEvento({
                evento: 'Purchase',
                clave: `prueba-${Date.now()}`,
                fecha: new Date(),
                wabaId: cuenta.wabaId,
                ctwaClid: clic.ctwaClid,
                valor: 1,
                moneda: 'PEN',
              }),
            ],
            test_event_code: codigo,
          },
          { headers: { Authorization: `Bearer ${cuenta.token}` }, timeout: 20000 },
        );
      }
      await this.guardarConfig(empresaId, { ultimoError: null });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      const msg = errorDeMeta(e);
      await this.guardarConfig(empresaId, { ultimoError: msg });
      throw new BadRequestException(msg);
    }
    const r = codigo ? { detectados: 0, enviados: 0, fallidos: 0, prueba: true } : await this.sincronizar(empresaId);
    if (r.fallidos) {
      const { ultimoError } = await this.configDe(empresaId);
      throw new BadRequestException(ultimoError || 'Meta no aceptó los eventos.');
    }
    return { ...(await this.estado(empresaId)), ...r };
  }

  // ─── Cron ─────────────────────────────────────────────────────────────────

  @Cron('*/10 * * * *', { name: 'leads-meta-conversiones' })
  async ejecutar(): Promise<void> {
    if (process.env.META_CONVERSIONES_JOBS_ENABLED === 'false' || this.corriendo) return;
    this.corriendo = true;
    try {
      const empresas = await this.prisma.empresa.findMany({
        where: { iaVentasConfigJson: { path: ['metaConversiones', 'activo'], equals: true } },
        select: { id: true },
      });
      for (const e of empresas) {
        await this.sincronizar(e.id).catch((err) =>
          this.logger.warn(`Conversiones empresa ${e.id}: ${err?.message}`),
        );
      }
    } finally {
      this.corriendo = false;
    }
  }

  /** Detecta lo nuevo y manda lo pendiente de una empresa. */
  async sincronizar(empresaId: number) {
    const detectados = await this.detectar(empresaId);
    const envio = await this.enviarPendientes(empresaId);
    return { detectados, ...envio };
  }

  // ─── Detección ────────────────────────────────────────────────────────────

  /** Chats con algún clic de anuncio que todavía puede atribuir algo. */
  private async chatsConClic(empresaId: number, ahora: Date): Promise<ChatConClic[]> {
    // Una venta de hace 7 días puede venir de un clic de 7 días antes.
    const desde = new Date(ahora.getTime() - 2 * VENTANA_MS);
    const llegadas = await this.prisma.leadAnuncioOrigen.findMany({
      where: {
        empresaId,
        ctwaClid: { not: null },
        creadoEn: { gte: desde },
        // Igual que el reporte: los chats de prueba del negocio no tienen prospecto.
        conversacion: { prospecto: { isNot: null } },
      },
      select: {
        ctwaClid: true,
        creadoEn: true,
        conversacion: {
          select: {
            id: true,
            numeroWhatsappId: true,
            telefonoProspecto: true,
            canal: true,
            prospecto: { select: { clienteId: true, notificadoEn: true } },
            borrador: { select: { comprobanteId: true } },
          },
        },
      },
    });
    const porChat = new Map<number, ChatConClic>();
    for (const l of llegadas) {
      const c = l.conversacion;
      const chat =
        porChat.get(c.id) ??
        ({
          id: c.id,
          numeroWhatsappId: c.numeroWhatsappId,
          telefonoProspecto: c.telefonoProspecto,
          canal: c.canal,
          clienteId: c.prospecto?.clienteId ?? null,
          comprobanteId: c.borrador?.comprobanteId ?? null,
          notificadoEn: c.prospecto?.notificadoEn ?? null,
          clics: [],
        } as ChatConClic);
      chat.clics.push({ ctwaClid: l.ctwaClid, creadoEn: l.creadoEn });
      porChat.set(c.id, chat);
    }
    return [...porChat.values()];
  }

  async detectar(empresaId: number, ahora = new Date()): Promise<number> {
    const chats = await this.chatsConClic(empresaId, ahora);
    if (!chats.length) return 0;
    const desde = new Date(ahora.getTime() - VENTANA_MS);

    // Cómo se reconoce que una venta es de ese chat, de lo más seguro a lo
    // menos: la nota que salió del pedido del chat, el cliente en que se
    // convirtió el prospecto, o su celular en la ficha del cliente.
    const porComprobante = new Map<number, ChatConClic[]>();
    const porCliente = new Map<number, ChatConClic[]>();
    const porCelular = new Map<string, ChatConClic[]>();
    const agregar = <K>(m: Map<K, ChatConClic[]>, k: K, c: ChatConClic) => m.set(k, [...(m.get(k) ?? []), c]);
    for (const c of chats) {
      if (c.comprobanteId) agregar(porComprobante, c.comprobanteId, c);
      if (c.clienteId) agregar(porCliente, c.clienteId, c);
      const cel = c.canal === 'WHATSAPP' ? celular9(c.telefonoProspecto) : null;
      if (cel) agregar(porCelular, cel, c);
    }
    // Se compara por dígitos: en la ficha el celular suele estar como
    // "987 654 321" o "+51 987654321", y un `endsWith` no lo encontraba.
    const clientesPorCelular = porCelular.size
      ? await this.prisma.$queryRaw<{ id: number; telefono: string | null }[]>`
          SELECT id, telefono FROM "Cliente"
          WHERE "empresaId" = ${empresaId}
            AND right(regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g'), 9) = ANY(${[...porCelular.keys()]})`
      : [];
    const celularDeCliente = new Map<number, string>();
    for (const cl of clientesPorCelular) {
      const cel = celular9(cl.telefono);
      if (cel && porCelular.has(cel)) celularDeCliente.set(cl.id, cel);
    }
    const clienteIds = [...new Set([...porCliente.keys(), ...celularDeCliente.keys()])];

    const ventas = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        creadoEn: { gte: desde, lte: ahora },
        OR: [
          { id: { in: [...porComprobante.keys()] } },
          ...(clienteIds.length ? [{ clienteId: { in: clienteIds } }] : []),
        ],
        AND: [
          {
            OR: [
              { tipoDoc: { in: ['01', '03'] } },
              // Una nota ya convertida cuenta por su boleta o factura.
              { tipoDoc: { in: TIPOS_VENTA.filter((t) => !['01', '03'].includes(t)) }, ...NOTA_SIN_CONVERTIR },
            ],
          },
        ],
      },
      select: {
        id: true,
        tipoDoc: true,
        comprobanteOrigenId: true,
        clienteId: true,
        mtoImpVenta: true,
        tipoMoneda: true,
        creadoEn: true,
        estadoPago: true,
        estadoEnvioSunat: true,
      },
    });

    const filas: any[] = [];
    const cuentas = new Map<string, { wabaId: string } | null>();
    const cuentaDe = async (chat: ChatConClic) => {
      const k = chat.numeroWhatsappId ?? '';
      if (!cuentas.has(k)) cuentas.set(k, await this.whatsapp.cuentaMetaDelChat(empresaId, chat.numeroWhatsappId));
      return cuentas.get(k) ?? null;
    };
    const elegir = (candidatos: ChatConClic[], fecha: Date) => {
      let mejor: { chat: ChatConClic; clic: Clic } | null = null;
      for (const chat of candidatos) {
        const clic = clicAtribuible(chat.clics, fecha);
        if (clic && (!mejor || clic.creadoEn > mejor.clic.creadoEn)) mejor = { chat, clic };
      }
      return mejor;
    };

    for (const v of ventas) {
      if (anulado(v)) continue;
      const cel = celularDeCliente.get(v.clienteId);
      const candidatos = [
        ...(porComprobante.get(v.id) ?? []),
        ...(porCliente.get(v.clienteId) ?? []),
        ...(cel ? (porCelular.get(cel) ?? []) : []),
      ];
      const elegido = elegir(candidatos, v.creadoEn);
      if (!elegido) continue;
      const cuenta = await cuentaDe(elegido.chat);
      if (!cuenta) continue;
      filas.push({
        empresaId,
        clave: claveDeVenta(v),
        evento: 'Purchase' as EventoMeta,
        conversacionId: elegido.chat.id,
        comprobanteId: v.id,
        wabaId: cuenta.wabaId,
        ctwaClid: elegido.clic.ctwaClid,
        valor: Number(v.mtoImpVenta) || 0,
        moneda: v.tipoMoneda || 'PEN',
        ocurridoEn: v.creadoEn,
      });
    }

    // Lead caliente: el momento en que la IA lo dio por listo para comprar
    // (la misma marca que dispara el aviso al dueño). Le enseña a Meta antes
    // de que haya compras, que en un negocio chico tardan en juntarse.
    for (const chat of chats) {
      const t = chat.notificadoEn;
      if (!t || t < desde || t > ahora) continue;
      const clic = clicAtribuible(chat.clics, t);
      if (!clic) continue;
      const cuenta = await cuentaDe(chat);
      if (!cuenta) continue;
      filas.push({
        empresaId,
        clave: claveDeLead(chat.id),
        evento: 'LeadSubmitted' as EventoMeta,
        conversacionId: chat.id,
        wabaId: cuenta.wabaId,
        ctwaClid: clic.ctwaClid,
        ocurridoEn: t,
      });
    }

    if (!filas.length) return 0;
    // La clave única hace el trabajo: lo ya registrado se salta.
    const r = await this.prisma.metaEventoConversion.createMany({ data: filas, skipDuplicates: true });
    return r.count;
  }

  // ─── Envío ────────────────────────────────────────────────────────────────

  /** `revisar`: ir igual a Meta, para comprobar que el token y el permiso siguen valiendo. */
  private async datasetDe(empresaId: number, wabaId: string, token: string, revisar = false): Promise<string> {
    const config = await this.configDe(empresaId);
    const guardado = config.datasets?.[wabaId];
    if (guardado && !revisar) return guardado;
    const headers = { Authorization: `Bearer ${token}` };
    const leido = await axios.get(`${this.graph}/${wabaId}/dataset`, { headers, timeout: 15000 });
    let id: string | undefined = leido.data?.id ?? leido.data?.data?.[0]?.id;
    if (!id) {
      const creado = await axios.post(`${this.graph}/${wabaId}/dataset`, null, { headers, timeout: 15000 });
      id = creado.data?.id ?? creado.data?.data?.[0]?.id;
    }
    if (!id) throw new Error('Meta no devolvió el dataset de la cuenta de WhatsApp.');
    await this.guardarConfig(empresaId, { datasets: { [wabaId]: id } });
    return id;
  }

  async enviarPendientes(empresaId: number, ahora = new Date()) {
    const pendientes = await this.prisma.metaEventoConversion.findMany({
      where: {
        empresaId,
        estado: { in: ['PENDIENTE', 'ERROR'] },
        intentos: { lt: MAX_INTENTOS },
        // Meta no acepta eventos de más de 7 días: esos ya no se mandan.
        ocurridoEn: { gte: new Date(ahora.getTime() - VENTANA_MS + 3600_000) },
      },
      orderBy: { id: 'asc' },
      take: 500,
    });
    if (!pendientes.length) return { enviados: 0, fallidos: 0 };

    // Una venta anulada entre que se detectó y se manda, ya no se avisa.
    const ids = pendientes.map((p) => p.comprobanteId).filter((x): x is number => x != null);
    const anuladas = new Set(
      (
        await this.prisma.comprobante.findMany({
          where: { id: { in: ids } },
          select: { id: true, estadoPago: true, estadoEnvioSunat: true },
        })
      )
        .filter(anulado)
        .map((c) => c.id),
    );
    const vigentes = pendientes.filter((p) => !(p.comprobanteId && anuladas.has(p.comprobanteId)));
    if (vigentes.length < pendientes.length) {
      await this.prisma.metaEventoConversion.updateMany({
        where: { id: { in: pendientes.filter((p) => !vigentes.includes(p)).map((p) => p.id) } },
        data: { estado: 'OMITIDO', error: 'La venta se anuló antes de avisar a Meta.' },
      });
    }

    let enviados = 0;
    let fallidos = 0;
    let ultimoError: string | null = null;
    const porWaba = new Map<string, typeof vigentes>();
    for (const p of vigentes) porWaba.set(p.wabaId, [...(porWaba.get(p.wabaId) ?? []), p]);

    for (const [wabaId, grupo] of porWaba) {
      const ids = grupo.map((g) => g.id);
      try {
        const chat = await this.prisma.leadConversacion.findFirst({
          where: { id: grupo[0].conversacionId },
          select: { numeroWhatsappId: true },
        });
        const cuenta = await this.whatsapp.cuentaMetaDelChat(empresaId, chat?.numeroWhatsappId);
        if (!cuenta || cuenta.wabaId !== wabaId) throw new Error('Esa cuenta de WhatsApp ya no está conectada.');
        const dataset = await this.datasetDe(empresaId, wabaId, cuenta.token);
        await axios.post(
          `${this.graph}/${dataset}/events`,
          {
            data: grupo.map((g) =>
              armarEvento({
                evento: g.evento as EventoMeta,
                clave: g.clave,
                fecha: g.ocurridoEn,
                wabaId,
                ctwaClid: g.ctwaClid,
                valor: g.valor != null ? Number(g.valor) : undefined,
                moneda: g.moneda ?? undefined,
              }),
            ),
          },
          { headers: { Authorization: `Bearer ${cuenta.token}` }, timeout: 20000 },
        );
        await this.prisma.metaEventoConversion.updateMany({
          where: { id: { in: ids } },
          data: { estado: 'ENVIADO', enviadoEn: new Date(), error: null, intentos: { increment: 1 } },
        });
        enviados += grupo.length;
      } catch (e) {
        ultimoError = errorDeMeta(e);
        await this.prisma.metaEventoConversion.updateMany({
          where: { id: { in: ids } },
          data: { estado: 'ERROR', error: ultimoError, intentos: { increment: 1 } },
        });
        fallidos += grupo.length;
      }
    }
    await this.guardarConfig(empresaId, { ultimoError });
    if (ultimoError) this.logger.warn(`Conversiones empresa ${empresaId}: ${ultimoError}`);
    return { enviados, fallidos };
  }
}
