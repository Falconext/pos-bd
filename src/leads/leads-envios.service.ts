import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { MensajeriaService } from './mensajeria.service';
import { LeadsSegmentosService } from './leads-segmentos.service';
import { LeadsPlantillasService } from './leads-plantillas.service';
import { LeadsDisparadoresService } from './leads-disparadores.service';
import { enHorarioHabil, proximoHorarioHabil } from './leads-disparadores';
import { esNumeroInterno } from './numeros-internos';
import { estaPausado } from './pausa-bot';
import { TEXTO_EXCLUSION } from './segmentos';
import {
  BotonPlantilla,
  DatosPlantilla,
  ValoresEnvio,
  parametrosDeEnvio,
  textoRenderizado,
  variablesDe,
} from './plantillas-propias';
import {
  EstadoDeMeta,
  EstadoEnvio,
  HORAS_RESPUESTA,
  cambiosPorEstado,
  compraDelEnvio,
  decidirDestinatario,
  esFallaDePlantilla,
  excedeNivel,
  fechaProgramada,
  ritmoValido,
} from './envios-masivos';

/** Lo que se guarda de la plantilla al confirmar: lo necesario para mandar y para el historial. */
interface PlantillaDelEnvio {
  id: number;
  titulo: string;
  nombreMeta: string;
  categoria: string;
  cabeceraTipo: DatosPlantilla['cabeceraTipo'];
  cabeceraTexto: string | null;
  cabeceraImagenUrl: string | null;
  cuerpo: string;
  pie: string | null;
  botones: BotonPlantilla[];
}

export interface CrearEnvioDto {
  nombre?: string;
  segmentoId?: number;
  filtros?: Record<string, unknown>;
  plantillaId?: number;
  valores?: { dato1?: string; dato2?: string };
  programadoPara?: string | null;
  porMinuto?: number;
}

/**
 * Envíos masivos: una plantilla aprobada a un segmento.
 *
 * Al confirmar se congela la lista de destinatarios (una fila de LeadDisparo
 * por contacto, con su motivo si no le llega). Después un cron los manda de a
 * poco —el ritmo lo elige el negocio— y vuelve a decidir cada uno justo antes
 * de mandarle.
 */
@Injectable()
export class LeadsEnviosService {
  private readonly logger = new Logger(LeadsEnviosService.name);
  /** Un solo recorrido a la vez: si Meta tarda, el minuto siguiente no se pisa con este. */
  private corriendo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly segmentos: LeadsSegmentosService,
    private readonly plantillas: LeadsPlantillasService,
    private readonly disparadores: LeadsDisparadoresService,
    private readonly mensajeria: MensajeriaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // ─── Crear ─────────────────────────────────────────────────────────────

  private async plantillaAprobada(
    empresaId: number,
    plantillaId?: number,
  ): Promise<PlantillaDelEnvio> {
    if (!plantillaId) throw new BadRequestException('Elige una plantilla.');
    const p = await this.plantillas.obtener(empresaId, plantillaId);
    if (p.estado !== 'APROBADA') {
      throw new BadRequestException(
        'La plantilla todavía no está aprobada por Meta.',
      );
    }
    const d = this.plantillas.datosDe(p);
    return {
      id: p.id,
      titulo: p.titulo,
      nombreMeta: p.nombreMeta,
      categoria: p.categoria,
      cabeceraTipo: d.cabeceraTipo,
      cabeceraTexto: d.cabeceraTexto ?? null,
      cabeceraImagenUrl: d.cabeceraImagenUrl ?? null,
      cuerpo: d.cuerpo,
      pie: d.pie ?? null,
      botones: d.botones,
    };
  }

