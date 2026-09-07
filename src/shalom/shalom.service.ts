import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShalomAgencia, ShalomLatService } from './shalom-lat.service';
import {
  derivarEstadoShalom,
  planPermiteShalomPro,
  ShalomDerivado,
} from './shalom.util';
import { ConectarInstanciaDto, CrearGuiaDto } from './dto/shalom.dto';

export type { ShalomAgencia, ShalomOrderInput } from './shalom-lat.service';

/**
 * Tipos de producto de Shalom con sus medidas por defecto. El proveedor no
 * publica catálogo (todas las rutas /products dan 404); estos ids salen de las
 * órdenes reales de la cuenta, en `detail_service.type_product.value`.
 * El id es por cuenta de Shalom Pro: si otro negocio usa otros, se ajusta con
 * SHALOM_TIPO_PRODUCTO o mandando `tipoProducto` en la llamada.
 */
const MEDIDAS_POR_PRODUCTO: Record<
  number,
  { alto: number; ancho: number; largo: number; peso: number }
> = {
  // MINI PAQUETERIA XS
  10: { alto: 0.15, ancho: 0.12, largo: 0.2, peso: 0.5 },
  12: { alto: 0.15, ancho: 0.12, largo: 0.2, peso: 0.5 },
  // PAQUETERIA S
  14: { alto: 0.2, ancho: 0.12, largo: 0.3, peso: 2 },
};

const NOMBRES_PRODUCTO: Record<number, string> = {
  10: 'MINI PAQUETERIA XS',
  12: 'MINI PAQUETERIA XS',
  14: 'PAQUETERIA S',
};

const PRODUCTO_DEFECTO = {
  id: 10,
  medidas: MEDIDAS_POR_PRODUCTO[10],
};

/** Primer valor con contenido real. Trata '' y '   ' como ausentes. */
function primeroNoVacio(...valores: Array<string | null | undefined>): string {
  for (const v of valores) {
    const t = String(v ?? '').trim();
    if (t) return t;
  }
  return '';
}

/**
 * Servicio Shalom de falconext-mype. Todas las empresas usan el proveedor
 * api.shalom-api.lat (`ShalomLatService`), autenticado con una API key global:
 * tracking, agencias, comprobante, etiqueta y cotización NO requieren cuenta
 * Shalom Pro. El proveedor legacy (api.shalom-api-peru.com) quedó retirado.
 *
 * Los documentos (comprobante/etiqueta) se devuelven como `{ buffer, contentType }`
 * (la API nueva puede devolver PNG o PDF).
 */
