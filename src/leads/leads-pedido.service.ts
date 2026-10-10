import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ComprobanteService } from '../comprobante/comprobante.service';
import { EnvioDespachoService } from '../envio-despacho/envio-despacho.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import {
  SIN_CONFIG_ENVIO,
  tieneEnvioConfigurado,
  ConfigEnvio,
  TipoZona,
  resolverDestino,
} from './envio-zonas';
import {
  HORARIO_POR_DEFECTO,
  ConfigHorarioEntrega,
  normalizarCelular,
  validarCelular,
  validarDni,
} from './validaciones-pedido';
import {
  SIN_DESCUENTO,
  ReglasDescuento,
  calcularDescuento,
  soles,
} from './reglas-descuento';

/** Lo que cada empresa configura de su operación comercial. */
export interface ConfigComercial {
  envio: ConfigEnvio;
  horario: ConfigHorarioEntrega;
  descuento: ReglasDescuento;
  /** Nombre con el que se presenta quien atiende ("Claudio" en Hierba Sana). */
  asesor?: string;
  /**
   * Texto fijo al pie de toda recomendación de producto. El anexo lo exige
   * "fijo e invariable", por eso lo pone el código y no el modelo.
   */
  descargoLegal?: string;
}

/** Campos que la IA puede ir guardando a medida que el cliente los dice. */
export interface DatosDelCliente {
  destino?: string;
  nombre?: string;
  dni?: string;
  celular?: string;
  direccion?: string;
  referencia?: string;
  horario?: string;
  agenciaSede?: string;
  recibeNombre?: string;
  /**
   * Sexo y edad del cliente. NO son datos de entrega y nunca se le piden:
   * solo se anotan si los dice (la edad suele salir al hablar de la dosis).
   * El anexo pide un reporte demográfico, y la alternativa a esto sería
   * adivinarlo por el nombre, que es como se arma un dato falso.
   */
  sexo?: string;
  edad?: number | string;
}

export interface ItemPedido {
  productoId: number;
  cantidad: number;
}

/**
 * C1, C2 y C3 — del chat al pedido registrado.
 *
 * Todo lo que decide dinero vive aquí y no en el prompt: el modelo no suma, no
 * aplica descuentos y no inventa tarifas. Le pasa los datos, recibe los
 * números ya calculados y los copia.
 */