  /** Los valores de {{dato1}}/{{dato2}} que pide la plantilla, sin dejar ninguno vacío. */
  private valoresDe(
    plantilla: PlantillaDelEnvio,
    crudos?: { dato1?: string; dato2?: string },
  ) {
    const usadas = variablesDe(plantilla.cuerpo);
    const valores: { dato1?: string; dato2?: string } = {};
    for (const v of ['dato1', 'dato2'] as const) {
      if (!usadas.includes(v)) continue;
      const t = (crudos?.[v] ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (!t)
        throw new BadRequestException(
          `Completa {{${v}}}: es lo que va en el mensaje (ej. el descuento).`,
        );
      valores[v] = t;
    }
    return valores;
  }

  async crear(empresaId: number, usuarioId: number | null, dto: CrearEnvioDto) {
    const ahora = new Date();
    const plantilla = await this.plantillaAprobada(empresaId, dto.plantillaId);
    const valores = this.valoresDe(plantilla, dto.valores);

    const programacion = fechaProgramada(dto.programadoPara, ahora);
    if ('error' in programacion)
      throw new BadRequestException(programacion.error);

    let filtros: unknown = dto.filtros ?? {};
    if (dto.segmentoId)
      filtros = (await this.segmentos.segmentoDe(empresaId, dto.segmentoId))
        .filtrosJson;
    const filtrosLimpios = this.segmentos.normalizar(filtros);

    const r = await this.segmentos.evaluar(empresaId, filtrosLimpios, ahora);
    if (!r.recibiran) {
      throw new BadRequestException(
        'A nadie de este segmento le llegaría el mensaje. Revisa los filtros.',
      );
    }
    const porWhatsapp = r.porCanal.WHATSAPP ?? 0;
    if (porWhatsapp) {
      const nivel = await this.whatsapp.nivelDeMensajeria(empresaId);
      if (excedeNivel(porWhatsapp, nivel)) {
        throw new BadRequestException(
          `Tu número de WhatsApp puede escribirle a ${nivel} clientes por día y este envío tiene ${porWhatsapp}. ` +
            'Divide el segmento en partes o espera a que Meta suba tu nivel.',
        );
      }
    }

    const config = await this.disparadores.configDe(empresaId);
    const programadoPara = proximoHorarioHabil(programacion.fecha, config);
    const nombre =
      (dto.nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) ||
      `${plantilla.titulo} · ${programadoPara.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}`;

    const envio = await this.prisma.$transaction(async (tx) => {
      const e = await tx.leadEnvioMasivo.create({
        data: {
          empresaId,
          nombre,
          segmentoId: dto.segmentoId ?? null,
          filtrosJson: filtrosLimpios as object,
          plantillaId: plantilla.id,
          plantillaJson: plantilla as unknown as object,
          valoresJson: valores,
          programadoPara,
          porMinuto: ritmoValido(dto.porMinuto),
          totalDestinatarios: r.cumplen,
          creadoPorId: usuarioId,
        },
      });
      await tx.leadDisparo.createMany({
        data: r.contactos.map((c) => ({
          empresaId,
          tipo: 'ENVIO_MASIVO' as const,
          telefono: c.telefono,
          referencia: `envio:${e.id}`,
          envioMasivoId: e.id,
          prospectoId: c.prospectoId,
          conversacionId: c.conversacionId,
          programadoPara,
          plantilla: plantilla.nombreMeta,
          // Los que ya se sabe que no reciben quedan registrados con su
          // motivo: "a 12 no les llegó" sin decir por qué no sirve.
          ...(c.exclusion
            ? {
                estado: 'OMITIDO' as const,
                motivo: TEXTO_EXCLUSION[c.exclusion],
              }
            : { estado: 'PROGRAMADO' as const }),
        })),
        skipDuplicates: true,
      });
      return e;
    });

    this.logger.log(
      `Envío masivo ${envio.id} (empresa ${empresaId}): ${r.recibiran} de ${r.cumplen} destinatarios, plantilla ${plantilla.nombreMeta}, desde ${programadoPara.toISOString()}.`,
    );
    return this.detalle(empresaId, envio.id);
  }

  // ─── Mandar ────────────────────────────────────────────────────────────

  /** Cada minuto: los envíos que tocan, de a `porMinuto` mensajes cada uno. */
  @Cron('* * * * *', { name: 'leads-envios-masivos' })
  async ejecutar(): Promise<void> {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      const envios = await this.prisma.leadEnvioMasivo.findMany({
        where: {
          estado: { in: ['PROGRAMADO', 'ENVIANDO'] },
          programadoPara: { lte: new Date() },
        },
        orderBy: { programadoPara: 'asc' },
        take: 20,
      });
      for (const e of envios) {
        await this.procesarEnvio(e.id).catch((err) =>
          this.logger.warn(`Envío masivo ${e.id}: ${err?.message}`),
        );
      }
    } finally {
      this.corriendo = false;
    }
  }

