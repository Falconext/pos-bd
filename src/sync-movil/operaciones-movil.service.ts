import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { ComprobanteService } from '../comprobante/comprobante.service';
import { CajaService } from '../caja/caja.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { CrearComprobanteDto } from '../comprobante/dto/crear-comprobante.dto';
import {
  AperturaCajaDto,
  CierreCajaDto,
  RegistrarEgresoDto,
} from '../caja/dto/caja.dto';
import {
  DescartarOperacionDto,
  OperacionSyncDto,
  ResultadoOperacionSync,
  SyncOperacionesDto,
} from './dto/sync-movil.dto';

/** Tolerancia para el reloj del teléfono: fuera de ±15 días se usa la hora del servidor. */
const MAX_DESFASE_MS = 15 * 24 * 60 * 60 * 1000;

interface UsuarioToken {
  id: number;
  empresaId: number;
  rol: string;
  sedeId?: number | null;
  puedeAnularComprobantes?: boolean;
}

/**
 * Procesa el lote de operaciones hechas sin conexión por la app móvil
 * (plan offline-first, Fase 1). Reglas:
 *
 * 1. Idempotencia por `uuid`: si ya se procesó OK se devuelve el resultado
 *    guardado sin volver a aplicarla (`duplicado: true`). Si el mismo uuid
 *    llega con otro payload → error PAYLOAD_DISTINTO.
 * 2. Cada operación pasa por el MISMO servicio que la operación online
 *    (`crearInformal`, `abrirCaja`, …) con `realizadoEn` = hora real del
 *    dispositivo, así comprobante, pagos, kardex y caja quedan en el turno y
 *    día correctos.
 * 3. Orden y dependencias: se procesan en el orden recibido; una operación con
 *    `dependeDe` cuya dependencia no esté OK responde ERROR bloqueante sin
 *    ejecutarse (y sin persistirse, para reintentarla después).
 * 4. Un error en una operación no detiene el lote: queda registrado con su
 *    motivo; si el error es de validación la app lo muestra para revisión.
 */
