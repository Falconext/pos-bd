import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { WhatsappConexion } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionesService } from '../../notificaciones/notificaciones.service';
import {
  cifrarSecreto,
  descifrarSecreto,
} from '../../common/utils/secreto.util';
import { numeroTakiy } from '../takiy';
import {
  EVENTOS_WEBHOOK,
  EstadoEvolution,
  EvolutionError,
  HEADER_SECRETO_WEBHOOK,
  QrEvolution,
} from '../evolution';
import { EvolutionEnv, RUTA_WEBHOOK_EVOLUTION } from '../evolution-config';
import { EvolutionEnvioService } from '../evolution-envio.service';
import {
  CambioConexion,
  ConexionActual,
  EstadoConexion,
  correoDesconexion,
  nombreEvento,
  numeroDeJid,
  transicion,
} from './estado-conexion';

export interface EstadoConexionDto {
  disponible: boolean;
  proveedor: 'EVOLUTION';
  estado: EstadoConexion;
  numero: string | null;
  nombrePerfil: string | null;
  conectadoEn: string | null;
  desconectadoEn: string | null;
  enviadosHoy: number;
  topeDiario: number;
  takiyActivo: boolean;
  enviarComprobante: boolean;
}

export interface QrDto {
  estado: EstadoConexion;
  qr: string | null;
  codigoEmparejamiento: string | null;
  expiraEnSeg: number;
}

/** Baileys renueva el QR cada ~20 s: el panel lo vuelve a pedir con ese ritmo. */
export const EXPIRA_QR_SEG = 20;
export const MENSAJE_PRUEBA = '✅ Tu WhatsApp quedó conectado a Krezka.';
export const EVENTO_SOCKET = 'whatsapp-conexion';

const NO_HABILITADO =
  'La conexión de WhatsApp por QR aún no está habilitada para tu empresa.';

type FilaConexion = WhatsappConexion;

/**
 * "Conectar mi WhatsApp" con QR contra nuestro Evolution API: una instancia
 * Baileys por empresa (`krezka-<empresaId>-<aleatorio>`), su token cifrado y
 * un webhook firmado que mantiene el estado. Si la sesión se cae (no por el
 * botón Desconectar) se avisa una vez al dueño por el panel y por correo.
 */
@Injectable()
export class WhatsappConexionService {
  private readonly logger = new Logger(WhatsappConexionService.name);
  ahora: () => Date = () => new Date();
  enviarCorreo: (
    para: string[],
    asunto: string,
    html: string,
  ) => Promise<void> = (p, a, h) => enviarCorreoResend(p, a, h);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EvolutionEnvioService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  // ─── Panel ────────────────────────────────────────────────────────────────