  /** Una tanda de un envío. Público para el QA y para "seguir ahora". */
  async procesarEnvio(
    envioId: number,
  ): Promise<{ enviados: number; omitidos: number; fallidos: number }> {
    const cuenta = { enviados: 0, omitidos: 0, fallidos: 0 };
    const envio = await this.prisma.leadEnvioMasivo.findUnique({
      where: { id: envioId },
    });
    if (!envio || !['PROGRAMADO', 'ENVIANDO'].includes(envio.estado))
      return cuenta;

    const config = await this.disparadores.configDe(envio.empresaId);
    const ahora = new Date();
    // Fuera del horario se espera: un envío largo que empezó a las 8 pm sigue
    // al día siguiente a la hora de abrir, no de madrugada.
    if (!enHorarioHabil(ahora, config)) return cuenta;

    const plantilla = envio.plantillaJson as unknown as PlantillaDelEnvio;
    // Meta puede pausar o desactivar una plantilla por calidad a mitad de un
    // envío: seguir mandando falla con cada mensaje y castiga al número.
    if (plantilla.id) {
      const actual = await this.prisma.leadPlantilla.findFirst({
        where: { id: plantilla.id, empresaId: envio.empresaId },
        select: { estado: true },
      });
      if (actual && actual.estado !== 'APROBADA') {
        await this.cerrar(
          envio.id,
          'TERMINADO',
          `La plantilla quedó ${actual.estado.toLowerCase()} en Meta; se detuvo el envío.`,
        );
        return cuenta;
      }
    }

    if (envio.estado === 'PROGRAMADO') {
      await this.prisma.leadEnvioMasivo.update({
        where: { id: envio.id },
        data: { estado: 'ENVIANDO', iniciadoEn: ahora },
      });
    }

    const tanda = await this.prisma.leadDisparo.findMany({
      where: { envioMasivoId: envio.id, estado: 'PROGRAMADO' },
      orderBy: { id: 'asc' },
      take: envio.porMinuto,
    });
    const internos = await this.segmentos.internosDe(envio.empresaId);
    const valores = (envio.valoresJson ?? {}) as ValoresEnvio;

    for (const d of tanda) {
      try {
        const r = await this.mandarA(
          envio.empresaId,
          d,
          plantilla,
          valores,
          internos,
          config.topeMarketing,
          ahora,
        );
        cuenta[r]++;
        if (r === 'fallidos') {
          // Si lo que falla es la plantilla (Meta la pausó, la borró o no la
          // reconoce), va a fallar con todos: se detiene acá en vez de
          // quemar el resto de la lista y la calidad del número.
          const motivo = await this.motivoDeFalla(d.id);
          if (esFallaDePlantilla(motivo)) {
            await this.cerrar(
              envio.id,
              'TERMINADO',
              `Se detuvo: Meta no aceptó la plantilla (${motivo}).`,
            );
            return cuenta;
          }
        }
      } catch (e: any) {
        cuenta.fallidos++;
        await this.prisma.leadDisparo.update({
          where: { id: d.id },
          data: {
            estado: 'FALLIDO',
            motivo: String(e?.message ?? e).slice(0, 300),
            intentos: { increment: 1 },
          },
        });
      }
    }

    const quedan = await this.prisma.leadDisparo.count({
      where: { envioMasivoId: envio.id, estado: 'PROGRAMADO' },
    });
    if (!quedan) await this.cerrar(envio.id, 'TERMINADO');
    return cuenta;
  }