@Injectable()
export class LeadsPedidoService {
  private readonly logger = new Logger(LeadsPedidoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comprobante: ComprobanteService,
    private readonly despacho: EnvioDespachoService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /** La configuración de la empresa, con los valores por defecto de relleno. */
  async configDe(empresaId: number): Promise<ConfigComercial> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true },
    });
    const guardada = (empresa?.iaVentasConfigJson ??
      {}) as Partial<ConfigComercial>;
    return {
      // Sin configurar, VACÍO: con las zonas y el horario de Hierba Sana de
      // relleno, otra empresa le cotizaba a sus clientes tarifas y horarios
      // que su dueño nunca fijó. El flujo lo detecta y deriva a una persona.
      envio: guardada.envio ?? SIN_CONFIG_ENVIO,
      horario: guardada.horario ?? HORARIO_POR_DEFECTO,
      // Sin tramos configurados, ninguno: los de Hierba Sana como defecto
      // hacían que cualquier otra empresa que encendiera la IA empezara a
      // regalar S/ 10 a S/ 30 por pedido sin pedirlo.
      descuento: guardada.descuento ?? SIN_DESCUENTO,
      ...(guardada.asesor ? { asesor: guardada.asesor } : {}),
      ...(guardada.descargoLegal
        ? { descargoLegal: guardada.descargoLegal }
        : {}),
    };
  }

  /**
   * Guarda lo que el cliente acaba de decir y devuelve qué falta.
   *
   * Devolver lo que falta es la mitad del valor: es lo que evita que la IA
   * repregunte un dato ya dado, que es el error que más castiga el banco de
   * pruebas del cliente.
   */
  async guardarDatos(
    empresaId: number,
    conversacionId: number,
    datos: DatosDelCliente,
  ): Promise<{
    zona?: string;
    costoEnvio?: number;
    formaPago?: string;
    guardado: string[];
    faltan: string[];
    problemas?: string[];
    aclarar?: string;
  }> {
    const config = await this.configDe(empresaId);
    const cambios: Prisma.LeadPedidoBorradorUncheckedUpdateInput = {};
    const guardado: string[] = [];
    const problemas: string[] = [];

    if (datos.destino?.trim()) {
      // Sin zonas configuradas no se puede decir cuánto cuesta el envío. Antes
      // se usaban las de Hierba Sana de relleno y la IA le cotizaba a los
      // clientes de otra empresa tarifas que su dueño nunca fijó.
      if (!tieneEnvioConfigurado(config.envio)) {
        return {
          guardado: [],
          faltan: [],
          aclarar:
            'Este negocio todavía no tiene configuradas sus zonas de envío. NO inventes un costo de envío ni una forma de pago: dile al cliente que un asesor le confirma el envío y deriva la conversación.',
        };
      }
      const resuelto = resolverDestino(datos.destino, config.envio);
      if (resuelto === 'ambiguo') {
        return {
          guardado: [],
          faltan: [],
          aclarar: `"${datos.destino}" puede ser de más de una zona. Pregúntale el distrito exacto antes de calcular el envío.`,
        };
      }
      if (resuelto) {
        cambios.zona = resuelto.zona.nombre;
        cambios.tipoZona = resuelto.zona.tipo;
        cambios.lugar = resuelto.lugar ?? datos.destino.trim();
        cambios.costoEnvio = new Prisma.Decimal(resuelto.zona.tarifa);
        guardado.push(`destino: ${resuelto.lugar ?? datos.destino.trim()}`);
      }
    }

    // El DNI y el celular se validan al entrar: un celular mal escrito es un
    // pedido que no se puede entregar, y eso se descubre con el repartidor ya
    // en la calle.
    if (datos.dni?.trim()) {
      const problema = validarDni(datos.dni);
      if (problema) problemas.push(problema.detalle);
      else {
        cambios.dni = datos.dni.replace(/\D/g, '');
        guardado.push('DNI');
      }
    }
    if (datos.celular?.trim()) {
      const problema = validarCelular(datos.celular);
      if (problema) problemas.push(problema.detalle);
      else {
        cambios.celular = normalizarCelular(datos.celular);
        guardado.push('celular');
      }
    }

    for (const campo of [
      'nombre',
      'direccion',
      'referencia',
      'horario',
      'agenciaSede',
      'recibeNombre',
    ] as const) {
      const valor = datos[campo]?.trim();
      if (valor) {
        cambios[campo] = valor;
        guardado.push(campo);
      }
    }

    const borrador = await this.prisma.leadPedidoBorrador.upsert({
      where: { conversacionId },
      create: { empresaId, conversacionId, ...(cambios as object) },
      update: cambios,
    });

    // Sexo y edad describen a la PERSONA, no al pedido: van al prospecto.
    // Nunca entran en `faltan`, así que el asistente no los pide: si el
    // cliente no los dijo, el reporte los cuenta como "sin dato".
    await this.anotarPerfil(empresaId, conversacionId, datos, guardado);

    return {
      ...(borrador.zona ? { zona: borrador.zona } : {}),
      ...(borrador.costoEnvio != null
        ? { costoEnvio: Number(borrador.costoEnvio) }
        : {}),
      ...(this.formaPagoDe(borrador.zona, config) ?? {}),
      guardado,
      faltan: this.faltantes(borrador),
      ...(problemas.length ? { problemas } : {}),
    };
  }

  /**
   * Anota sexo y edad si el cliente los mencionó.
   *
   * Best-effort y silencioso: un dato demográfico que no se pudo guardar no
   * puede cortarle la atención a quien está por comprar.
   */
  private async anotarPerfil(
    empresaId: number,
    conversacionId: number,
    datos: DatosDelCliente,
    guardado: string[],
  ): Promise<void> {
    const cambios: { sexo?: string; edad?: number } = {};

    const sexo = String(datos.sexo ?? '').trim().toUpperCase();
    if (sexo) {
      // Se normaliza a M/F: el modelo manda "masculino", "hombre", "varón"…
      if (/^(M|MASC|MASCULINO|HOMBRE|VARON|VARÓN)$/.test(sexo)) cambios.sexo = 'M';
      else if (/^(F|FEM|FEMENINO|MUJER|DAMA)$/.test(sexo)) cambios.sexo = 'F';
    }

    const edad = Math.trunc(Number(datos.edad));
    // Fuera de este rango es un error de lectura, no una edad: guardarlo
    // ensuciaría el reporte sin que nadie lo note.
    if (Number.isFinite(edad) && edad >= 1 && edad <= 110) cambios.edad = edad;

    if (!Object.keys(cambios).length) return;
    try {
      await this.prisma.leadProspecto.updateMany({
        where: { conversacionId, empresaId },
        data: cambios,
      });
      if (cambios.sexo) guardado.push('sexo');
      if (cambios.edad) guardado.push('edad');
    } catch {
      // Silencio a propósito: ver arriba.
    }
  }

  /**
   * El cliente del pedido: se busca por DNI, luego por teléfono, y si no
   * existe se crea con lo que el cliente ya dio en el chat.
   *
   * Vale la pena crearlo y no usar "CLIENTES VARIOS" porque es la misma
   * persona que va a volver: su siguiente pedido lo encuentra, y el historial
   * 360° y los reportes lo cuentan como un cliente y no como un anónimo.
   *
   * Si algo falla, devuelve null y el pedido se registra a CLIENTES VARIOS:
   * una venta no se pierde por no poder crear una ficha.
   */
  private async clienteDelPedido(
    empresaId: number,
    borrador: { nombre: string | null; dni: string | null; celular: string | null },
    telefono: string,
  ): Promise<number | null> {
    try {
      const dni = (borrador.dni ?? '').trim();
      const celular = (borrador.celular ?? '').trim() || telefono;
      const nombre = (borrador.nombre ?? '').trim();

      if (dni) {
        const porDni = await this.prisma.cliente.findFirst({
          where: { empresaId, nroDoc: dni, estado: 'ACTIVO' as never },
          select: { id: true, telefono: true },
        });
        if (porDni) {
          // Se le completa el celular si no lo tenía: el aviso de entrega sale
          // del teléfono de la ficha, no del celular del envío.
          if (!porDni.telefono && celular) {
            await this.prisma.cliente
              .update({ where: { id: porDni.id }, data: { telefono: celular } })
              .catch(() => undefined);
          }
          return porDni.id;
        }
      }

      if (celular) {
        const porTelefono = await this.prisma.cliente.findFirst({
          where: { empresaId, telefono: celular, estado: 'ACTIVO' as never },
          select: { id: true },
        });
        if (porTelefono) return porTelefono.id;
      }

      if (!nombre) return null;

      const tipoDni = await this.prisma.tipoDocumento.findFirst({
        where: { codigo: '1' },
        select: { id: true },
      });
      const creado = await this.prisma.cliente.create({
        data: {
          empresaId,
          nombre: nombre.toUpperCase(),
          // Sin DNI se guarda el celular como documento, que es como el
          // sistema ya registra a los clientes que llegan por WhatsApp.
          nroDoc: dni || celular,
          ...(dni && tipoDni ? { tipoDocumentoId: tipoDni.id } : {}),
          ...(celular ? { telefono: celular } : {}),
        },
        select: { id: true },
      });
      this.logger.log(
        `Lead: cliente ${creado.id} creado desde el chat (${nombre}).`,
      );
      return creado.id;
    } catch (e) {
      this.logger.warn(
        `Lead: no se pudo resolver el cliente del pedido: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /** Cómo se paga en la zona del borrador, con las palabras de la empresa. */
  private formaPagoDe(
    zona: string | null,
    config: ConfigComercial,
  ): { formaPago: string } | null {
    const z = config.envio.zonas.find((x) => x.nombre === zona);
    return z?.notaPago ? { formaPago: z.notaPago } : null;
  }

  /**
   * Qué datos faltan, en el orden en que hay que pedirlos. El orden es el del
   * flujo del cliente: primero quién es, luego dónde, luego cuándo.
   */
  private faltantes(b: {
    tipoZona: string | null;
    nombre: string | null;
    dni: string | null;
    celular: string | null;
    direccion: string | null;
    referencia: string | null;
    horario: string | null;
    agenciaSede: string | null;
  }): string[] {
    if (!b.tipoZona) return ['el distrito o ciudad de entrega'];
    const faltan: string[] = [];
    const pedir = (falta: boolean, que: string) => {
      if (falta) faltan.push(que);
    };

    pedir(!b.nombre, 'nombre completo');
    if (b.tipoZona === ('DOMICILIO' satisfies TipoZona)) {
      pedir(!b.direccion, 'dirección con calle y número');
      pedir(!b.referencia, 'una referencia para ubicar la dirección');
      pedir(!b.horario, 'el horario de entrega');
      // El DNI en Lima es opcional y NO bloquea la venta: lo dice su base de
      // conocimiento.
      pedir(!b.celular, 'celular de contacto');
    } else if (b.tipoZona === ('AGENCIA' satisfies TipoZona)) {
      pedir(!b.dni, 'DNI');
      pedir(!b.agenciaSede, 'la sede de la agencia donde recogerá');
      pedir(!b.celular, 'celular de contacto');
    } else {
      pedir(!b.celular, 'celular de contacto');
    }
    return faltan;
  }

  /**
   * Arma la cotización. Devuelve el texto ya escrito, con el formato exacto
   * que usa el negocio, para que el modelo no lo reinvente cada vez.
   */
  async cotizar(
    empresaId: number,
    conversacionId: number,
    items: ItemPedido[],
    nombrePack?: string,
  ): Promise<{ texto?: string; falta?: string; error?: string }> {
    const config = await this.configDe(empresaId);
    // Lo primero, antes de consultar nada: sin zonas configuradas el costo de
    // envío sería 0 y el total una promesa de envío gratis que nadie hizo.
    if (!tieneEnvioConfigurado(config.envio)) {
      return {
        error:
          'Este negocio todavía no tiene configuradas sus zonas de envío. No armes una cotización: deriva a un asesor para que le confirme el total con el envío.',
      };
    }
    const borrador = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId },
    });
    if (!borrador?.tipoZona || borrador.costoEnvio == null) {
      return {
        falta:
          'Todavía no sé a dónde va el pedido. Pregúntale al cliente para qué distrito o ciudad sería la entrega y guárdalo antes de cotizar.',
      };
    }

    const limpios = items.filter((i) => i.productoId > 0 && i.cantidad > 0);
    if (limpios.length === 0) return { error: 'No hay productos que cotizar.' };

    const productos = await this.prisma.producto.findMany({
      where: {
        empresaId,
        id: { in: limpios.map((i) => i.productoId) },
        estado: 'ACTIVO' as never,
      },
      select: { id: true, descripcion: true, precioUnitario: true },
    });
    if (productos.length === 0) {
      return { error: 'Ninguno de esos productos es de este negocio.' };
    }

    // El precio sale del catálogo, nunca de lo que recuerde el modelo.
    const lineas = limpios
      .map((i) => {
        const p = productos.find((x) => x.id === i.productoId);
        return p
          ? {
              cantidad: i.cantidad,
              nombre: p.descripcion,
              precioUnitario: Number(p.precioUnitario),
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const envio = Number(borrador.costoEnvio);
    const calculo = calcularDescuento(
      lineas.map((l) => ({
        precioUnitario: l.precioUnitario,
        cantidad: l.cantidad,
      })),
      envio,
      config.descuento,
    );

    const texto = this.textoCotizacion(
      lineas,
      borrador.zona ?? '',
      envio,
      calculo,
      nombrePack,
    );

    // UNA cotización por conversación, no una por llamada.
    //
    // El modelo recotiza varias veces en una misma venta: cuando el cliente
    // elige la presentación, cuando da sus datos, y otra vez al confirmar.
    // Medido en el QA del flujo completo: cuatro llamadas en una sola venta.
    // Emitir un documento por cada una llena el panel de cotizaciones de
    // basura, y el vendedor no sabe cuál mirar.
    //
    // Lo que se lleva el cliente al final queda en la nota de venta, que es
    // la que vale; la COT es el borrador que el vendedor ve mientras tanto, y
    // el chat guarda el detalle de cada versión.
    const cot =
      borrador.cotizacionId ??
      (await this.crearCotizacion(empresaId, limpios, borrador.zona));
    await this.prisma.leadPedidoBorrador.update({
      where: { conversacionId },
      data: {
        itemsJson: limpios as unknown as Prisma.InputJsonValue,
        cotizadoEn: new Date(),
        // El descuento que de verdad se le aplicó. El anexo pide el balance de
        // descuentos otorgados: sin guardarlo habría que recalcularlo con las
        // reglas de HOY sobre pedidos viejos, y el número no sería el que el
        // cliente vio.
        descuentoAplicado: calculo.descuento,
        ...(cot ? { cotizacionId: cot } : {}),
      },
    });

    return { texto };
  }

  /** El formato exacto del negocio. Cambiarlo cambia lo que ve el cliente. */
  private textoCotizacion(
    lineas: { cantidad: number; nombre: string; precioUnitario: number }[],
    zona: string,
    envio: number,
    calculo: ReturnType<typeof calcularDescuento>,
    nombrePack?: string,
  ): string {
    const partes: string[] = [];
    partes.push(
      `Te adjunto la Cotización 📋 *${nombrePack?.trim() || 'Tu pedido'}*`,
    );
    for (const l of lineas) {
      partes.push(
        `${l.cantidad}x ${l.nombre} - P.U. ${soles(l.precioUnitario)}`,
      );
    }
    partes.push('Guía de consumo de REGALO 🎁');
    if (envio > 0) partes.push(`Envío ${zona}: ${soles(envio)}`);
    partes.push(`*TOTAL: ${soles(calculo.total)}*`);
    // Sin descuento NO se imprime la línea: lo pide su documento.
    if (calculo.descuento > 0) {
      partes.push(`Descuento: ${soles(calculo.descuento)}`);
      partes.push(`*MONTO A PAGAR: ${soles(calculo.montoAPagar)}*`);
    }
    if (calculo.faltaParaSiguiente) {
      const f = calculo.faltaParaSiguiente;
      partes.push(
        `(Con ${f.unidades} unidad${f.unidades > 1 ? 'es' : ''} más llegarías al descuento de ${soles(f.descuento)}.)`,
      );
    }
    partes.push(
      'Esta sería la cotización completa considerando el envío y el descuento que corresponda. ¿Deseas que agendemos tu entrega?',
    );
    return partes.join('\n');
  }

  /** Borrador de COT en el sistema. Best-effort: no bloquea la cotización. */
  private async crearCotizacion(
    empresaId: number,
    items: ItemPedido[],
    zona: string | null,
  ): Promise<number | null> {
    try {
      const comp = (await this.comprobante.crearInformal(
        {
          tipoDoc: 'COT',
          fechaEmision: new Date().toISOString(),
          formaPagoTipo: 'CONTADO',
          formaPagoMoneda: 'PEN',
          tipoMoneda: 'PEN',
          clienteName: 'CLIENTES VARIOS',
          observaciones: `Cotización de la IA de Ventas por WhatsApp${zona ? ` — ${zona}` : ''}.`,
          detalles: items.map((i) => ({
            productoId: i.productoId,
            cantidad: i.cantidad,
          })),
        },
        empresaId,
      )) as { id?: number };
      return comp?.id ?? null;
    } catch (e) {
      this.logger.warn(
        `No se pudo crear la COT: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Convierte el borrador en un pedido de verdad: nota de venta + despacho.
   *
   * Se niega si falta algo. Es deliberado: el modelo no puede decidir que un
   * pedido está completo, porque entonces diría "ya quedó agendado" con media
   * dirección y el repartidor saldría a ciegas.
   */
  async registrarPedido(
    empresaId: number,
    conversacionId: number,
    telefono: string,
  ): Promise<{
    registrado?: boolean;
    pedido?: string;
    montoAPagar?: number;
    adelanto?: number;
    falta?: string[];
    error?: string;
  }> {
    const borrador = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId },
    });
    if (!borrador) {
      return { error: 'Todavía no hay ningún pedido en curso.' };
    }
    // Idempotencia: por más que el cliente insista, un pedido se registra una
    // vez. El modelo puede llamar dos veces si el cliente repite "ya está".
    if (borrador.comprobanteId) {
      return {
        registrado: true,
        error:
          'Este pedido ya estaba registrado. Dile al cliente el número que ya le diste, no lo registres otra vez.',
      };
    }

    const faltan = this.faltantes(borrador);
    if (faltan.length) return { falta: faltan };

    const items = (borrador.itemsJson ?? []) as unknown as ItemPedido[];
    if (!Array.isArray(items) || items.length === 0) {
      return {
        error:
          'No hay productos confirmados. Cotiza primero y confirma con el cliente qué se lleva.',
      };
    }

    const config = await this.configDe(empresaId);
    const envio = Number(borrador.costoEnvio ?? 0);

    const productos = await this.prisma.producto.findMany({
      where: { empresaId, id: { in: items.map((i) => i.productoId) } },
      select: { id: true, precioUnitario: true },
    });
    const calculo = calcularDescuento(
      items.map((i) => ({
        precioUnitario: Number(
          productos.find((p) => p.id === i.productoId)?.precioUnitario ?? 0,
        ),
        cantidad: i.cantidad,
      })),
      envio,
      config.descuento,
    );

    const esAgencia = borrador.tipoZona === 'AGENCIA';
    // En provincia se adelanta la mitad para reservar; en Lima se paga todo
    // contraentrega.
    const adelanto = esAgencia ? Math.round(calculo.montoAPagar * 50) / 100 : 0;

    // El comprobante necesita un cliente REAL, no un nombre suelto:
    // crearInformal solo resuelve por nombre cuando es exactamente
    // "CLIENTES VARIOS"; con cualquier otro lanza "clienteId es requerido".
    // Como el flujo exige el nombre antes de registrar, pasarlo como texto
    // hacía fallar SIEMPRE el registro del pedido.
    const clienteId = await this.clienteDelPedido(empresaId, borrador, telefono);

    let comprobanteId: number;
    let codigo: string;
    try {
      const nv = (await this.comprobante.crearInformal(
        {
          tipoDoc: 'NV',
          fechaEmision: new Date().toISOString(),
          formaPagoTipo: 'CONTADO',
          formaPagoMoneda: 'PEN',
          tipoMoneda: 'PEN',
          ...(clienteId
            ? { clienteId }
            : { clienteName: 'CLIENTES VARIOS' }),
          observaciones: this.resumenParaElEquipo(
            borrador,
            calculo,
            adelanto,
            telefono,
          ),
          detalles: items.map((i) => ({
            productoId: i.productoId,
            cantidad: i.cantidad,
          })),
        },
        empresaId,
      )) as { id?: number; serie?: string; correlativo?: number };
      if (!nv?.id) return { error: 'No se pudo registrar el pedido.' };
      comprobanteId = nv.id;
      codigo = `${nv.serie}-${String(nv.correlativo).padStart(8, '0')}`;
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      this.logger.error(`Lead: no se pudo crear la NV: ${detalle}`);
      return { error: 'No se pudo registrar el pedido en el sistema.' };
    }

    // El despacho es best-effort: si falla, el pedido YA existe y perderlo
    // sería peor. Queda el aviso para que alguien lo complete a mano.
    try {
      await this.despacho.create(comprobanteId, empresaId, {
        tipoEnvio: (esAgencia ? 'AGENCIA' : 'DOMICILIO') as never,
        ...(borrador.agenciaSede
          ? { agenciaDestino: borrador.agenciaSede }
          : {}),
        ...(borrador.direccion ? { direccionDestino: borrador.direccion } : {}),
        ...(borrador.referencia ? { observaciones: borrador.referencia } : {}),
        ...(borrador.lugar ? { distrito: borrador.lugar } : {}),
        ...(borrador.nombre ? { nombreDestinatario: borrador.nombre } : {}),
        ...(borrador.dni ? { dniDestinatario: borrador.dni } : {}),
        ...(borrador.celular ? { celularDest: borrador.celular } : {}),
        costoEnvio: envio,
        // Lo que queda por cobrar al entregar.
        montoCOD: calculo.montoAPagar - adelanto,
      });
    } catch (e) {
      this.logger.warn(
        `Lead: pedido ${codigo} creado pero sin despacho: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    await this.prisma.leadPedidoBorrador.update({
      where: { conversacionId },
      data: { comprobanteId, registradoEn: new Date() },
    });

    await this.notificaciones
      .notificarAdminsEmpresa({
        empresaId,
        tipo: 'INFO',
        titulo: `🛒 Pedido nuevo por WhatsApp: ${codigo}`,
        mensaje: this.resumenParaElEquipo(
          borrador,
          calculo,
          adelanto,
          telefono,
        ),
        metaData: { origen: 'ia-ventas-pedido', comprobanteId, telefono },
      })
      .catch(() => undefined);

    this.logger.log(
      `Lead: pedido ${codigo} registrado desde el chat (empresa ${empresaId}, conv ${conversacionId}).`,
    );

    return {
      registrado: true,
      pedido: codigo,
      montoAPagar: calculo.montoAPagar,
      ...(adelanto > 0 ? { adelanto } : {}),
    };
  }

  /** El detalle que necesita quien va a despachar, en una sola lectura. */
  private resumenParaElEquipo(
    b: {
      zona: string | null;
      lugar: string | null;
      nombre: string | null;
      dni: string | null;
      celular: string | null;
      direccion: string | null;
      referencia: string | null;
      horario: string | null;
      agenciaSede: string | null;
    },
    calculo: ReturnType<typeof calcularDescuento>,
    adelanto: number,
    telefono: string,
  ): string {
    const l: string[] = [
      `Pedido tomado por la IA de Ventas (WhatsApp ${telefono}).`,
    ];
    if (b.nombre) l.push(`Cliente: ${b.nombre}`);
    if (b.dni) l.push(`DNI: ${b.dni}`);
    if (b.celular) l.push(`Celular: ${b.celular}`);
    if (b.zona) l.push(`Destino: ${b.zona}${b.lugar ? ` — ${b.lugar}` : ''}`);
    if (b.direccion) l.push(`Dirección: ${b.direccion}`);
    if (b.referencia) l.push(`Referencia: ${b.referencia}`);
    if (b.agenciaSede) l.push(`Agencia: ${b.agenciaSede}`);
    if (b.horario) l.push(`Horario: ${b.horario}`);
    l.push(`Envío: ${soles(calculo.envio)}`);
    if (calculo.descuento > 0) l.push(`Descuento: ${soles(calculo.descuento)}`);
    l.push(`Monto a pagar: ${soles(calculo.montoAPagar)}`);
    if (adelanto > 0) {
      l.push(`Adelanto para reservar: ${soles(adelanto)}`);
      l.push(`Saldo al recoger: ${soles(calculo.montoAPagar - adelanto)}`);
    }
    return l.join('\n');
  }
}