  async estado(empresaId: number): Promise<EstadoConexionDto> {
    const cfg = this.envio.disponible(empresaId);
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { takiyActivo: true, takiyEnviarComprobante: true },
    });
    const base = {
      proveedor: 'EVOLUTION' as const,
      takiyActivo: !!empresa?.takiyActivo,
      enviarComprobante: !!empresa?.takiyEnviarComprobante,
    };
    if (!cfg) {
      return {
        ...base,
        disponible: false,
        estado: 'NO_CONECTADO',
        numero: null,
        nombrePerfil: null,
        conectadoEn: null,
        desconectadoEn: null,
        enviadosHoy: 0,
        topeDiario: 0,
      };
    }
    let fila = await this.fila(empresaId);
    // Si se perdió un webhook, el estado real manda (solo mientras importa).
    if (fila && (fila.estado === 'CONECTANDO' || fila.estado === 'CONECTADO')) {
      fila = await this.sincronizar(cfg, fila);
    }
    return {
      ...base,
      disponible: true,
      estado: fila?.estado ?? 'NO_CONECTADO',
      numero: fila?.numero ?? null,
      nombrePerfil: fila?.nombrePerfil ?? null,
      conectadoEn: fila?.conectadoEn?.toISOString() ?? null,
      desconectadoEn: fila?.desconectadoEn?.toISOString() ?? null,
      enviadosHoy: this.envio.enviadosHoy(fila),
      topeDiario: cfg.topeDiario,
    };
  }

  /** Crea (o reutiliza) la instancia y devuelve el QR para escanear. */
  async conectar(empresaId: number, numeroRaw?: string): Promise<QrDto> {
    const cfg = this.requerir(empresaId);
    const numero = this.numeroEmparejamiento(numeroRaw);
    const cli = this.envio.cliente(cfg);

    let fila = await this.fila(empresaId);
    if (fila?.estado === 'CONECTADO') {
      fila = await this.sincronizar(cfg, fila);
      if (fila?.estado === 'CONECTADO') return this.qrDto('CONECTADO', null);
    }

    // Evolution solo genera el código de emparejamiento al abrir una sesión
    // nueva (create con `number`); con una instancia esperando el QR lo ignora
    // (verificado en 2.3.7). Para pedir código se rehace la instancia.
    if (fila && numero) {
      try {
        await cli.borrarInstancia(fila.instancia);
      } catch (e) {
        if (!(e instanceof EvolutionError && e.codigo === 'NO_ENCONTRADA'))
          throw this.http(e);
      }
      await this.prisma.whatsappConexion.deleteMany({ where: { id: fila.id } });
      this.envio.olvidar(fila.instancia);
      fila = null;
    }

    if (fila) {
      try {
        const q = await cli.conectar(fila.instancia, this.token(cfg, fila));
        return await this.trasQr(fila, q);
      } catch (e) {
        // La instancia ya no existe en Evolution (borrada a mano, base nueva): se rehace.
        if (!(e instanceof EvolutionError && e.codigo === 'NO_ENCONTRADA'))
          throw this.http(e);
        await this.prisma.whatsappConexion.deleteMany({
          where: { id: fila.id },
        });
      }
    }

    const instancia = `krezka-${empresaId}-${randomBytes(6).toString('hex')}`;
    const token = randomBytes(24).toString('hex');
    try {
      fila = await this.prisma.whatsappConexion.create({
        data: {
          empresaId,
          instancia,
          tokenCifrado: cifrarSecreto(token),
          estado: 'CONECTANDO',
        },
      });
    } catch (e) {
      // Dos clics a la vez: la otra petición ya creó la fila.
      if ((e as any)?.code === 'P2002') return this.qr(empresaId);
      throw e;
    }
    try {
      const q = await cli.crearInstancia({
        instancia,
        token,
        numero,
        webhook: {
          url: `${cfg.webhookBase}${RUTA_WEBHOOK_EVOLUTION}`,
          headers: { [HEADER_SECRETO_WEBHOOK]: cfg.webhookSecret },
          events: [...EVENTOS_WEBHOOK],
        },
      });
      return await this.trasQr(fila, q);
    } catch (e) {
      await this.prisma.whatsappConexion.deleteMany({ where: { id: fila.id } });
      throw this.http(e);
    }
  }

  /** Refresca el QR (cada `expiraEnSeg`). */
  async qr(empresaId: number): Promise<QrDto> {
    const cfg = this.requerir(empresaId);
    const fila = await this.fila(empresaId);
    if (!fila) return this.qrDto('NO_CONECTADO', null);
    if (fila.estado === 'CONECTADO') return this.qrDto('CONECTADO', null);
    try {
      const q = await this.envio
        .cliente(cfg)
        .conectar(fila.instancia, this.token(cfg, fila));
      return await this.trasQr(fila, q);
    } catch (e) {
      if (e instanceof EvolutionError && e.codigo === 'NO_ENCONTRADA') {
        await this.prisma.whatsappConexion.deleteMany({
          where: { id: fila.id },
        });
        return this.qrDto('NO_CONECTADO', null);
      }
      throw this.http(e);
    }
  }

  /** Mensaje de prueba desde el número conectado (por defecto, al celular del usuario). */
  async probar(
    empresaId: number,
    usuarioId: number | undefined,
    numeroRaw?: string,
  ) {
    this.requerir(empresaId);
    let numero = String(numeroRaw ?? '').trim();
    if (!numero) {
      const usuario = usuarioId
        ? await this.prisma.usuario.findFirst({
            where: { id: usuarioId, empresaId },
            select: { celular: true },
          })
        : null;
      const admin = usuario?.celular
        ? null
        : await this.prisma.usuario.findFirst({
            where: {
              empresaId,
              rol: 'ADMIN_EMPRESA',
              estado: 'ACTIVO',
              NOT: { celular: '' },
            },
            select: { celular: true },
            orderBy: { id: 'asc' },
          });
      numero = usuario?.celular || admin?.celular || '';
    }
    if (!numero)
      return { ok: false, error: 'Escribe el número al que mandar la prueba.' };
    const r = await this.envio.enviar(empresaId, {
      numero,
      mensaje: MENSAJE_PRUEBA,
    });
    return r.success ? { ok: true } : { ok: false, error: r.error };
  }

  /** Cierra la sesión y borra la instancia. El webhook de cierre que llegue después se ignora. */
  async desconectar(empresaId: number): Promise<EstadoConexionDto> {
    const cfg = this.requerir(empresaId);
    const fila = await this.fila(empresaId);
    if (!fila) return this.estado(empresaId);

    // Primero se marca: el CONNECTION_UPDATE "close" que provoca el logout no avisa.
    await this.prisma.whatsappConexion.update({
      where: { id: fila.id },
      data: { estado: 'NO_CONECTADO', avisoDesconexionEn: this.ahora() },
    });
    const cli = this.envio.cliente(cfg);
    await cli
      .cerrarSesion(fila.instancia, this.token(cfg, fila))
      .catch(() => undefined);
    try {
      await cli.borrarInstancia(fila.instancia);
    } catch (e) {
      if (!(e instanceof EvolutionError && e.codigo === 'NO_ENCONTRADA')) {
        // Sin borrar en Evolution el celular podría seguir vinculado: se deja como estaba.
        await this.prisma.whatsappConexion.update({
          where: { id: fila.id },
          data: {
            estado: fila.estado,
            avisoDesconexionEn: fila.avisoDesconexionEn,
          },
        });
        throw this.http(e);
      }
    }
    await this.prisma.whatsappConexion.deleteMany({ where: { id: fila.id } });
    this.envio.olvidar(fila.instancia);
    return this.estado(empresaId);
  }

  /** "Enviar el comprobante al emitir" (mismo ajuste que en Takiy). */
  async configurar(empresaId: number, dto: { enviarComprobante?: unknown }) {
    if (typeof dto?.enviarComprobante !== 'boolean') {
      throw new BadRequestException(
        'Indica si se envía el comprobante al emitir (enviarComprobante: true o false).',
      );
    }
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { takiyEnviarComprobante: dto.enviarComprobante },
    });
    return this.estado(empresaId);
  }

  // ─── Webhook ──────────────────────────────────────────────────────────────

  async webhook(secretoRecibido: unknown, body: any): Promise<{ ok: true }> {
    const cfg = this.envio.leerEnv();
    if (!cfg || !secretoValido(secretoRecibido, cfg.webhookSecret)) {
      throw new UnauthorizedException('Webhook no autorizado.');
    }
    const evento = nombreEvento(body?.event);
    const instancia = typeof body?.instance === 'string' ? body.instance : null;
    if (
      !instancia ||
      !EVENTOS_WEBHOOK.includes(evento as (typeof EVENTOS_WEBHOOK)[number])
    )
      return { ok: true };

    const fila = await this.prisma.whatsappConexion.findUnique({
      where: { instancia },
    });
    if (!fila) return { ok: true };
    const data = body?.data ?? {};

    if (evento === 'QRCODE_UPDATED') {
      const qr = data?.qrcode?.base64;
      if (typeof qr === 'string' && qr && fila.estado !== 'CONECTADO') {
        await this.emitir(fila.empresaId, {
          estado: fila.estado,
          qr,
          codigoEmparejamiento: data?.qrcode?.pairingCode ?? null,
        });
      }
      return { ok: true };
    }

    const estado = String(data?.state ?? '') as EstadoEvolution;
    if (!['open', 'close', 'connecting', 'refused'].includes(estado))
      return { ok: true };
    await this.aplicar(fila, estado, {
      numero: numeroDeJid(data?.wuid ?? body?.sender),
      nombrePerfil:
        typeof data?.profileName === 'string' ? data.profileName : null,
    });
    return { ok: true };
  }

  // ─── Internos ─────────────────────────────────────────────────────────────

  private fila(empresaId: number) {
    return this.prisma.whatsappConexion.findUnique({ where: { empresaId } });
  }

  private requerir(empresaId: number): EvolutionEnv {
    const cfg = this.envio.disponible(empresaId);
    if (!cfg) throw new BadRequestException(NO_HABILITADO);
    return cfg;
  }

  private token(cfg: EvolutionEnv, fila: FilaConexion): string {
    return descifrarSecreto(fila.tokenCifrado) ?? cfg.apiKey;
  }

  private numeroEmparejamiento(raw?: string): string | undefined {
    if (raw === undefined || raw === null || String(raw).trim() === '')
      return undefined;
    const n = numeroTakiy(String(raw));
    if (!/^\d{10,15}$/.test(n)) {
      throw new BadRequestException(
        'El número no es válido. Escribe tu celular de 9 dígitos (ej. 987654321).',
      );
    }
    return n;
  }

  private async trasQr(fila: FilaConexion, q: QrEvolution): Promise<QrDto> {
    if (q.estado === 'open') {
      const f = await this.aplicar(fila, 'open', {});
      return this.qrDto(f?.estado ?? 'CONECTADO', null);
    }
    let estado = fila.estado;
    if (estado !== 'CONECTANDO') {
      await this.prisma.whatsappConexion.update({
        where: { id: fila.id },
        data: { estado: 'CONECTANDO' },
      });
      estado = 'CONECTANDO';
    }
    return {
      estado,
      qr: q.qr,
      codigoEmparejamiento: q.codigoEmparejamiento,
      expiraEnSeg: EXPIRA_QR_SEG,
    };
  }

  private qrDto(estado: EstadoConexion, qr: string | null): QrDto {
    return {
      estado,
      qr,
      codigoEmparejamiento: null,
      expiraEnSeg: EXPIRA_QR_SEG,
    };
  }

  /** Consulta el estado real en Evolution; si falla la red, se queda con lo guardado. */
  private async sincronizar(
    cfg: EvolutionEnv,
    fila: FilaConexion,
  ): Promise<FilaConexion | null> {
    try {
      const estado = await this.envio
        .cliente(cfg)
        .estado(fila.instancia, this.token(cfg, fila));
      return await this.aplicar(fila, estado, {});
    } catch (e) {
      if (e instanceof EvolutionError && e.codigo === 'NO_ENCONTRADA') {
        return this.aplicar(fila, 'close', {});
      }
      return fila;
    }
  }

  /** Aplica el cambio de estado (condicional al estado leído) y avisa si toca. */
  private async aplicar(
    fila: FilaConexion,
    estado: EstadoEvolution,
    perfil: { numero?: string | null; nombrePerfil?: string | null },
  ): Promise<FilaConexion | null> {
    const actual: ConexionActual = {
      estado: fila.estado,
      conectadoEn: fila.conectadoEn,
      avisoDesconexionEn: fila.avisoDesconexionEn,
    };
    const cambio: CambioConexion | null = transicion(
      actual,
      estado,
      this.ahora(),
      perfil,
    );
    if (!cambio) return fila;
    const r = await this.prisma.whatsappConexion.updateMany({
      where: { id: fila.id, estado: cambio.desde },
      data: cambio.data,
    });
    // Otro webhook ganó la carrera: ese ya aplicó (y avisó si tocaba).
    if (r.count === 0)
      return this.prisma.whatsappConexion.findUnique({
        where: { id: fila.id },
      });
    const nueva: FilaConexion = { ...fila, ...cambio.data } as FilaConexion;
    await this.emitir(fila.empresaId, {
      estado: nueva.estado,
      qr: null,
      codigoEmparejamiento: null,
    });
    if (cambio.avisar) await this.avisarDesconexion(nueva);
    return nueva;
  }

  private async emitir(
    empresaId: number,
    payload: {
      estado: EstadoConexion;
      qr: string | null;
      codigoEmparejamiento: string | null;
    },
  ): Promise<void> {
    try {
      const admins = await this.prisma.usuario.findMany({
        where: { empresaId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
        select: { id: true },
      });
      this.notificaciones.emitirEventoAUsuarios(
        admins.map((a) => a.id),
        EVENTO_SOCKET,
        payload,
      );
    } catch (e: any) {
      this.logger.warn(
        `No se pudo emitir el estado de WhatsApp: ${e?.message ?? e}`,
      );
    }
  }

  private async avisarDesconexion(fila: FilaConexion): Promise<void> {
    const numero = fila.numero ? ` (+${fila.numero})` : '';
    try {
      await this.notificaciones.notificarAdminsEmpresa({
        empresaId: fila.empresaId,
        tipo: 'WARNING',
        titulo: 'Tu WhatsApp se desconectó',
        mensaje: `El WhatsApp${numero} dejó de estar vinculado y los avisos automáticos no salen desde tu número. Vuelve a escanear el QR en Mi perfil → WhatsApp.`,
        metaData: { tipo: 'WHATSAPP_DESCONECTADO' },
      });
    } catch (e: any) {
      this.logger.warn(
        `Aviso de desconexión (panel) empresa ${fila.empresaId}: ${e?.message ?? e}`,
      );
    }
    try {
      const [empresa, admins] = await Promise.all([
        this.prisma.empresa.findUnique({
          where: { id: fila.empresaId },
          select: { nombreComercial: true, razonSocial: true },
        }),
        this.prisma.usuario.findMany({
          where: {
            empresaId: fila.empresaId,
            rol: 'ADMIN_EMPRESA',
            estado: 'ACTIVO',
          },
          select: { email: true },
        }),
      ]);
      const para = admins
        .map((a) => a.email)
        .filter((e): e is string => !!e && e.includes('@'));
      if (!para.length) return;
      const base = (
        process.env.APP_URL ||
        process.env.FRONTEND_URL ||
        'https://app.krezka.com'
      ).replace(/\/+$/, '');
      const { asunto, html } = correoDesconexion({
        negocio:
          empresa?.nombreComercial || empresa?.razonSocial || 'tu negocio',
        numero: fila.numero,
        panelUrl: `${base}/administrador/perfil`,
      });
      await this.enviarCorreo(para, asunto, html);
    } catch (e: any) {
      this.logger.warn(
        `Aviso de desconexión (correo) empresa ${fila.empresaId}: ${e?.message ?? e}`,
      );
    }
  }

  /** Errores de Evolution → HTTP con texto en español (nunca la llave ni la respuesta cruda). */
  private http(e: unknown): Error {
    if (e instanceof EvolutionError) {
      if (e.codigo === 'NO_AUTORIZADO') {
        this.logger.error(
          'Evolution rechazó EVOLUTION_API_KEY o el token de la instancia.',
        );
        return new BadGatewayException(
          'El servidor de WhatsApp no está disponible en este momento. Intenta en unos minutos.',
        );
      }
      if (e.codigo === 'NO_ENCONTRADA')
        return new NotFoundException(
          'La conexión de WhatsApp ya no existe. Vuelve a tocar Conectar.',
        );
      if (e.codigo === 'SOLICITUD_INVALIDA')
        return new BadRequestException(e.message);
      return new BadGatewayException(
        `${e.message} Intenta de nuevo en unos minutos.`,
      );
    }
    return e instanceof Error
      ? e
      : new BadGatewayException(
          'No se pudo completar la conexión de WhatsApp.',
        );
  }
}

/** Comparación en tiempo constante (hash previo para no filtrar el largo). */
export function secretoValido(recibido: unknown, esperado: string): boolean {
  if (typeof recibido !== 'string' || !recibido || !esperado) return false;
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

async function enviarCorreoResend(
  para: string[],
  asunto: string,
  html: string,
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return; // sin clave se omite el correo (igual que los demás avisos)
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    process.env.MAIL_FROM ||
    'notificaciones@falconext.pe';
  const appName = process.env.APP_NAME || 'Krezka';
  const { Resend } = await import('resend');
  const { error } = await new Resend(resendKey).emails.send({
    from: `${appName.replace(/[<>"]/g, '')} <${fromEmail}>`,
    to: para,
    subject: asunto,
    html,
  });
  if (error) throw new Error(String((error as any)?.message ?? error));
}