  private async mandarA(
    empresaId: number,
    d: { id: number; telefono: string; conversacionId: number | null },
    plantilla: PlantillaDelEnvio,
    valores: ValoresEnvio,
    internos: string[],
    tope: number,
    ahora: Date,
  ): Promise<'enviados' | 'omitidos' | 'fallidos'> {
    const [conv, deBaja, recientes] = await Promise.all([
      this.prisma.leadConversacion.findUnique({
        where: {
          empresaId_telefonoProspecto: {
            empresaId,
            telefonoProspecto: d.telefono,
          },
        },
        select: {
          id: true,
          canal: true,
          nombreProspecto: true,
          botActivo: true,
          pausadoHasta: true,
          mensajes: {
            where: { rol: 'USUARIO' },
            orderBy: { creadoEn: 'desc' },
            take: 1,
            select: { creadoEn: true },
          },
        },
      }),
      this.disparadores.estaDeBaja(empresaId, d.telefono),
      this.segmentos.marketingRecientesPorTelefono(
        empresaId,
        [d.telefono],
        ahora,
      ),
    ]);

    const decision = decidirDestinatario({
      canal: conv?.canal ?? 'WHATSAPP',
      interno: esNumeroInterno(d.telefono, internos),
      deBaja,
      marketingRecientes: recientes.get(d.telefono) ?? 0,
      tope,
      botPausado: estaPausado(conv, ahora),
      ultimoMensajeDelCliente: conv?.mensajes[0]?.creadoEn ?? null,
      ahora,
    });
    if (!decision.enviar) {
      await this.prisma.leadDisparo.update({
        where: { id: d.id },
        data: { estado: 'OMITIDO', motivo: decision.motivo },
      });
      return 'omitidos';
    }

    const datosCliente = { ...valores, nombre: conv?.nombreProspecto ?? null };
    const texto = textoRenderizado(plantilla, datosCliente, {
      conBotones: decision.via === 'texto',
    });
    let resultado: { success: boolean; mensajeId?: string; error?: string };
    if (decision.via === 'plantilla') {
      resultado = await this.mensajeria.enviarPlantilla(
        d.telefono,
        plantilla.nombreMeta,
        'es',
        parametrosDeEnvio(plantilla.cuerpo, datosCliente),
        empresaId,
        plantilla.cabeceraTipo === 'IMAGEN' && plantilla.cabeceraImagenUrl
          ? { imagenCabecera: plantilla.cabeceraImagenUrl }
          : {},
      );
    } else {
      // Instagram/Messenger: la imagen va primero y después el texto.
      if (plantilla.cabeceraTipo === 'IMAGEN' && plantilla.cabeceraImagenUrl) {
        await this.mensajeria.enviarImagenUrl(
          d.telefono,
          plantilla.cabeceraImagenUrl,
          undefined,
          empresaId,
        );
      }
      resultado = await this.mensajeria.enviarTexto(
        d.telefono,
        texto,
        empresaId,
      );
    }

    if (!resultado.success) {
      await this.prisma.leadDisparo.update({
        where: { id: d.id },
        data: {
          estado: 'FALLIDO',
          motivo: String(resultado.error ?? 'error al enviar').slice(0, 300),
          intentos: { increment: 1 },
        },
      });
      return 'fallidos';
    }

    await this.prisma.leadDisparo.update({
      where: { id: d.id },
      data: {
        estado: 'ENVIADO',
        enviadoEn: new Date(),
        textoEnviado: texto,
        wamid: resultado.mensajeId ?? null,
        parametrosJson: datosCliente as object,
        motivo: null,
        intentos: { increment: 1 },
      },
    });
    // Al chat: el panel muestra lo que le llegó y la IA, cuando el cliente
    // conteste "me interesa", sabe de qué promoción le habla.
    if (conv?.id) {
      await this.prisma.leadMensaje
        .create({
          data: { conversacionId: conv.id, rol: 'ASISTENTE', contenido: texto },
        })
        .catch(() => undefined);
    }
    return 'enviados';
  }

  private async motivoDeFalla(disparoId: number): Promise<string> {
    const d = await this.prisma.leadDisparo.findUnique({
      where: { id: disparoId },
      select: { motivo: true },
    });
    return d?.motivo ?? '';
  }

  private async cerrar(envioId: number, estado: EstadoEnvio, nota?: string) {
    if (nota) {
      await this.prisma.leadDisparo.updateMany({
        where: { envioMasivoId: envioId, estado: 'PROGRAMADO' },
        data: { estado: 'CANCELADO', motivo: nota },
      });
    }
    await this.prisma.leadEnvioMasivo.update({
      where: { id: envioId },
      data: { estado, terminadoEn: new Date(), ...(nota ? { nota } : {}) },
    });
  }