@Injectable()
export class ShalomService {
  private readonly logger = new Logger(ShalomService.name);
  // El snapshot de tracking persistido se considera fresco durante 10 min: en
  // ese lapso el modal responde al instante sin volver a golpear a Shalom.
  private readonly TRACK_CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lat: ShalomLatService,
  ) {}

  // Toda falconext-mype usa el proveedor NUEVO (api.shalom-api.lat): tracking,
  // agencias, comprobante, etiqueta y cotización solo requieren la API key global
  // (sin cuenta Shalom Pro). El proveedor legacy (api.shalom-api-peru.com) quedó
  // retirado; `oseId` ya no se usa (la nueva API indexa por orderNumber+orderCode).
  async getAgencias(_empresaId?: number) {
    return this.lat.getAgencias();
  }

  async track(orderNumber: string, orderCode: string, empresaId?: number) {
    return this.lat.track(orderNumber, orderCode, empresaId);
  }

  async quote(origin: number, destination: number, _empresaId?: number) {
    return this.lat.quote(origin, destination);
  }


  async ticketImage(
    orderNumber: string,
    orderCode: string,
    _empresaId?: number,
    _oseId?: number | string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.lat.ticketImage(orderNumber, orderCode);
  }

  async label(
    orderNumber: string,
    orderCode: string,
    _empresaId?: number,
    _oseId?: number | string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.lat.label(orderNumber, orderCode);
  }

  // ─── Persistencia / caché de tracking ────────────────────────────────────

  /** Busca el EnvioDespacho asociado a una orden Shalom (por nº + clave). */
  private async buscarEnvio(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<{
    id: number;
    shalomEstado: string | null;
    shalomSyncAt: Date | null;
    shalomTrackingJson: any;
  } | null> {
    if (!orderNumber || !orderCode) return null;
    return this.prisma.envioDespacho
      .findFirst({
        where: {
          nroOrden: String(orderNumber),
          claveOrden: String(orderCode),
          ...(empresaId ? { comprobante: { empresaId } } : {}),
        },
        select: {
          id: true,
          shalomEstado: true,
          shalomSyncAt: true,
          shalomTrackingJson: true,
        },
        orderBy: { creadoEn: 'desc' },
      })
      .catch(() => null) as any;
  }

  /** Deriva el estado del snapshot y lo persiste en el EnvioDespacho. */
  private async persistir(envioId: number, trackData: any): Promise<ShalomDerivado> {
    const d = derivarEstadoShalom(trackData);
    await this.prisma.envioDespacho
      .update({
        where: { id: envioId },
        data: {
          shalomEstado: d.estado ?? undefined,
          shalomEntregado: d.entregado,
          shalomOseId: d.oseId ?? undefined,
          shalomTrackingJson: trackData ?? undefined,
          shalomSyncAt: new Date(),
        },
      })
      .catch((e) =>
        this.logger.warn(
          `No se pudo persistir tracking del envío ${envioId}: ${e?.message}`,
        ),
      );
    return d;
  }

  /**
   * Tracking con read-through cache: si hay snapshot persistido fresco (<10 min)
   * lo devuelve al instante; si no, consulta Shalom en vivo y lo persiste. Si el
   * upstream falla pero hay un snapshot previo (aunque viejo), lo devuelve con
   * `stale: true` en vez de fallar (resiliencia ante el scraper intermitente).
   */
  async trackConCache(
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
    refresh = false,
  ): Promise<any> {
    const envio = await this.buscarEnvio(orderNumber, orderCode, empresaId);

    if (!refresh && envio?.shalomTrackingJson && envio.shalomSyncAt) {
      const edadMs = Date.now() - new Date(envio.shalomSyncAt).getTime();
      if (edadMs < this.TRACK_CACHE_TTL_MS) {
        return {
          ...(envio.shalomTrackingJson as any),
          cached: true,
          syncAt: envio.shalomSyncAt,
        };
      }
    }

    try {
      const fresco = await this.track(orderNumber, orderCode, empresaId);
      if (envio) await this.persistir(envio.id, fresco);
      return { ...fresco, cached: false, syncAt: new Date() };
    } catch (err) {
      // Fallback: devolver el último snapshot conocido si Shalom está caído.
      if (envio?.shalomTrackingJson) {
        this.logger.warn(
          `Shalom no respondió; devolviendo snapshot en caché del envío ${envio.id}`,
        );
        return {
          ...(envio.shalomTrackingJson as any),
          cached: true,
          stale: true,
          syncAt: envio.shalomSyncAt,
        };
      }
      throw err;
    }
  }

  // ─── Cuenta Shalom Pro (instancia) ────────────────────────────────────────
  // Crear guías no lo cubre la API key global: el proveedor necesita la cuenta
  // Shalom Pro del negocio registrada como instancia. Solo plan Corporativo.

  /** Empresa + plan, validando que el plan habilite crear guías. */
  private async empresaConShalomPro(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombreComercial: true,
        razonSocial: true,
        shalomEmail: true,
        shalomPassword: true,
        shalomInstanceId: true,
        shalomInstanceNombre: true,
        shalomInstanceEstado: true,
        shalomInstanceError: true,
        shalomInstanceSyncAt: true,
        shalomSecurityCode: true,
        shalomAgenciaOrigenId: true,
        shalomAgenciaOrigenNombre: true,
        shalomAutoGuiaActivo: true,
        plan: { select: { nombre: true } },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (!planPermiteShalomPro(empresa.plan?.nombre)) {
      throw new ForbiddenException(
        'Crear guías en Shalom desde el sistema está disponible solo en el plan Corporativo.',
      );
    }
    return empresa;
  }

  /** Estado de la conexión, sin exponer nunca la contraseña. */
  async getInstancia(empresaId?: number) {
    // ADMIN_SISTEMA y sesiones sin empresa: la sección simplemente no aplica.
    if (!empresaId) return this.instanciaDeshabilitada();
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        shalomEmail: true,
        shalomPassword: true,
        shalomInstanceId: true,
        shalomInstanceNombre: true,
        shalomInstanceEstado: true,
        shalomInstanceError: true,
        shalomInstanceSyncAt: true,
        shalomSecurityCode: true,
        shalomAgenciaOrigenId: true,
        shalomAgenciaOrigenNombre: true,
        shalomAutoGuiaActivo: true,
        plan: { select: { nombre: true } },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    return {
      // El frontend usa esto para mostrar u ocultar toda la sección.
      habilitadoPorPlan: planPermiteShalomPro(empresa.plan?.nombre),
      conectada: Boolean(empresa.shalomInstanceId),
      instanceId: empresa.shalomInstanceId,
      nombre: empresa.shalomInstanceNombre,
      estado: empresa.shalomInstanceEstado,
      error: empresa.shalomInstanceError,
      sincronizadoEn: empresa.shalomInstanceSyncAt,
      email: empresa.shalomEmail,
      credencialesGuardadas: Boolean(empresa.shalomPassword),
      securityCodeGuardado: Boolean(empresa.shalomSecurityCode),
      agenciaOrigenId: empresa.shalomAgenciaOrigenId,
      agenciaOrigenNombre: empresa.shalomAgenciaOrigenNombre,
      // La venta genera la guía sola (opt-in por empresa).
      autoGuiaActivo: empresa.shalomAutoGuiaActivo,
    };
  }

  private instanciaDeshabilitada() {
    return {
      habilitadoPorPlan: false,
      conectada: false,
      instanceId: null,
      nombre: null,
      estado: null,
      error: null,
      sincronizadoEn: null,
      email: null,
      credencialesGuardadas: false,
      securityCodeGuardado: false,
      agenciaOrigenId: null,
      agenciaOrigenNombre: null,
      autoGuiaActivo: false,
    };
  }

  /**
   * Registra la cuenta Shalom Pro del negocio como instancia en el proveedor y
   * guarda el instanceId. Las credenciales se persisten para que el proveedor
   * pueda reabrir la sesión cuando expire.
   */
  async conectarInstancia(empresaId: number, dto: ConectarInstanciaDto) {
    const empresa = await this.empresaConShalomPro(empresaId);
    const username = dto.username?.trim() || empresa.shalomEmail || '';
    const password = dto.password?.trim() || empresa.shalomPassword || '';
    if (!username || !password) {
      throw new BadRequestException(
        'Ingresa el correo y la contraseña de tu cuenta Shalom Pro.',
      );
    }
    const nombre =
      dto.nombre?.trim() ||
      empresa.nombreComercial ||
      empresa.razonSocial ||
      `Empresa ${empresaId}`;

    try {
      // Si la empresa YA tiene instancia, reconectar = volver a loguear esa misma.
      // Crear otra consumiría un cupo del plan del proveedor (que los cuenta por
      // key, no por empresa) y devolvería 403 "Has alcanzado el límite",
      // marcando como ERROR una conexión que en realidad seguía sana.
      let instanceId = empresa.shalomInstanceId ?? null;
      if (!instanceId) {
        const respuesta = await this.lat.crearInstancia({
          name: nombre,
          username,
          password,
        });
        instanceId = this.extraerInstanceId(respuesta);
      }
      if (!instanceId) {
        throw new BadRequestException(
          'Shalom no devolvió el identificador de la instancia. Intenta de nuevo.',
        );
      }
      // Crear la instancia NO abre la sesión: el proveedor la devuelve con
      // isLoggedIn=false y username=null hasta que se llama /instances/login.
      // Sin esto la empresa quedaba "Conectada" en el panel pero sin sesión real,
      // y el primer intento de guía fallaba.
      await this.lat.loginInstancia(instanceId, username, password);

      await this.prisma.empresa.update({
        where: { id: empresaId },
        data: {
          shalomEmail: username,
          shalomPassword: password,
          shalomInstanceId: instanceId,
          shalomInstanceNombre: nombre,
          shalomInstanceEstado: 'CONECTADA',
          shalomInstanceError: null,
          shalomInstanceSyncAt: new Date(),
          ...(dto.securityCode !== undefined
            ? { shalomSecurityCode: dto.securityCode?.trim() || null }
            : {}),
          ...(dto.agenciaOrigenId !== undefined
            ? {
                shalomAgenciaOrigenId: dto.agenciaOrigenId?.trim() || null,
                shalomAgenciaOrigenNombre:
                  dto.agenciaOrigenNombre?.trim() || null,
              }
            : {}),
        },
      });
      return this.getInstancia(empresaId);
    } catch (error: any) {
      await this.prisma.empresa
        .update({
          where: { id: empresaId },
          data: {
            shalomInstanceEstado: 'ERROR',
            shalomInstanceError: String(error?.message ?? '').slice(0, 300),
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /** Fuerza el login en Shalom Pro (botón "reconectar"). */
  async reconectarInstancia(empresaId: number) {
    const empresa = await this.empresaConShalomPro(empresaId);
    if (!empresa.shalomInstanceId) {
      throw new BadRequestException(
        'Todavía no has conectado tu cuenta Shalom Pro.',
      );
    }
    try {
      await this.lat.loginInstancia(
        empresa.shalomInstanceId,
        empresa.shalomEmail ?? undefined,
        empresa.shalomPassword ?? undefined,
      );
      await this.prisma.empresa.update({
        where: { id: empresaId },
        data: {
          shalomInstanceEstado: 'CONECTADA',
          shalomInstanceError: null,
          shalomInstanceSyncAt: new Date(),
        },
      });
    } catch (error: any) {
      await this.prisma.empresa
        .update({
          where: { id: empresaId },
          data: {
            shalomInstanceEstado: 'ERROR',
            shalomInstanceError: String(error?.message ?? '').slice(0, 300),
          },
        })
        .catch(() => undefined);
      throw error;
    }
    return this.getInstancia(empresaId);
  }

  /** Actualiza agencia de origen y código de seguridad sin volver a loguear. */
  async actualizarConfigInstancia(
    empresaId: number,
    dto: Pick<
      ConectarInstanciaDto,
      | 'agenciaOrigenId'
      | 'agenciaOrigenNombre'
      | 'securityCode'
      | 'autoGuiaActivo'
    >,
  ) {
    await this.empresaConShalomPro(empresaId);
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        ...(dto.agenciaOrigenId !== undefined
          ? {
              shalomAgenciaOrigenId: dto.agenciaOrigenId?.trim() || null,
              shalomAgenciaOrigenNombre: dto.agenciaOrigenNombre?.trim() || null,
            }
          : {}),
        ...(dto.securityCode !== undefined
          ? { shalomSecurityCode: dto.securityCode?.trim() || null }
          : {}),
        ...(dto.autoGuiaActivo !== undefined
          ? { shalomAutoGuiaActivo: Boolean(dto.autoGuiaActivo) }
          : {}),
      },
    });
    return this.getInstancia(empresaId);
  }

  /**
   * Desconecta la cuenta. Elimina también la instancia en el proveedor: el cupo
   * del plan se cuenta por instancias vivas, así que borrarla solo de nuestra BD
   * dejaría el cupo ocupado y ninguna otra empresa podría conectarse.
   */
  async desconectarInstancia(empresaId: number) {
    const empresa = await this.empresaConShalomPro(empresaId);
    if (empresa.shalomInstanceId) {
      // Si el proveedor falla igual desconectamos localmente (el usuario lo pidió),
      // pero queda el aviso porque el cupo seguiría tomado.
      await this.lat
        .eliminarInstancia(empresa.shalomInstanceId)
        .catch((e) =>
          this.logger.warn(
            `No se pudo eliminar la instancia ${empresa.shalomInstanceId} en Shalom: ${e?.message}. El cupo del plan podría seguir ocupado.`,
          ),
        );
    }
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        shalomInstanceId: null,
        shalomInstanceNombre: null,
        shalomInstanceEstado: null,
        shalomInstanceError: null,
        shalomInstanceSyncAt: null,
        shalomPassword: null,
        shalomSecurityCode: null,
      },
    });
    return this.getInstancia(empresaId);
  }

  /**
   * Tipos de producto disponibles para la empresa. Shalom no expone catálogo
   * (todas las rutas /products dan 404), así que se derivan de las órdenes reales
   * de su propia cuenta — que además es lo correcto: el catálogo es por cuenta.
   * Si la cuenta no tiene historial, se devuelven los conocidos.
   */
  async productos(empresaId: number) {
    const empresa = await this.empresaConShalomPro(empresaId);
    const conocidos = Object.entries(MEDIDAS_POR_PRODUCTO).map(([id, m]) => ({
      id: Number(id),
      nombre: NOMBRES_PRODUCTO[Number(id)] ?? `Producto ${id}`,
      ...m,
    }));
    if (!empresa.shalomInstanceId) return conocidos;

    try {
      const pendientes = await this.lat.pendingShipments(
        empresa.shalomInstanceId,
      );
      const porId = new Map<number, any>();
      for (const envio of Object.values(pendientes ?? {})) {
        for (const det of (envio as any)?.detail_service ?? []) {
          const tp = det?.type_product;
          if (!tp?.value || porId.has(Number(tp.value))) continue;
          porId.set(Number(tp.value), {
            id: Number(tp.value),
            nombre: String(tp.name ?? tp.detalle ?? `Producto ${tp.value}`),
            alto: Number(det.high) || PRODUCTO_DEFECTO.medidas.alto,
            ancho: Number(det.width) || PRODUCTO_DEFECTO.medidas.ancho,
            largo: Number(det.length) || PRODUCTO_DEFECTO.medidas.largo,
            peso: Number(det.weight) || PRODUCTO_DEFECTO.medidas.peso,
          });
        }
      }
      // Los del historial mandan; se completan con los conocidos que falten.
      for (const c of conocidos) if (!porId.has(c.id)) porId.set(c.id, c);
      return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
    } catch (e: any) {
      this.logger.warn(`No se pudieron leer los productos: ${e?.message}`);
      return conocidos;
    }
  }

  /** Envíos pendientes de la cuenta conectada (espejo de Shalom Pro). */
  async pendientes(empresaId: number) {
    const empresa = await this.empresaConShalomPro(empresaId);
    if (!empresa.shalomInstanceId) {
      throw new BadRequestException(
        'Todavía no has conectado tu cuenta Shalom Pro.',
      );
    }
    return this.lat.pendingShipments(empresa.shalomInstanceId);
  }

  // ─── Crear guía desde un despacho ─────────────────────────────────────────

  /**
   * Crea la guía en Shalom Pro a partir de un despacho ya registrado y guarda el
   * N° de orden / clave devueltos en el EnvioDespacho, que es justo lo que el
   * rastreo (y el cron) necesitan para seguir el envío.
   */
  async crearGuiaDesdeDespacho(
    comprobanteId: number,
    empresaId: number,
    dto: CrearGuiaDto = {},
  ) {
    const empresa = await this.empresaConShalomPro(empresaId);
    if (!empresa.shalomInstanceId) {
      throw new BadRequestException(
        'Conecta tu cuenta Shalom Pro antes de generar guías.',
      );
    }

    const envio = await this.prisma.envioDespacho.findFirst({
      where: { comprobanteId, comprobante: { empresaId } },
      include: {
        comprobante: {
          select: {
            id: true,
            serie: true,
            correlativo: true,
            cliente: {
              select: {
                nombre: true,
                nroDoc: true,
                telefono: true,
                direccion: true,
              },
            },
            detalles: { select: { descripcion: true, cantidad: true } },
          },
        },
      },
    });
    if (!envio) {
      throw new NotFoundException(
        'Este comprobante no tiene un despacho registrado.',
      );
    }
    if (envio.nroOrden && envio.claveOrden && !dto.forzar) {
      throw new BadRequestException(
        `Este despacho ya tiene la guía ${envio.nroOrden} registrada.`,
      );
    }

    const agencias = (await this.lat.getAgencias()).data ?? [];
    const origen = this.resolverAgencia(
      agencias,
      dto.origenId ?? empresa.shalomAgenciaOrigenId,
      dto.origenNombre ?? empresa.shalomAgenciaOrigenNombre,
    );
    if (!origen) {
      throw new BadRequestException(
        'Configura la agencia Shalom de origen de tu negocio antes de generar guías.',
      );
    }
    const destino = this.resolverAgencia(
      agencias,
      dto.destinoId ?? envio.shalomAgenciaDestinoId,
      dto.destinoNombre ?? envio.agenciaDestino,
    );
    if (!destino) {
      throw new BadRequestException(
        'No se pudo identificar la agencia Shalom de destino. Vuelve a elegirla en el despacho.',
      );
    }

    const cliente = envio.comprobante?.cliente;
    // El despacho guarda los campos del destinatario como cadena vacía cuando no
    // se llenan, así que `??` no sirve para encadenar: hay que saltar los vacíos.
    const dni = primeroNoVacio(
      dto.dni,
      envio.dniDestinatario,
      cliente?.nroDoc,
    );
    const nombre = primeroNoVacio(
      dto.nombre,
      envio.nombreDestinatario,
      cliente?.nombre,
    );
    if (!dni || !nombre) {
      throw new BadRequestException(
        'Falta el nombre o el documento del destinatario para generar la guía.',
      );
    }

    // Shalom arma el nombre concatenando name + firstname + lastname, así que son
    // las tres partes del documento (nombres / paterno / materno), NO el nombre
    // completo: mandar el completo en `name` lo duplicaba en la guía.
    const partes = await this.separarNombre(dni, nombre);

    const telefono = primeroNoVacio(
      dto.telefono,
      envio.celularDest,
      cliente?.telefono,
    );
    const phone = Number(String(telefono).replace(/\D/g, ''));
    if (!phone) {
      throw new BadRequestException(
        'Falta el celular del destinatario para generar la guía.',
      );
    }

    // El tipo de producto lo exige Shalom aunque su esquema lo marque opcional:
    // sin él responde 200 con {success:false,"Seleccione un producto"}. Y un id
    // que no está en el catálogo de la cuenta pasa igual, pero deja la guía con
    // contenido "N/A" y monto S/ 0.00 — inservible para despachar.
    // Los ids salen de las órdenes reales de la cuenta (detail_service.type_product).
    const tipoProducto = Number(
      dto.tipoProducto ??
        envio.shalomTipoProducto ??
        process.env.SHALOM_TIPO_PRODUCTO ??
        PRODUCTO_DEFECTO.id,
    );

    const respuesta = await this.lat.createOrder({
      instanceId: empresa.shalomInstanceId,
      origen: Number(origen.terId),
      destino: Number(destino.terId),
      documento: dni,
      name: partes.nombres,
      firstname: partes.apellidoPaterno,
      lastname: partes.apellidoMaterno,
      phone,
      tipo_producto: tipoProducto,
      cantidad: Number(envio.nroPaquetes) > 0 ? Number(envio.nroPaquetes) : 1,
      // Las medidas NO se envían cuando se usa un producto del catálogo: Shalom
      // toma las suyas. Mandarlas hacía que validara como medida personalizada y
      // rechazara con "Supera las dimensiones de la categoría de la agencia",
      // incluso hacia agencias donde ese mismo producto sí se usa a diario.
      // Solo se manda el peso si el despacho declara uno real.
      ...(Number(envio.pesoKg) > 0 ? { peso: String(Number(envio.pesoKg)) } : {}),
    });

    // Shalom responde 200 con { success:false, message } cuando rechaza el
    // registro (p. ej. "Seleccione un producto"): sin esto se guardaba como éxito
    // una guía que nunca existió.
    if (respuesta?.success === false) {
      const motivo = String(respuesta?.message ?? '').trim();
      this.logger.error(
        `Shalom rechazó el registro del comprobante ${comprobanteId}: ${motivo}`,
      );
      throw new BadRequestException(
        motivo
          ? `Shalom rechazó el envío: ${motivo}`
          : 'Shalom rechazó el envío sin indicar el motivo.',
      );
    }

    const guia = this.extraerGuia(respuesta);
    if (!guia.nroOrden) {
      // Sin el N° de orden no hay rastreo posible, así que hay que poder ver qué
      // devolvió realmente el proveedor en vez de adivinar.
      this.logger.warn(
        `Shalom no devolvió N° de orden para el comprobante ${comprobanteId}. Respuesta cruda: ${JSON.stringify(
          respuesta,
        ).slice(0, 1000)}`,
      );
    }

    // El registro devuelve el N° de guía pero no siempre la clave, y sin clave no
    // hay rastreo posible. Se completa desde los pendientes de la cuenta, donde
    // la orden recién creada ya aparece con su código.
    if (guia.nroOrden && !guia.claveOrden) {
      const desdePendientes = await this.buscarClaveEnPendientes(
        empresa.shalomInstanceId,
        guia.nroOrden,
      );
      if (desdePendientes) {
        guia.claveOrden = desdePendientes.claveOrden;
        guia.claveEnvio = guia.claveEnvio ?? desdePendientes.claveEnvio;
      } else {
        this.logger.warn(
          `Shalom creó la guía ${guia.nroOrden} pero no se pudo obtener su clave; el rastreo quedará incompleto.`,
        );
      }
    }

    const actualizado = await this.prisma.envioDespacho.update({
      where: { id: envio.id },
      data: {
        ...(guia.nroOrden ? { nroOrden: guia.nroOrden } : {}),
        ...(guia.claveOrden ? { claveOrden: guia.claveOrden } : {}),
        ...(guia.claveEnvio ? { claveEnvio: guia.claveEnvio } : {}),
        shalomAgenciaDestinoId: destino.terId,
        shalomGuiaCreadaEn: new Date(),
      },
      select: {
        id: true,
        nroOrden: true,
        claveOrden: true,
        claveEnvio: true,
        shalomGuiaCreadaEn: true,
      },
    });

    return { ...actualizado, respuesta };
  }

  /**
   * Nombres y apellidos por separado, como los pide Shalom. Primero se consulta
   * RENIEC por DNI (exacto); si falla, se parte el nombre guardado, que en el
   * sistema viene como "APELLIDOS, NOMBRES".
   */
  private async separarNombre(
    dni: string,
    nombreCompleto: string,
  ): Promise<{
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string;
  }> {
    const reniec = await this.lat.consultarDni(dni).catch(() => null);
    const d = reniec?.data ?? reniec;
    const nombres = String(d?.nombres ?? '').trim();
    const paterno = String(d?.apellidoPaterno ?? '').trim();
    if (nombres && paterno) {
      return {
        nombres,
        apellidoPaterno: paterno,
        apellidoMaterno: String(d?.apellidoMaterno ?? '').trim(),
      };
    }

    // Fallback sin RENIEC: el sistema guarda "APELLIDOS, NOMBRES".
    const [apeRaw, nomRaw] = nombreCompleto.split(',');
    const apellidos = (nomRaw ? apeRaw : '').trim().split(/\s+/).filter(Boolean);
    const soloNombres = (nomRaw ?? apeRaw ?? '').trim();
    return {
      nombres: soloNombres,
      apellidoPaterno: apellidos[0] ?? '',
      apellidoMaterno: apellidos.slice(1).join(' '),
    };
  }

  /** Descripción del contenido para Shalom (fallback: los ítems del comprobante). */
  private armarProductos(envio: any): Array<{
    descripcion: string;
    cantidad: number;
  }> {
    const contenido = String(envio.contenidoPaquete ?? '').trim();
    if (contenido) {
      return [{ descripcion: contenido, cantidad: Number(envio.nroPaquetes) || 1 }];
    }
    const detalles: Array<{ descripcion: string; cantidad: number }> = (
      envio.comprobante?.detalles ?? []
    ).map((d: any) => ({
      descripcion: String(d.descripcion ?? '').slice(0, 120),
      cantidad: Math.max(1, Math.round(Number(d.cantidad) || 1)),
    }));
    if (detalles.length) return detalles;
    return [
      { descripcion: 'Mercadería', cantidad: Number(envio.nroPaquetes) || 1 },
    ];
  }

  /**
   * Resuelve una agencia por ter_id o, si solo hay texto (lo que guarda hoy el
   * despacho: "Nombre - Provincia - Departamento"), por coincidencia normalizada.
   */
  private resolverAgencia(
    agencias: ShalomAgencia[],
    terId?: string | null,
    texto?: string | null,
  ): ShalomAgencia | null {
    const id = String(terId ?? '').trim();
    if (id) {
      const porId = agencias.find((a) => a.terId === id);
      if (porId) return porId;
    }
    const buscado = this.normalizar(texto);
    if (!buscado) return null;
    const exacta =
      agencias.find((a) => this.normalizar(a.label) === buscado) ??
      agencias.find(
        (a) =>
          this.normalizar([a.nombre, a.provincia, a.departamento].join(' ')) ===
          buscado,
      );
    if (exacta) return exacta;
    // Sin coincidencia exacta caemos a la parcial, pero SOLO si es única: hay
    // agencias distintas con el mismo nombre (p. ej. dos "HUARAL - LIMA"), y
    // elegir la primera mandaría el paquete de un cliente real al local
    // equivocado. Ante ambigüedad es mejor fallar y pedir que la re-elijan.
    const parciales = agencias.filter((a) =>
      this.normalizar(a.label).includes(buscado),
    );
    if (parciales.length === 1) return parciales[0];
    if (parciales.length > 1) {
      throw new BadRequestException(
        `Hay ${parciales.length} agencias Shalom que coinciden con "${texto}". Vuelve a elegir la agencia de destino en el despacho para precisar cuál es.`,
      );
    }
    return null;
  }

  private normalizar(v?: string | null): string {
    return String(v ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /** El proveedor puede devolver el id de instancia con distintos nombres. */
  private extraerInstanceId(respuesta: any): string | null {
    const v =
      respuesta?.instanceId ??
      respuesta?.instance_id ??
      respuesta?.id ??
      respuesta?.data?.instanceId ??
      respuesta?.data?.instance_id ??
      respuesta?.data?.id ??
      respuesta?.instance?.id ??
      null;
    return v != null ? String(v) : null;
  }

  /**
   * Busca en los envíos pendientes de la cuenta la orden recién creada, para
   * recuperar su clave (`code_service_order_empresarial`), que es la mitad que
   * falta para poder rastrear.
   */
  private async buscarClaveEnPendientes(
    instanceId: string,
    nroOrden: string,
  ): Promise<{ claveOrden: string | null; claveEnvio: string | null } | null> {
    try {
      const pendientes = await this.lat.pendingShipments(instanceId);
      const envios = Object.values(pendientes ?? {}).filter(
        (v): v is Record<string, any> => Boolean(v) && typeof v === 'object',
      );
      const match = envios.find(
        (e) => String(e.service_order_guia_empresarial ?? '') === String(nroOrden),
      );
      if (!match) return null;
      return {
        claveOrden: match.code_service_order_empresarial
          ? String(match.code_service_order_empresarial)
          : null,
        claveEnvio: match.code_val ? String(match.code_val) : null,
      };
    } catch (e: any) {
      this.logger.warn(`No se pudo leer pendientes para la clave: ${e?.message}`);
      return null;
    }
  }

  /** Extrae N° de orden / claves de la respuesta de /account/register. */
  private extraerGuia(respuesta: any): {
    nroOrden: string | null;
    claveOrden: string | null;
    claveEnvio: string | null;
  } {
    const d = respuesta?.data ?? respuesta ?? {};
    const orden = d?.order ?? d?.orden ?? d;
    const pick = (...claves: string[]): string | null => {
      for (const c of claves) {
        const v = orden?.[c] ?? d?.[c];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
      return null;
    };
    return {
      // Forma real verificada de /account/register al crear con éxito:
      // { success:true, data:{ codigo:"DHND", guia:94883904, serie:"V947", ose_id } }
      nroOrden: pick(
        'guia',
        'orderNumber',
        'order_number',
        'nroOrden',
        'numero',
        'service_order_guia_empresarial',
      ),
      claveOrden: pick(
        'codigo',
        'orderCode',
        'order_code',
        'claveOrden',
        'clave',
        'code_service_order_empresarial',
      ),
      // "Clave de envío" es el código de retiro de 4 dígitos (así lo usan en el
      // panel: 2056, 0105…), que en Shalom viaja como `code_val`. NO es la serie
      // (V947), que es otra cosa.
      claveEnvio: pick('shipmentCode', 'claveEnvio', 'clave_envio', 'code_val'),
    };
  }

  /**
   * Refresca un envío contra Shalom y persiste el resultado. Devuelve el estado
   * previo y el derivado nuevo para que el scheduler decida si notificar.
   */
  async sincronizarEnvio(
    envioId: number,
    orderNumber: string,
    orderCode: string,
    empresaId?: number,
  ): Promise<{ estadoPrevio: string | null; derivado: ShalomDerivado }> {
    const previo = await this.prisma.envioDespacho
      .findUnique({ where: { id: envioId }, select: { shalomEstado: true } })
      .catch(() => null);
    const trackData = await this.track(orderNumber, orderCode, empresaId);
    const derivado = await this.persistir(envioId, trackData);
    return { estadoPrevio: previo?.shalomEstado ?? null, derivado };
  }
}