@Injectable()
export class OperacionesMovilService {
  private readonly logger = new Logger(OperacionesMovilService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comprobantes: ComprobanteService,
    private readonly caja: CajaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  async procesar(user: UsuarioToken, dto: SyncOperacionesDto) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { offlineHabilitado: true },
    });
    if (!empresa?.offlineHabilitado) {
      throw new ForbiddenException(
        'El modo sin conexión no está habilitado para esta empresa.',
      );
    }

    await this.registrarDispositivo(user, dto);

    const resultados: ResultadoOperacionSync[] = [];
    for (const op of dto.operaciones) {
      const r = await this.procesarUna(user, dto.dispositivoId, op);
      resultados.push(r);
    }
    return { resultados, procesadoEn: new Date().toISOString() };
  }

  private async procesarUna(
    user: UsuarioToken,
    dispositivoId: string,
    op: OperacionSyncDto,
  ): Promise<ResultadoOperacionSync> {
    const hash = this.hashPayload(op.payload);

    // 1) Idempotencia: ¿ya la procesamos?
    const previa = await this.prisma.operacionSync.findUnique({
      where: { uuid: op.uuid },
    });
    if (previa) {
      if (previa.empresaId !== user.empresaId) {
        return this.error(op, 'UUID_AJENO', 'La operación pertenece a otra empresa.');
      }
      if (previa.payloadHash !== hash) {
        return this.error(
          op,
          'PAYLOAD_DISTINTO',
          'Esta operación ya fue recibida con otro contenido. No se aplicó.',
        );
      }
      if (previa.estado === 'OK' || previa.estado === 'DESCARTADA') {
        return {
          uuid: op.uuid,
          estado: previa.estado === 'OK' ? 'OK' : 'ERROR',
          duplicado: true,
          codigo: previa.estado === 'DESCARTADA' ? 'DESCARTADA' : undefined,
          mensaje: previa.estado === 'DESCARTADA' ? 'Operación descartada.' : undefined,
          resultado: (previa.resultado as any) ?? undefined,
        };
      }
      // estado ERROR → se reintenta más abajo y se actualiza la fila.
    }

    // 2) Dependencia
    if (op.dependeDe) {
      const dep = await this.prisma.operacionSync.findUnique({
        where: { uuid: op.dependeDe },
        select: { estado: true },
      });
      if (!dep || dep.estado !== 'OK') {
        return {
          uuid: op.uuid,
          estado: 'ERROR',
          bloqueante: true,
          codigo: 'DEPENDENCIA_FALLIDA',
          mensaje: dep
            ? 'Hay una operación anterior de este turno que no se pudo sincronizar.'
            : 'Falta sincronizar una operación anterior de este turno.',
        };
      }
    }

    // 3) Sede y fecha
    const sedeId = await this.resolverSede(user, op.sedeId);
    const { realizadoEn, avisoReloj } = this.resolverFecha(op.realizadoEn);

    // 4) Segunda red de idempotencia: si el servidor cayó entre aplicar la
    //    operación y grabar OperacionSync, el registro de negocio ya tiene el uuid.
    const yaAplicada = await this.buscarAplicada(op);
    if (yaAplicada) {
      // Si el intento anterior quedó en ERROR pero el registro existe, la
      // operación se aplicó a medias (p. ej. se cayó el servidor entre el
      // comprobante y el kardex). No se vuelve a aplicar (duplicaría la venta);
      // se avisa al administrador para que revise stock/caja.
      if (previa?.estado === 'ERROR') {
        yaAplicada.avisos = [
          `Se registró en un intento anterior que terminó con error (${previa.error ?? 'sin detalle'}); revisa stock y caja.`,
        ];
        void this.avisarAdmins(user.empresaId, op, yaAplicada);
      }
      await this.guardar(user, dispositivoId, op, sedeId, realizadoEn, hash, 'OK', yaAplicada);
      return { uuid: op.uuid, estado: 'OK', duplicado: true, resultado: yaAplicada };
    }

    // 5) Ejecutar con el servicio real
    try {
      const resultado = await this.ejecutar(user, op, sedeId, realizadoEn);
      if (avisoReloj) resultado.avisos = [...(resultado.avisos ?? []), avisoReloj];
      await this.guardar(user, dispositivoId, op, sedeId, realizadoEn, hash, 'OK', resultado);
      if (resultado.avisos?.length) {
        void this.avisarAdmins(user.empresaId, op, resultado);
      }
      return { uuid: op.uuid, estado: 'OK', resultado };
    } catch (e: any) {
      const codigo =
        e instanceof BadRequestException
          ? 'VALIDACION'
          : e instanceof HttpException
            ? 'RECHAZADA'
            : 'INTERNO';
      // Un error interno (p. ej. FK de Prisma) no debe llegar al cajero con el
      // stack: se guarda el detalle en el log y se devuelve un texto útil.
      const mensaje =
        codigo === 'INTERNO'
          ? this.mensajeInterno(e)
          : String(e?.message ?? 'Error al aplicar la operación');
      this.logger.warn(`[sync-movil] ${op.tipo} ${op.uuid} → ${codigo}: ${mensaje}`);
      await this.guardar(user, dispositivoId, op, sedeId, realizadoEn, hash, 'ERROR', null, mensaje);
      return { uuid: op.uuid, estado: 'ERROR', codigo, mensaje };
    }
  }

  private async ejecutar(
    user: UsuarioToken,
    op: OperacionSyncDto,
    sedeId: number | undefined,
    realizadoEn: Date,
  ): Promise<NonNullable<ResultadoOperacionSync['resultado']>> {
    const opts = { realizadoEn, origenSyncUuid: op.uuid };
    switch (op.tipo) {
      case 'VENTA_INFORMAL': {
        const payload = await this.validarPayload(CrearComprobanteDto, op.payload);
        const tipoDoc = String(payload.tipoDoc || '').toUpperCase();
        if (['01', '03', '07', '08'].includes(tipoDoc)) {
          throw new BadRequestException(
            'Los comprobantes electrónicos no se sincronizan en esta versión (Fase 2).',
          );
        }
        const comp: any = await this.comprobantes.crearInformal(
          payload,
          user.empresaId,
          user.id,
          sedeId,
          { offline: true, ...opts },
        );
        return {
          comprobanteId: comp.id,
          serie: comp.serie,
          correlativo: comp.correlativo,
          tipoDoc: comp.tipoDoc,
          estadoSunat: comp.estadoEnvioSunat,
          avisos: comp.avisosOffline ?? [],
        };
      }
      case 'CAJA_APERTURA': {
        const payload = await this.validarPayload(AperturaCajaDto, op.payload);
        // Si el mismo usuario ya abrió caja ese día desde la web u otro
        // dispositivo, la apertura offline se absorbe en ese turno: no se
        // duplica y no bloquea las operaciones que dependen de ella.
        const existente = await this.caja.verificarCajaAbierta(
          user.id,
          user.empresaId,
          sedeId,
          realizadoEn,
        );
        if (existente) {
          return {
            movimientoCajaId: existente.id,
            avisos: [
              `Ya tenías un turno abierto ese día (S/ ${Number(existente.montoInicial ?? 0).toFixed(2)} inicial); las operaciones sin conexión entraron en ese turno y no se registró la apertura de S/ ${Number(payload.montoInicial ?? 0).toFixed(2)}.`,
            ],
          };
        }
        const r: any = await this.caja.abrirCaja(user.id, user.empresaId, payload, sedeId, opts);
        return { movimientoCajaId: r?.data?.id ?? r?.id };
      }
      case 'CAJA_EGRESO': {
        const payload = await this.validarPayload(RegistrarEgresoDto, op.payload);
        const r: any = await this.caja.registrarEgreso(
          user.id,
          user.empresaId,
          payload,
          sedeId,
          user.rol,
          opts,
        );
        return { movimientoCajaId: r?.data?.id ?? r?.id };
      }
      case 'CAJA_CIERRE': {
        const payload = await this.validarPayload(CierreCajaDto, op.payload);
        const r: any = await this.caja.cerrarCaja(user.id, user.empresaId, payload, sedeId, opts);
        const cierre = r?.data ?? r;
        const avisos: string[] = [];
        if (cierre?.diferencia != null && Number(cierre.diferencia) !== 0) {
          avisos.push(
            `El arqueo se recalculó al sincronizar: esperado S/ ${Number(cierre.montoEsperado ?? 0).toFixed(2)}, declarado S/ ${Number(cierre.montoFinal ?? 0).toFixed(2)}.`,
          );
        }
        return { movimientoCajaId: cierre?.id, avisos };
      }
      default:
        throw new BadRequestException(`Tipo de operación no soportado: ${op.tipo}`);
    }
  }

  /** Aplica el mismo DTO/validación que el endpoint online equivalente. */
  private async validarPayload<T extends object>(cls: new () => T, payload: unknown): Promise<T> {
    const inst = plainToInstance(cls, payload ?? {});
    const errores = await validate(inst as object, { whitelist: true });
    if (errores.length) {
      const msgs = errores
        .flatMap((e) => Object.values(e.constraints ?? {}))
        .slice(0, 5)
        .join(', ');
      throw new BadRequestException(msgs || 'Datos inválidos');
    }
    return inst;
  }

  private async buscarAplicada(
    op: OperacionSyncDto,
  ): Promise<NonNullable<ResultadoOperacionSync['resultado']> | null> {
    if (op.tipo === 'VENTA_INFORMAL') {
      const c = await this.prisma.comprobante.findFirst({
        where: { origenSyncUuid: op.uuid },
        select: { id: true, serie: true, correlativo: true, tipoDoc: true, estadoEnvioSunat: true },
      });
      return c
        ? { comprobanteId: c.id, serie: c.serie, correlativo: c.correlativo, tipoDoc: c.tipoDoc, estadoSunat: c.estadoEnvioSunat }
        : null;
    }
    const m = await this.prisma.movimientoCaja.findFirst({
      where: { origenSyncUuid: op.uuid },
      select: { id: true },
    });
    return m ? { movimientoCajaId: m.id } : null;
  }

  private async resolverSede(user: UsuarioToken, sedeId?: number): Promise<number | undefined> {
    const objetivo = sedeId ?? user.sedeId ?? undefined;
    if (!objetivo) return undefined;
    const sede = await this.prisma.sede.findFirst({
      where: { id: objetivo, empresaId: user.empresaId },
      select: { id: true },
    });
    if (!sede) throw new BadRequestException('La sede indicada no pertenece a la empresa.');
    if (objetivo !== user.sedeId && user.rol !== 'ADMIN_EMPRESA') {
      const acceso = await this.prisma.usuarioSede.findFirst({
        where: { usuarioId: user.id, sedeId: objetivo },
        select: { id: true },
      });
      if (!acceso) throw new ForbiddenException('No tienes acceso a esa sede.');
    }
    return objetivo;
  }

  private resolverFecha(iso: string): { realizadoEn: Date; avisoReloj?: string } {
    const ahora = new Date();
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || Math.abs(ahora.getTime() - d.getTime()) > MAX_DESFASE_MS) {
      return {
        realizadoEn: ahora,
        avisoReloj: `La hora del teléfono (${iso}) estaba fuera de rango; se usó la hora del servidor.`,
      };
    }
    return { realizadoEn: d };
  }

  /** Texto corto para errores no controlados (Prisma/FK/etc.). */
  private mensajeInterno(e: any): string {
    const raw = String(e?.message ?? '');
    this.logger.error(`[sync-movil] error interno: ${raw.slice(0, 500)}`);
    if (/Foreign key constraint/i.test(raw)) {
      const m = raw.match(/constraint: `([^`]+)`/);
      const campo = m?.[1]?.replace(/^Comprobante_|_fkey$/g, '') ?? 'referencia';
      return `Un dato de la venta ya no existe en el servidor (${campo}). Revísala o descártala.`;
    }
    if (/Unique constraint/i.test(raw)) return 'Conflicto de numeración en el servidor; vuelve a intentar.';
    return 'Error interno del servidor al aplicar la operación. Vuelve a intentar más tarde.';
  }

  private hashPayload(payload: unknown): string {
    // Orden estable de claves para que el mismo contenido dé el mismo hash.
    const ordenar = (v: any): any =>
      Array.isArray(v)
        ? v.map(ordenar)
        : v && typeof v === 'object'
          ? Object.keys(v)
              .sort()
              .reduce((acc: any, k) => ((acc[k] = ordenar(v[k])), acc), {})
          : v;
    return createHash('sha256').update(JSON.stringify(ordenar(payload ?? {}))).digest('hex');
  }

  private async guardar(
    user: UsuarioToken,
    dispositivoId: string,
    op: OperacionSyncDto | DescartarOperacionDto,
    sedeId: number | undefined,
    realizadoEn: Date,
    hash: string,
    estado: 'OK' | 'ERROR' | 'DESCARTADA',
    resultado: any,
    error?: string,
  ) {
    await this.prisma.operacionSync.upsert({
      where: { uuid: op.uuid },
      create: {
        uuid: op.uuid,
        empresaId: user.empresaId,
        usuarioId: user.id,
        sedeId: sedeId ?? null,
        dispositivoId,
        tipo: op.tipo,
        realizadoEn,
        estado,
        resultado: resultado ?? undefined,
        error: error ?? null,
        payloadHash: hash,
      },
      update: {
        estado,
        resultado: resultado ?? undefined,
        error: error ?? null,
        recibidoEn: new Date(),
      },
    });
  }

  private error(op: OperacionSyncDto, codigo: string, mensaje: string): ResultadoOperacionSync {
    return { uuid: op.uuid, estado: 'ERROR', codigo, mensaje };
  }

  private async registrarDispositivo(user: UsuarioToken, dto: SyncOperacionesDto) {
    await this.prisma.dispositivoMovil.upsert({
      where: { id: dto.dispositivoId },
      create: {
        id: dto.dispositivoId,
        empresaId: user.empresaId,
        usuarioId: user.id,
        nombre: dto.nombreDispositivo ?? null,
        plataforma: dto.plataforma ?? null,
        appVersion: dto.appVersion ?? null,
        ultimoSyncEn: new Date(),
        pendientesReportados: dto.pendientesRestantes ?? 0,
      },
      update: {
        usuarioId: user.id,
        ...(dto.nombreDispositivo ? { nombre: dto.nombreDispositivo } : {}),
        ...(dto.plataforma ? { plataforma: dto.plataforma } : {}),
        ...(dto.appVersion ? { appVersion: dto.appVersion } : {}),
        ultimoSyncEn: new Date(),
        pendientesReportados: dto.pendientesRestantes ?? 0,
      },
    });
  }

  async marcarCatalogoDescargado(
    user: UsuarioToken,
    dispositivoId: string | undefined,
    version: string,
  ) {
    if (!dispositivoId) return;
    await this.prisma.dispositivoMovil
      .upsert({
        where: { id: dispositivoId },
        create: {
          id: dispositivoId,
          empresaId: user.empresaId,
          usuarioId: user.id,
          ultimoCatalogoVersion: version,
        },
        update: { ultimoCatalogoVersion: version },
      })
      .catch(() => undefined);
  }

  /**
   * Descartar una operación que quedó en ERROR (p. ej. producto eliminado).
   * Queda auditada como DESCARTADA con el motivo; solo admin o usuarios con
   * permiso de anular comprobantes.
   */
  async descartar(user: UsuarioToken, dto: DescartarOperacionDto) {
    if (user.rol !== 'ADMIN_EMPRESA' && !user.puedeAnularComprobantes) {
      throw new ForbiddenException('Solo un administrador puede descartar operaciones.');
    }
    const previa = await this.prisma.operacionSync.findUnique({ where: { uuid: dto.uuid } });
    if (previa && previa.estado === 'OK') {
      throw new BadRequestException('La operación ya fue sincronizada; no se puede descartar.');
    }
    const hash = previa?.payloadHash ?? this.hashPayload(dto.payload);
    const { realizadoEn } = this.resolverFecha(dto.realizadoEn);
    await this.guardar(
      user,
      dto.dispositivoId,
      dto,
      dto.sedeId ?? user.sedeId ?? undefined,
      previa?.realizadoEn ?? realizadoEn,
      hash,
      'DESCARTADA',
      { motivo: dto.motivo, descartadaPor: user.id },
      previa?.error ?? undefined,
    );
    return { uuid: dto.uuid, estado: 'DESCARTADA' };
  }

  /** Resumen para soporte (panel de sistema / admin): dispositivos y últimas operaciones. */
  async estado(empresaId: number) {
    const [dispositivos, ultimas, conteo] = await Promise.all([
      this.prisma.dispositivoMovil.findMany({
        where: { empresaId },
        orderBy: { ultimoSyncEn: 'desc' },
      }),
      this.prisma.operacionSync.findMany({
        where: { empresaId },
        orderBy: { recibidoEn: 'desc' },
        take: 50,
        select: {
          uuid: true, tipo: true, estado: true, error: true, realizadoEn: true,
          recibidoEn: true, dispositivoId: true, sedeId: true, resultado: true,
        },
      }),
      this.prisma.operacionSync.groupBy({
        by: ['estado'],
        where: { empresaId },
        _count: { _all: true },
      }),
    ]);
    return { dispositivos, ultimas, conteo };
  }

  private async avisarAdmins(
    empresaId: number,
    op: OperacionSyncDto,
    resultado: NonNullable<ResultadoOperacionSync['resultado']>,
  ) {
    try {
      const doc =
        resultado.serie && resultado.correlativo
          ? `${resultado.serie}-${String(resultado.correlativo).padStart(6, '0')}`
          : op.tipo;
      await this.notificaciones.notificarAdminsEmpresa({
        empresaId,
        tipo: 'WARNING',
        titulo: 'Sincronización sin conexión con avisos',
        mensaje: `${doc}: ${resultado.avisos!.join(' ')}`,
        metaData: { origen: 'sync-movil', uuid: op.uuid, tipo: op.tipo },
      });
    } catch (e) {
      this.logger.warn(`No se pudo notificar avisos de sync: ${(e as Error).message}`);
    }
  }
}