  /** Freno: lo que no salió, ya no sale. Lo enviado, enviado está. */
  async cancelar(empresaId: number, id: number) {
    const e = await this.envioDe(empresaId, id);
    if (!['PROGRAMADO', 'ENVIANDO'].includes(e.estado)) {
      throw new BadRequestException(
        e.estado === 'CANCELADO'
          ? 'Este envío ya estaba detenido.'
          : 'Este envío ya terminó.',
      );
    }
    await this.cerrar(id, 'CANCELADO', 'Envío detenido por el negocio.');
    return this.detalle(empresaId, id);
  }

  /**
   * Prueba: la plantilla con estos valores a los números del propio negocio
   * (los administradores y los números internos de Mi vendedor). Antes de
   * mandarle a 500 clientes, verla en el propio celular.
   */
  async probar(
    empresaId: number,
    dto: { plantillaId?: number; valores?: { dato1?: string; dato2?: string } },
  ) {
    const plantilla = await this.plantillaAprobada(empresaId, dto.plantillaId);
    const valores = this.valoresDe(plantilla, dto.valores);
    const internos = (await this.segmentos.internosDe(empresaId))
      .filter((t) => /^\d{9,15}$/.test(t))
      .slice(0, 3);
    if (!internos.length) {
      throw new BadRequestException(
        'No hay a quién mandar la prueba: agrega tu celular en tu usuario o en Mi vendedor → números internos.',
      );
    }
    const resultados: { telefono: string; ok: boolean; error?: string }[] = [];
    for (const tel of internos) {
      const destino = tel.length === 9 ? `51${tel}` : tel;
      const r = await this.mensajeria.enviarPlantilla(
        destino,
        plantilla.nombreMeta,
        'es',
        parametrosDeEnvio(plantilla.cuerpo, { ...valores, nombre: 'Prueba' }),
        empresaId,
        plantilla.cabeceraTipo === 'IMAGEN' && plantilla.cabeceraImagenUrl
          ? { imagenCabecera: plantilla.cabeceraImagenUrl }
          : {},
      );
      resultados.push({
        telefono: destino,
        ok: r.success,
        ...(r.error ? { error: r.error } : {}),
      });
    }
    return { resultados };
  }

  // ─── Estados de WhatsApp (webhook) ─────────────────────────────────────

  /**
   * Entregado / leído / falló, por el id del mensaje. Llegan por cada mensaje
   * que manda el negocio (también las respuestas de la IA): los que no son de
   * un envío masivo no coinciden con ningún destinatario y no pasa nada.
   */
  async registrarEstados(estados: EstadoDeMeta[]) {
    let aplicados = 0;
    for (const e of estados ?? []) {
      if (!e?.id) continue;
      const cambio = cambiosPorEstado(e);
      if (!cambio) continue;
      if (cambio.fallo) {
        const r = await this.prisma.leadDisparo.updateMany({
          where: { wamid: e.id },
          data: { estado: 'FALLIDO', motivo: cambio.fallo },
        });
        aplicados += r.count;
        continue;
      }
      // Solo se completa lo que falta: un "delivered" que llega después del
      // "read" no tiene que pisar nada.
      if (cambio.entregadoEn) {
        const r = await this.prisma.leadDisparo.updateMany({
          where: { wamid: e.id, entregadoEn: null },
          data: { entregadoEn: cambio.entregadoEn },
        });
        aplicados += r.count;
      }
      if (cambio.leidoEn) {
        const r = await this.prisma.leadDisparo.updateMany({
          where: { wamid: e.id, leidoEn: null },
          data: { leidoEn: cambio.leidoEn },
        });
        aplicados += r.count;
      }
    }
    return { aplicados };
  }

  // ─── Resultados ────────────────────────────────────────────────────────

  /**
   * Los que respondieron: escribieron dentro de las 72 h siguientes a su
   * mensaje. Por envío, en una sola consulta.
   */
  private async respondieron(
    envioIds: number[],
  ): Promise<Map<number, Set<number>>> {
    const out = new Map<number, Set<number>>();
    if (!envioIds.length) return out;
    const filas = await this.prisma.$queryRaw<
      { envioId: number; disparoId: number }[]
    >`
      SELECT DISTINCT d."envioMasivoId" AS "envioId", d.id AS "disparoId"
        FROM "LeadDisparo" d
        JOIN "LeadMensaje" m
          ON m."conversacionId" = d."conversacionId"
         AND m.rol = 'USUARIO'
         AND m."creadoEn" > d."enviadoEn"
         AND m."creadoEn" <= d."enviadoEn" + (${HORAS_RESPUESTA} * interval '1 hour')
       WHERE d."envioMasivoId" IN (${Prisma.join(envioIds)})
         AND d.estado = 'ENVIADO'`;
    for (const f of filas) {
      const k = Number(f.envioId);
      if (!out.has(k)) out.set(k, new Set());
      out.get(k)!.add(Number(f.disparoId));
    }
    return out;
  }

  /**
   * Los que compraron dentro de los 7 días, por el chat o en caja, y cuánto.
   * Es "compraron después de recibirlo", no "compraron por el mensaje": no hay
   * forma honesta de saber lo segundo, y el panel lo dice así.
   */
  private async compraron(
    empresaId: number,
    enviados: {
      id: number;
      conversacionId: number | null;
      telefono: string;
      enviadoEn: Date | null;
    }[],
  ): Promise<{ porDisparo: Map<number, number>; monto: number }> {
    const conConv = enviados.filter((d) => d.conversacionId && d.enviadoEn);
    const porDisparo = new Map<number, number>();
    if (!conConv.length) return { porDisparo, monto: 0 };
    const compras = await this.segmentos.comprasDe(
      empresaId,
      conConv.map((d) => ({
        id: d.conversacionId as number,
        telefonoProspecto: d.telefono,
      })),
    );
    let monto = 0;
    for (const d of conConv) {
      const delEnvio = (compras.get(d.conversacionId as number) ?? []).filter(
        (c) => compraDelEnvio(c.fecha, d.enviadoEn as Date),
      );
      if (!delEnvio.length) continue;
      const total = delEnvio.reduce((a, c) => a + (c.monto ?? 0), 0);
      porDisparo.set(d.id, Math.round(total * 100) / 100);
      monto += total;
    }
    return { porDisparo, monto: Math.round(monto * 100) / 100 };
  }

  private async entregadosYLeidos(envioIds: number[]) {
    const out = new Map<number, { entregados: number; leidos: number }>();
    if (!envioIds.length) return out;
    const [entregados, leidos] = await Promise.all([
      this.prisma.leadDisparo.groupBy({
        by: ['envioMasivoId'],
        where: {
          envioMasivoId: { in: envioIds },
          estado: 'ENVIADO',
          entregadoEn: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.leadDisparo.groupBy({
        by: ['envioMasivoId'],
        where: {
          envioMasivoId: { in: envioIds },
          estado: 'ENVIADO',
          leidoEn: { not: null },
        },
        _count: { _all: true },
      }),
    ]);
    for (const id of envioIds) out.set(id, { entregados: 0, leidos: 0 });
    for (const g of entregados)
      out.get(g.envioMasivoId as number)!.entregados = g._count._all;
    for (const g of leidos)
      out.get(g.envioMasivoId as number)!.leidos = g._count._all;
    return out;
  }

  // ─── Consultar ─────────────────────────────────────────────────────────

  private async envioDe(empresaId: number, id: number) {
    const e = await this.prisma.leadEnvioMasivo.findFirst({
      where: { id, empresaId },
    });
    if (!e) throw new NotFoundException('Envío no encontrado');
    return e;
  }

  private async conteos(envioIds: number[]) {
    if (!envioIds.length) return new Map<number, Record<string, number>>();
    const grupos = await this.prisma.leadDisparo.groupBy({
      by: ['envioMasivoId', 'estado'],
      where: { envioMasivoId: { in: envioIds } },
      _count: { _all: true },
    });
    const out = new Map<number, Record<string, number>>();
    for (const g of grupos) {
      const k = g.envioMasivoId as number;
      out.set(k, { ...(out.get(k) ?? {}), [String(g.estado)]: g._count._all });
    }
    return out;
  }

  async listar(empresaId: number) {
    const envios = await this.prisma.leadEnvioMasivo.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });
    const ids = envios.map((e) => e.id);
    const [conteos, lecturas, respuestas] = await Promise.all([
      this.conteos(ids),
      this.entregadosYLeidos(ids),
      this.respondieron(ids),
    ]);
    return envios.map((e) => ({
      ...this.resumen(e, conteos.get(e.id) ?? {}),
      resultados: {
        ...(lecturas.get(e.id) ?? { entregados: 0, leidos: 0 }),
        respondieron: respuestas.get(e.id)?.size ?? 0,
      },
    }));
  }

  private resumen(
    e: Awaited<ReturnType<LeadsEnviosService['envioDe']>>,
    c: Record<string, number>,
  ) {
    const p = e.plantillaJson as unknown as PlantillaDelEnvio;
    return {
      id: e.id,
      nombre: e.nombre,
      estado: e.estado,
      programadoPara: e.programadoPara,
      iniciadoEn: e.iniciadoEn,
      terminadoEn: e.terminadoEn,
      porMinuto: e.porMinuto,
      nota: e.nota,
      plantilla: { id: p.id, titulo: p.titulo },
      conteos: {
        total: Object.values(c).reduce((a, n) => a + n, 0),
        pendientes: c.PROGRAMADO ?? 0,
        enviados: c.ENVIADO ?? 0,
        omitidos: c.OMITIDO ?? 0,
        fallidos: c.FALLIDO ?? 0,
        cancelados: c.CANCELADO ?? 0,
      },
      creadoEn: e.creadoEn,
    };
  }

  async detalle(empresaId: number, id: number, filtroEstado?: string) {
    const e = await this.envioDe(empresaId, id);
    const [conteos, filas] = await Promise.all([
      this.conteos([id]),
      this.prisma.leadDisparo.findMany({
        where: {
          envioMasivoId: id,
          ...(filtroEstado ? { estado: filtroEstado as never } : {}),
        },
        orderBy: [{ enviadoEn: 'desc' }, { id: 'asc' }],
        take: 300,
        select: {
          id: true,
          telefono: true,
          conversacionId: true,
          estado: true,
          motivo: true,
          enviadoEn: true,
          entregadoEn: true,
          leidoEn: true,
          textoEnviado: true,
        },
      }),
    ]);
    // Las compras y respuestas se miden sobre TODOS los enviados, no sobre la
    // página filtrada que se está mirando.
    const enviados = await this.prisma.leadDisparo.findMany({
      where: { envioMasivoId: id, estado: 'ENVIADO' },
      select: {
        id: true,
        conversacionId: true,
        telefono: true,
        enviadoEn: true,
      },
    });
    const [lecturas, respuestas, compras] = await Promise.all([
      this.entregadosYLeidos([id]),
      this.respondieron([id]),
      this.compraron(empresaId, enviados),
    ]);
    const respondio = respuestas.get(id) ?? new Set<number>();
    const convs = await this.prisma.leadConversacion.findMany({
      where: {
        id: {
          in: filas
            .map((f) => f.conversacionId)
            .filter((x): x is number => x != null),
        },
      },
      select: { id: true, nombreProspecto: true, canal: true },
    });
    const porId = new Map(convs.map((c) => [c.id, c]));
    return {
      ...this.resumen(e, conteos.get(id) ?? {}),
      plantillaJson: e.plantillaJson,
      valores: e.valoresJson,
      filtros: e.filtrosJson,
      resultados: {
        ...(lecturas.get(id) ?? { entregados: 0, leidos: 0 }),
        respondieron: respondio.size,
        compraron: compras.porDisparo.size,
        ventas: compras.monto,
      },
      destinatarios: filas.map((f) => ({
        ...f,
        respondio: respondio.has(f.id),
        compra: compras.porDisparo.get(f.id) ?? null,
        nombre: f.conversacionId
          ? (porId.get(f.conversacionId)?.nombreProspecto ?? null)
          : null,
        canal: f.conversacionId
          ? (porId.get(f.conversacionId)?.canal ?? 'WHATSAPP')
          : 'WHATSAPP',
      })),
    };
  }

  /** Para el asistente: el nivel de Meta del número, si se sabe. */
  async nivel(empresaId: number) {
    return { nivel: await this.whatsapp.nivelDeMensajeria(empresaId) };
  }
}
