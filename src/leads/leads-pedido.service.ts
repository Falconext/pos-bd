import type { ConfigDemos } from './demos';
import { medioDePago } from './leads-embudo.service';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { disponibilidadEfectiva } from '../producto/disponibilidad.util';
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
import {
  digitosDichosPorElCliente,
  pedirDatoAlCliente,
  textoDichoPorElCliente,
} from './procedencia-datos';

/** Lo que cada empresa configura de su operación comercial. */
export interface ConfigComercial {
  envio: ConfigEnvio;
  horario: ConfigHorarioEntrega;
  descuento: ReglasDescuento;
  /** Nombre con el que se presenta quien atiende ("Claudio" en Hierba Sana). */
  asesor?: string;
  /** Video que se manda una vez, tras la primera respuesta (Krezka). */
  videoBienvenidaUrl?: string;
  /**
   * Texto fijo al pie de toda recomendación de producto. El anexo lo exige
   * "fijo e invariable", por eso lo pone el código y no el modelo.
   */
  descargoLegal?: string;
  /**
   * Cómo cobra el negocio cuando hay adelanto, tal como se le dice al
   * cliente ("Yape: 955 947 892 · BCP: …"). Es dato de cada empresa, no del
   * sistema: los de una no pueden salir en el chat de otra.
   */
  mediosPago?: string;
  /**
   * Quién atiende las derivaciones, para avisarle por WhatsApp apenas la IA
   * se calla. Si no está, se avisa a los administradores de la empresa.
   */
  supervisorTelefono?: string;
  /**
   * Números del propio negocio que prueban el bot. La IA les responde, pero
   * no entran al embudo: ver `numeros-internos.ts`. Los celulares de los
   * administradores se agregan solos; esta lista es para el resto.
   */
  numerosInternos?: string[];
  /** Demos por rubro que la IA entrega (Krezka). Ver `demos.ts`. */
  demos?: ConfigDemos;
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
  /** Vuelto, piso, timbre: lo que el motorizado tiene que saber. */
  notaEntrega?: string;
  /**
   * Sexo y edad del cliente. NO son datos de entrega y nunca se le piden:
   * solo se anotan si los dice (la edad suele salir al hablar de la dosis).
   * El anexo pide un reporte demográfico, y la alternativa a esto sería
   * adivinarlo por el nombre, que es como se arma un dato falso.
   */
  sexo?: string;
  edad?: number | string;
  /**
   * Lo que le pasa al cliente, en sus palabras. El negocio lo necesita para
   * armar la guía de consumo personalizada que entrega tras agendar.
   */
  sintomas?: string;
}

export interface ItemPedido {
  productoId: number;
  cantidad: number;
  /** Lo que el modelo cree que está cotizando; sirve para corregir un id malo. */
  nombre?: string;
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
      ...(guardada.videoBienvenidaUrl
        ? { videoBienvenidaUrl: guardada.videoBienvenidaUrl }
        : {}),
      ...(guardada.mediosPago ? { mediosPago: guardada.mediosPago } : {}),
      ...(guardada.descargoLegal
        ? { descargoLegal: guardada.descargoLegal }
        : {}),
      ...(guardada.supervisorTelefono
        ? { supervisorTelefono: guardada.supervisorTelefono }
        : {}),
      ...(Array.isArray(guardada.numerosInternos)
        ? { numerosInternos: guardada.numerosInternos }
        : {}),
      ...(Array.isArray(guardada.demos?.cuentas) && guardada.demos?.enlace
        ? { demos: guardada.demos }
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
    /** Correcciones que conviene confirmarle al cliente sin detener el pedido. */
    confirmar?: string[];
    pedirTodoJunto?: string;
  }> {
    const config = await this.configDe(empresaId);
    const cambios: Prisma.LeadPedidoBorradorUncheckedUpdateInput = {};
    const guardado: string[] = [];
    const problemas: string[] = [];
    // Cosas que el modelo tiene que decirle al cliente sin frenar el pedido,
    // a diferencia de `aclarar`, que sí lo detiene.
    const aclaraciones: string[] = [];

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
        // Se reconoció corrigiendo lo que vino escrito. Se le confirma al
        // cliente en la misma respuesta: la zona decide la tarifa y la forma
        // de pago, y un distrito mal leído se descubre con el repartidor ya
        // en la calle.
        if (resuelto.aproximado && resuelto.lugar) {
          aclaraciones.push(
            `Entendí "${datos.destino.trim()}" como ${resuelto.lugar}. Confírmaselo al cliente de pasada en tu respuesta ("te confirmo, la entrega es en ${resuelto.lugar}, ¿correcto?") y sigue con el pedido sin frenarte.`,
          );
        }
      }
    }

    // Lo que el cliente escribió en esta conversación. Es contra esto que se
    // comprueba que un dato de contacto exista de verdad: ver
    // `procedencia-datos.ts` para el incidente que lo hizo necesario.
    const dichoPorElCliente = await this.mensajesDelCliente(conversacionId);
    // Vacío solo puede ser un fallo de lectura: el modelo nunca guarda datos
    // antes de que el cliente escriba. En ese caso no se comprueba nada, que
    // es dejar las cosas como estaban, no romper la venta.
    const comprobar = dichoPorElCliente.length > 0;

    // El DNI y el celular se validan al entrar: un celular mal escrito es un
    // pedido que no se puede entregar, y eso se descubre con el repartidor ya
    // en la calle. Un celular INVENTADO es lo mismo pero peor, porque pasa
    // todas las validaciones de formato: por eso además se exige que el
    // número aparezca en algún mensaje del cliente.
    if (datos.dni?.trim()) {
      const problema = validarDni(datos.dni);
      if (problema) problemas.push(problema.detalle);
      else if (
        comprobar &&
        !digitosDichosPorElCliente(datos.dni, dichoPorElCliente)
      ) {
        problemas.push(pedirDatoAlCliente('DNI'));
      } else {
        cambios.dni = datos.dni.replace(/\D/g, '');
        guardado.push('DNI');
      }
    }
    if (datos.celular?.trim()) {
      const problema = validarCelular(datos.celular);
      if (problema) problemas.push(problema.detalle);
      else if (
        comprobar &&
        !digitosDichosPorElCliente(datos.celular, dichoPorElCliente)
      ) {
        problemas.push(pedirDatoAlCliente('celular'));
      } else {
        cambios.celular = normalizarCelular(datos.celular);
        guardado.push('celular');
      }
    }

    // La dirección también tiene que haber salido del cliente: el agente no
    // la puede ofrecer de una lista, así que si no está en lo que escribió,
    // la escribió el modelo. La sede de la agencia y el nombre NO se
    // comprueban a propósito —el agente ofrece la sede del catálogo y el
    // cliente contesta "sí, esa"—, ver `procedencia-datos.ts`.
    if (
      comprobar &&
      datos.direccion?.trim() &&
      !textoDichoPorElCliente(datos.direccion, dichoPorElCliente)
    ) {
      problemas.push(pedirDatoAlCliente('dirección'));
      delete datos.direccion;
    }

    for (const campo of [
      'nombre',
      'direccion',
      'referencia',
      'horario',
      'agenciaSede',
      'recibeNombre',
      'notaEntrega',
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
      ...conBloqueDeDatos(this.faltantes(borrador)),
      ...(problemas.length ? { problemas } : {}),
      ...(aclaraciones.length ? { confirmar: aclaraciones } : {}),
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
    const cambios: { sexo?: string; edad?: number; sintomas?: string } = {};

    const sexo = String(datos.sexo ?? '').trim().toUpperCase();
    if (sexo) {
      // Se normaliza a M/F: el modelo manda "masculino", "hombre", "varón"…
      if (/^(M|MASC|MASCULINO|HOMBRE|VARON|VARÓN)$/.test(sexo)) cambios.sexo = 'M';
      else if (/^(F|FEM|FEMENINO|MUJER|DAMA)$/.test(sexo)) cambios.sexo = 'F';
    }

    const sintomas = String(datos.sintomas ?? '').trim();
    const edad = Math.trunc(Number(datos.edad));
    // Fuera de este rango es un error de lectura, no una edad: guardarlo
    // ensuciaría el reporte sin que nadie lo note.
    if (Number.isFinite(edad) && edad >= 1 && edad <= 110) cambios.edad = edad;
    // Los síntomas van a su propio campo y NO a `resumen`: ese lo reescribe el
    // análisis BANT en cada mensaje (`leads-message.processor.ts`), así que lo
    // que se guardara ahí duraba hasta el mensaje siguiente. Pasó en
    // producción: la guía de consumo de un cliente con acidez terminó armada
    // con "eligió el producto X y ya envió el comprobante".
    if (sintomas.length >= 4) cambios.sintomas = sintomas.slice(0, 400);

    if (!Object.keys(cambios).length) return;
    try {
      await this.prisma.leadProspecto.updateMany({
        where: { conversacionId, empresaId },
        data: cambios,
      });
      if (cambios.sexo) guardado.push('sexo');
      if (cambios.edad) guardado.push('edad');
      if (cambios.sintomas) guardado.push('síntomas');
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
  private async tipoDocumentoId(codigo: string): Promise<number | null> {
    const t = await this.prisma.tipoDocumento
      .findFirst({ where: { codigo }, select: { id: true } })
      .catch(() => null);
    return t?.id ?? null;
  }

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

      // Por celular solo si es la MISMA persona. Un celular lo comparten
      // familias, y el 20-10 un "Diego Ortega Roldan" que dio el DNI 47065472
      // salió en la nota como "Diego Ortega Ramos" con el DNI 45879632: otro
      // cliente con ese celular. Si dio DNI y no coincide, tampoco es él.
      if (celular) {
        const conEseCelular = await this.prisma.cliente.findMany({
          where: { empresaId, telefono: celular, estado: 'ACTIVO' as never },
          select: { id: true, nombre: true, nroDoc: true },
          take: 10,
        });
        // Ficha sin documento real: "0" o, en las viejas, el celular.
        const sinDoc = (doc: string | null) => !doc || doc === '0' || doc === celular;
        const mismo = conEseCelular.find(
          (c) =>
            (!nombre || mismaPersona(c.nombre ?? '', nombre)) &&
            (!dni || c.nroDoc === dni || sinDoc(c.nroDoc)),
        );
        if (mismo) {
          // Ahora sí dio su DNI: queda guardado en su ficha.
          if (dni && sinDoc(mismo.nroDoc)) {
            const tipoDni = await this.tipoDocumentoId('1');
            await this.prisma.cliente
              .update({
                where: { id: mismo.id },
                data: { nroDoc: dni, ...(tipoDni ? { tipoDocumentoId: tipoDni } : {}) },
              })
              .catch(() => undefined);
          }
          return mismo.id;
        }
      }

      if (!nombre) return null;

      // Sin DNI el documento es "0" (Catálogo 06: sin documento). Antes se
      // ponía el celular y en la nota parecía un número de documento que el
      // cliente nunca dio (20-10). En Lima el DNI no se pide.
      const tipoDoc = await this.tipoDocumentoId(dni ? '1' : '0');
      const creado = await this.prisma.cliente.create({
        data: {
          empresaId,
          nombre: nombre.toUpperCase(),
          nroDoc: dni || '0',
          ...(tipoDoc ? { tipoDocumentoId: tipoDoc } : {}),
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
   * Todo lo que el cliente escribió en esta conversación.
   *
   * Incluye el mensaje que acaba de llegar: el processor lo persiste antes de
   * llamar al modelo, así que un dato que el cliente dictó recién ya está
   * acá y no se rechaza por llegar en el mismo turno.
   *
   * Si la lectura falla se devuelve vacío y los datos pasan sin comprobar.
   * Es a propósito: este control existe para que no entre un dato falso, no
   * para frenar las ventas de todos si la consulta se cae. Queda el log.
   */
  private async mensajesDelCliente(conversacionId: number): Promise<string[]> {
    try {
      const mensajes = await this.prisma.leadMensaje.findMany({
        where: { conversacionId, rol: 'USUARIO' },
        select: { contenido: true },
        orderBy: { id: 'desc' },
        take: 60,
      });
      return mensajes.map((m) => m.contenido);
    } catch (e) {
      this.logger.warn(
        `Lead: no se pudieron leer los mensajes de la conv ${conversacionId} para comprobar la procedencia de los datos: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return [];
    }
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

    // Nombre Y apellido: con "Diego" solo, la nota sale a nombre de nadie.
    pedir(
      !b.nombre || b.nombre.trim().split(/\s+/).filter((w) => w.length > 1).length < 2,
      'nombre completo',
    );
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
    } else if (b.tipoZona !== ('RECOJO' satisfies TipoZona)) {
      pedir(!b.celular, 'celular de contacto');
    }
    // En un recojo basta el nombre: el celular es el WhatsApp por el que
    // escribe, y pedirlo frenaba la nota del recojo (20-10).
    return faltan;
  }

  /**
   * Arma la cotización. Devuelve el texto ya escrito, con el formato exacto
   * que usa el negocio, para que el modelo no lo reinvente cada vez.
   */
  /**
   * ¿El pedido registrado en esta conversación ya terminó? Entregado, pagado
   * del todo o anulado: lo que venga después es otra compra.
   */
  private async pedidoCerrado(comprobanteId: number): Promise<boolean> {
    // Si la consulta falla, el pedido se da por EN CURSO: abrir uno nuevo
    // por error duplicaría una venta, que es peor que no abrirlo.
    let nota;
    try {
      nota = await this.prisma.comprobante?.findUnique({
        where: { id: comprobanteId },
        select: {
          estadoPago: true,
          estadoEnvioSunat: true,
          envioDespacho: { select: { estado: true } },
        },
      });
    } catch {
      return false;
    }
    // La nota ya no existe (la borraron): ese pedido terminó. Antes contaba
    // como "en curso" y el chat quedaba atado a una nota fantasma: el bot
    // decía "tu pedido quedó registrado" sin que hubiera nada (20-10).
    if (nota === null) return true;
    if (!nota) return false;
    return (
      String(nota.estadoEnvioSunat) === 'ANULADO' ||
      String(nota.estadoPago) === 'COMPLETADO' ||
      String(nota.estadoPago) === 'ANULADO' ||
      nota.envioDespacho?.estado === 'ENTREGADO'
    );
  }

  /**
   * El id lo escribe el modelo y a veces lo escribe mal (20-10: la copaiba
   * salió con 3844 en vez de 31000). El nombre lo copia del resultado de la
   * búsqueda y casi nunca falla. Si el id no es de un producto activo de
   * este negocio, se busca el producto por su nombre en el catálogo; solo se
   * corrige con una coincidencia única. Si no, el id queda como vino y
   * `cotizar` lo rechaza.
   */
  private async conIdDelCatalogo(
    empresaId: number,
    items: ItemPedido[],
  ): Promise<ItemPedido[]> {
    const ids = items.map((i) => i.productoId).filter((id) => id > 0);
    const validos = new Map<number, string>(
      (
        await this.prisma.producto.findMany({
          where: { empresaId, id: { in: ids }, estado: 'ACTIVO' as never },
          select: { id: true, descripcion: true },
        })
      ).map((p: { id: number; descripcion?: string }) => [p.id, p.descripcion ?? '']),
    );
    const igual = (a: string, b: string) =>
      a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
    const salida: ItemPedido[] = [];
    for (const item of items) {
      const nombre = item.nombre?.trim();
      // Un id válido pero de OTRO producto también es un error (20-10: el
      // aceite de almendra GERWILL de S/ 5 salió como el ARTESANAL de S/ 15).
      // Manda el nombre, que es lo que el modelo le ofreció al cliente.
      const descripcion = validos.get(item.productoId);
      if (!nombre || (descripcion !== undefined && (!descripcion || igual(descripcion, nombre)))) {
        salida.push(item);
        continue;
      }
      const porNombre = await this.prisma.producto.findMany({
        where: {
          empresaId,
          estado: 'ACTIVO' as never,
          descripcion: { equals: nombre, mode: 'insensitive' },
        },
        select: { id: true },
        take: 2,
      });
      if (porNombre.length === 1) {
        this.logger.warn(
          `Lead: cotizar recibió el id ${item.productoId} para "${nombre}"; se usa ${porNombre[0].id} del catálogo.`,
        );
        salida.push({ ...item, productoId: porNombre[0].id });
      } else {
        salida.push(item);
      }
    }
    return salida;
  }

  /**
   * Lo que hay que saber del pedido en curso para este turno: qué se cotizó
   * (para recotizar si el cliente cambia algo) y el bloque de datos que
   * faltan. null si no hay pedido abierto.
   */
  async estadoParaElTurno(conversacionId: number): Promise<{
    cotizado: string | null;
    tipoZona: string | null;
    faltan: string[];
    pedirTodoJunto?: string;
  } | null> {
    try {
      const b = await this.prisma.leadPedidoBorrador.findUnique({
        where: { conversacionId },
      });
      if (!b || b.comprobanteId) return null;
      const items = normalizarItems(b.itemsJson);
      let cotizado: string | null = null;
      if (b.cotizadoEn && items.length) {
        const productos = await this.prisma.producto.findMany({
          where: { id: { in: items.map((i) => i.productoId) } },
          select: { id: true, descripcion: true },
        });
        cotizado = items
          .map(
            (i) =>
              `${i.cantidad}x ${productos.find((p) => p.id === i.productoId)?.descripcion ?? `producto ${i.productoId}`} (id ${i.productoId})`,
          )
          .join('; ');
      }
      const faltan = this.faltantes(b);
      return { cotizado, tipoZona: b.tipoZona, faltan, ...conBloqueDeDatos(faltan) };
    } catch {
      return null;
    }
  }

  /** ¿La nota existió y ya no está? Ante un error de consulta, no. */
  private async notaBorrada(comprobanteId: number): Promise<boolean> {
    try {
      const nota = await this.prisma.comprobante?.findUnique({
        where: { id: comprobanteId },
        select: { id: true },
      });
      return nota === null;
    } catch {
      return false;
    }
  }

  /**
   * Abre un pedido nuevo en la misma conversación. Se quedan los datos de
   * quien recibe (dirección, DNI, zona): el cliente dice "a la misma
   * dirección" y no hay que volver a pedírselos. Se va lo del pedido: los
   * productos, la cotización, la franja horaria y el número de nota.
   *
   * El embudo vuelve a NUEVO: desde ENTREGADO un automatismo no puede
   * avanzar (es terminal), y el segundo pedido quedaba invisible.
   */
  private async abrirPedidoNuevo(
    empresaId: number,
    conversacionId: number,
    opciones: { sinDestino?: boolean } = {},
  ) {
    const borrador = await this.prisma.leadPedidoBorrador.update({
      where: { conversacionId },
      data: {
        // Pedido aparte con el anterior todavía abierto: suele ir a otro lugar
        // y a otra persona ("le mando uno a mi mamá a Arequipa"). Heredar la
        // dirección del primero cotizaba el envío equivocado.
        ...(opciones.sinDestino
          ? {
              zona: null,
              tipoZona: null,
              lugar: null,
              destinoRegion: null,
              costoEnvio: null,
              direccion: null,
              referencia: null,
              agenciaSede: null,
              recibeNombre: null,
              recibeDni: null,
            }
          : {}),
        comprobanteId: null,
        registradoEn: null,
        cotizacionId: null,
        cotizadoEn: null,
        itemsJson: Prisma.DbNull,
        descuentoAplicado: null,
        horario: null,
        notaEntrega: null,
        pedidoDesde: new Date(),
      },
    });
    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { conversacionId, empresaId },
      select: { id: true, etapa: true },
    });
    if (prospecto && prospecto.etapa !== 'NUEVO') {
      await this.prisma.$transaction([
        this.prisma.leadProspecto.update({
          where: { id: prospecto.id },
          data: { etapa: 'NUEVO' as never, etapaEn: new Date() },
        }),
        this.prisma.leadEtapaHistorial.create({
          data: {
            prospectoId: prospecto.id,
            empresaId,
            desde: prospecto.etapa as never,
            hacia: 'NUEVO' as never,
            actor: 'bot',
            nota: 'Cliente que vuelve: pedido nuevo',
          },
        }),
      ]);
    }
    this.logger.log(
      `Lead: conv ${conversacionId} abre un pedido nuevo (el anterior ya se cerró).`,
    );
    return borrador;
  }

  /** ¿Hay algún voucher leído (con monto) para el pedido en curso? */
  async hayVoucherLeido(conversacionId: number): Promise<boolean> {
    const { monto } = await this.pagadoPorElCliente(
      conversacionId,
      Number.MAX_SAFE_INTEGER,
    );
    return monto > 0;
  }

  /**
   * El cliente pide OTRO pedido aparte del que ya tiene registrado y abierto.
   * El registrado queda tal cual y se empieza uno nuevo sin su destino.
   *
   * QA 21-10: "mándale uno a mi mamá a Arequipa, aparte de mi pedido" cotizó
   * sobre el pedido registrado y la NV01-00000002 pasó de S/ 77 (2 frascos a
   * Surco) a S/ 46 (1 frasco a Arequipa). El borrador es uno por
   * conversación, así que recotizar era editar la nota del primero.
   */
  async separarPedidoSiCorresponde(
    empresaId: number,
    conversacionId: number,
    pedidoAparte: unknown,
  ): Promise<boolean> {
    if (pedidoAparte !== true) return false;
    const b = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId },
      select: { comprobanteId: true },
    });
    if (!b?.comprobanteId) return false;
    await this.abrirPedidoNuevo(empresaId, conversacionId, { sinDestino: true });
    return true;
  }

  async cotizar(
    empresaId: number,
    conversacionId: number,
    items: ItemPedido[],
    nombrePack?: string,
  ): Promise<{
    texto?: string;
    falta?: string;
    error?: string;
    pedirTodoJunto?: string;
    bajoReserva?: string;
  }> {
    const config = await this.configDe(empresaId);
    // Lo primero, antes de consultar nada: sin zonas configuradas el costo de
    // envío sería 0 y el total una promesa de envío gratis que nadie hizo.
    if (!tieneEnvioConfigurado(config.envio)) {
      return {
        error:
          'Este negocio todavía no tiene configuradas sus zonas de envío. No armes una cotización: deriva a un asesor para que le confirme el total con el envío.',
      };
    }
    let borrador = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId },
    });
    // Cliente que vuelve: su pedido anterior ya se cerró y esto es una compra
    // nueva. Sin esto, registrar_pedido contestaba "ya estaba registrado" (el
    // borrador es uno por conversación) y el modelo le decía al cliente que
    // su segundo pedido había quedado registrado sin que existiera (19-10).
    if (borrador?.comprobanteId && (await this.pedidoCerrado(borrador.comprobanteId))) {
      borrador = await this.abrirPedidoNuevo(empresaId, conversacionId);
    }
    if (!borrador?.tipoZona || borrador.costoEnvio == null) {
      return {
        falta:
          'Todavía no sé a dónde va el pedido. Pregúntale al cliente para qué distrito o ciudad sería la entrega y guárdalo antes de cotizar.',
      };
    }

    const limpios = (
      await this.conIdDelCatalogo(
        empresaId,
        items.filter((i) => i.cantidad > 0),
      )
    )
      .filter((i) => i.productoId > 0)
      // Solo id y cantidad: es lo que se guarda y lo que lee registrar.
      .map((i) => ({ productoId: i.productoId, cantidad: i.cantidad }));
    if (limpios.length === 0) return { error: 'No hay productos que cotizar.' };

    const productos = await this.prisma.producto.findMany({
      where: {
        empresaId,
        id: { in: limpios.map((i) => i.productoId) },
        estado: 'ACTIVO' as never,
      },
      select: {
        id: true,
        descripcion: true,
        precioUnitario: true,
        disponibilidad: true,
        stock: true,
      },
    });
    if (productos.length === 0) {
      return { error: 'Ninguno de esos productos es de este negocio.' };
    }
    // Un id que no existe NO se salta en silencio. Pasó en vivo el 20-10: el
    // modelo mandó la copaiba con un id inventado, la cotización salió solo
    // con la uña de gato, el modelo escribió por su cuenta otra con las dos,
    // y registrar_pedido falló porque el id malo quedó guardado.
    const desconocidos = limpios
      .filter((i) => !productos.some((p) => p.id === i.productoId))
      .map((i) => i.productoId);
    if (desconocidos.length) {
      return {
        error: `El id ${desconocidos.join(', ')} no es un producto de este negocio. Busca de nuevo ese producto con buscar_productos, usa el id EXACTO que te devuelve y vuelve a llamar a cotizar con todos los productos. No escribas tú la cotización.`,
      };
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

    // "Envío Callao", no "Envío Lima": el cliente reconoce su distrito. Solo
    // si es un nombre de lugar; si quedó guardada una dirección entera, la zona.
    const lugarCorto =
      borrador.lugar && borrador.lugar.length <= 30 && !/\d/.test(borrador.lugar)
        ? borrador.lugar
        : null;
    const texto = this.textoCotizacion(
      lineas,
      lugarCorto ?? borrador.zona ?? '',
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
    //
    // Pero si el cliente cambió lo que lleva, la COT del panel tiene que
    // decir lo nuevo (20-10: quitó y agregó productos y el panel seguía con
    // la primera versión). Se reemplaza: sigue habiendo una sola.
    const mismosItems =
      JSON.stringify(normalizarItems(borrador.itemsJson)) ===
      JSON.stringify(normalizarItems(limpios));
    let cot = borrador.cotizacionId;
    if (cot && !mismosItems) {
      await this.comprobante
        .eliminarCotizacion(cot, empresaId)
        .catch((e: unknown) =>
          this.logger.warn(
            `No se pudo reemplazar la COT ${cot}: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      cot = null;
    }
    cot ??= await this.crearCotizacion(empresaId, limpios, resumenCotizacion(texto));
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

    // Pedido ya registrado y el cliente cambió lo que lleva: la nota de venta
    // y lo que cobra el despacho tienen que seguir a la cotización. 20-10:
    // pasó de 1 a 2 inka muña después de registrar, el bot dijo "pedido
    // actualizado" y la nota siguió en S/ 24 en vez de S/ 31.
    const nota =
      borrador.comprobanteId && !mismosItems
        ? await this.actualizarNotaRegistrada(
            empresaId,
            conversacionId,
            borrador.comprobanteId,
            borrador,
            limpios,
            productos,
            calculo,
            envio,
          )
        : {};

    const reserva = this.avisoBajoReserva(productos);
    // El bloque para pedir los datos que faltan, listo para cuando acepte.
    return {
      texto,
      ...nota,
      ...(reserva ? { bajoReserva: reserva } : {}),
      ...conBloqueDeDatos(this.faltantes(borrador)),
    };
  }

  /**
   * Edita la nota de venta de un pedido ya registrado con los ítems nuevos.
   * Lo ya pagado se conserva como adelanto; el saldo y el `montoCOD` del
   * despacho pasan a ser el total nuevo menos eso. Si no se puede, se le
   * dice al modelo que NO confirme el cambio.
   */
  private async actualizarNotaRegistrada(
    empresaId: number,
    conversacionId: number,
    comprobanteId: number,
    borrador: Parameters<LeadsPedidoService['resumenParaElEquipo']>[1],
    items: ItemPedido[],
    productos: { id: number; precioUnitario: unknown }[],
    calculo: ReturnType<typeof calcularDescuento>,
    envio: number,
  ): Promise<{ pedidoActualizado?: string; porCobrar?: number; aviso?: string }> {
    const noSePudo = {
      aviso:
        'El pedido ya estaba registrado y su nota de venta NO se pudo actualizar con este cambio. No le digas que el pedido quedó actualizado: dile que un asesor del equipo ajusta su pedido y le confirma el nuevo total.',
    };
    try {
      const pagos = await this.prisma.pago.findMany({
        where: { comprobanteId },
        select: { monto: true, medioPago: true },
      });
      const pagado =
        Math.round(pagos.reduce((a, p) => a + Number(p.monto), 0) * 100) / 100;
      const porCobrar = Math.round((calculo.montoAPagar - pagado) * 100) / 100;
      // Pagó más que el total nuevo: devolver plata lo decide una persona.
      if (porCobrar < 0) return noSePudo;

      const conv = await this.prisma.leadConversacion.findUnique({
        where: { id: conversacionId },
        select: { telefonoProspecto: true },
      });
      const perfil = await this.prisma.leadProspecto
        .findFirst({
          where: { conversacionId, empresaId },
          select: { sexo: true, edad: true, sintomas: true },
        })
        .catch(() => null);
      const esAgencia = (borrador as { tipoZona?: string | null }).tipoZona === 'AGENCIA';
      const nv = (await this.comprobante.editarNotaVenta(
        comprobanteId,
        {
          formaPagoTipo: porCobrar > 0 ? 'CREDITO' : 'CONTADO',
          // Lo cobrado se vuelve a registrar igual (editarNotaVenta reemplaza
          // los pagos con lo que se le pasa).
          ...(pagado > 0
            ? {
                adelanto: pagado,
                medioPago: pagos[0].medioPago,
                paymentDetails: { amount: pagado },
              }
            : {}),
          observaciones: this.resumenParaElEquipo(
            perfil,
            borrador,
            calculo,
            pagado,
            conv?.telefonoProspecto ?? '',
          ),
          detalles: this.lineasDelComprobante(
            items,
            productos,
            calculo,
            envio,
            esAgencia ? `ENVÍO ${borrador.lugar ?? borrador.zona ?? ''} (agencia)` : 'ENVÍO DELIVERY',
          ),
        },
        empresaId,
      )) as { serie?: string; correlativo?: number } | null;
      await this.prisma.envioDespacho.updateMany({
        where: { comprobanteId },
        data: { montoCOD: porCobrar },
      });
      const codigo = nv?.serie
        ? `${nv.serie}-${String(nv.correlativo).padStart(8, '0')}`
        : `nota ${comprobanteId}`;
      this.logger.log(
        `Lead: conv ${conversacionId} cambió su pedido registrado; ${codigo} actualizada a S/ ${calculo.montoAPagar.toFixed(2)}.`,
      );
      return { pedidoActualizado: codigo, porCobrar };
    } catch (e) {
      this.logger.warn(
        `Lead: no se pudo actualizar la nota ${comprobanteId} tras recotizar: ${e instanceof Error ? e.message : String(e)}`,
      );
      return noSePudo;
    }
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
    resumen: string,
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
          // Lo mismo que leyó el cliente: el envío no es un ítem de la COT y
          // sin esto el vendedor no ve cuánto se le cobró.
          observaciones: resumen,
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
    pedirTodoJunto?: string;
    error?: string;
  }> {
    const borrador = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId },
    });
    if (!borrador) {
      return { error: 'Todavía no hay ningún pedido en curso.' };
    }
    // La nota del pedido ya no existe: se registra este como si nada. Sin
    // esto el bot respondía "ya estaba registrado" y el cliente se iba
    // creyendo que tenía un pedido.
    if (borrador.comprobanteId && (await this.notaBorrada(borrador.comprobanteId))) {
      await this.prisma.leadPedidoBorrador.update({
        where: { conversacionId },
        data: { comprobanteId: null, registradoEn: null },
      });
      borrador.comprobanteId = null;
    }
    // El pedido anterior ya se cerró y no hay cotización nueva: no se
    // registra de nuevo lo viejo ni se le dice "ya estaba registrado".
    if (borrador.comprobanteId && (await this.pedidoCerrado(borrador.comprobanteId))) {
      return {
        falta: ['los productos de este nuevo pedido: cotízalos primero'],
      };
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
    if (faltan.length) return { falta: faltan, ...conBloqueDeDatos(faltan) };

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
      select: {
        id: true,
        descripcion: true,
        precioUnitario: true,
        disponibilidad: true,
        stock: true,
      },
    });
    // Un pedido cotizado con un id que no existe no se puede registrar:
    // crearInformal lanza "Productos no encontrados" y al cliente le llegaba
    // "tengo un inconveniente temporal". Se pide recotizar en vez de fallar.
    if (items.some((i) => !productos.some((p) => p.id === i.productoId))) {
      // `error` y no `falta`: lo de `falta` se le lee al cliente tal cual.
      return {
        error:
          'Uno de los productos cotizados no está en el catálogo, así que el pedido NO se registró. Búscalo con buscar_productos, vuelve a cotizar con el id exacto y muéstrale al cliente la cotización nueva antes de registrar.',
      };
    }
    const sinPagoDeReserva = await this.faltaPagoDeReserva(
      conversacionId,
      productos,
    );
    if (sinPagoDeReserva) return { error: sinPagoDeReserva };
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
    const esRecojo = borrador.tipoZona === 'RECOJO';
    // Lo que el cliente YA pagó, venga de donde venga.
    //
    // Antes esto era `esAgencia ? mitad : 0`: el 50% que se le PIDE en
    // provincia, no lo que de verdad entró. En Lima el adelanto se perdía
    // entero —el NV01-00000008 nació "pagado" con saldo 0 cuando el cliente
    // había yapeado S/ 20 de S/ 46— y en provincia se daba por cobrada la
    // mitad aunque no hubiera llegado nada.
    //
    // La regla la fijó el negocio: cualquier pago realizado queda como
    // adelanto y el resto figura como saldo por pagar, sea Lima, provincia o
    // reserva. Así el pedido nace con lo que falta cobrar, y "pago completado"
    // pasa a ser un hecho aparte —cuando el repartidor entrega la plata— que
    // marca `actualizarSaldo`.
    const { monto: adelanto, medio: medioDelAdelanto } =
      await this.pagadoPorElCliente(conversacionId, calculo.montoAPagar);
    /** Lo que el repartidor o la agencia le cobran al cliente al entregar. */
    const porCobrar = calculo.montoAPagar - adelanto;

    // El comprobante necesita un cliente REAL, no un nombre suelto:
    // crearInformal solo resuelve por nombre cuando es exactamente
    // "CLIENTES VARIOS"; con cualquier otro lanza "clienteId es requerido".
    // Como el flujo exige el nombre antes de registrar, pasarlo como texto
    // hacía fallar SIEMPRE el registro del pedido.
    const clienteId = await this.clienteDelPedido(empresaId, borrador, telefono);
    // El perfil va en el resumen para que el negocio pueda armar la guía de
    // consumo personalizada sin volver a leer toda la conversación.
    // Es dato decorativo del resumen: si no se puede leer, la venta se
    // registra igual. Un try/catch y no `.catch()` porque el acceso mismo
    // puede fallar, no solo la promesa.
    let perfil: {
      sexo: string | null;
      edad: number | null;
      sintomas: string | null;
    } | null = null;
    try {
      perfil = await this.prisma.leadProspecto.findFirst({
        where: { conversacionId, empresaId },
        select: { sexo: true, edad: true, sintomas: true },
      });
    } catch {
      perfil = null;
    }

    let comprobanteId: number;
    let codigo: string;
    try {
      const nv = (await this.comprobante.crearInformal(
        {
          tipoDoc: 'NV',
          fechaEmision: new Date().toISOString(),
          // Con saldo por cobrar la nota nace PENDIENTE, no "contado".
          //
          // Esto faltaba y se vio en la segunda prueba (NV01-00000009): el
          // adelanto ya se pasaba, pero cuando el cliente no había pagado
          // NADA —el caso normal en Lima contraentrega— no había adelanto que
          // pasar, el comprobante caía en contado y nacía COMPLETADO con
          // saldo 0. Quedaba contradiciendo a su propio despacho, que decía
          // CONTRAENTREGA con S/ 45 por cobrar.
          //
          // 'CREDITO' acá significa "se cobra después", no una venta al
          // crédito: es lo que `crearInformal` mira para dejar el saldo
          // pendiente. Si hubo adelanto, ese camino gana igual y la nota sale
          // PAGO_PARCIAL; si no quedó nada por cobrar, sale saldada.
          formaPagoTipo: porCobrar > 0 ? 'CREDITO' : 'CONTADO',
          formaPagoMoneda: 'PEN',
          tipoMoneda: 'PEN',
          // En provincia el cliente adelanta la mitad y paga el resto al
          // recoger. Sin pasar el adelanto, `crearInformal` cae en "contado"
          // y la nota nace COMPLETADO con saldo 0: el sistema daba por
          // cobrados los S/ 270 cuando en la cuenta había S/ 135, y el saldo
          // que se cobra en la agencia no quedaba registrado en ninguna
          // parte. Pasándolo, la nota nace PAGO_PARCIAL con su saldo y a
          // caja entra solo lo que de verdad entró.
          // Con el medio del voucher: sin él la nota decía EFECTIVO aunque el
          // adelanto entrara por Yape (20-10).
          ...(adelanto > 0 ? { adelanto, medioPago: medioDelAdelanto } : {}),
          ...(clienteId
            ? { clienteId }
            : { clienteName: 'CLIENTES VARIOS' }),
          observaciones: this.resumenParaElEquipo(
            perfil,
            borrador,
            calculo,
            adelanto,
            telefono,
          ),
          detalles: this.lineasDelComprobante(
            items,
            productos,
            calculo,
            envio,
            esAgencia ? `ENVÍO ${borrador.lugar ?? borrador.zona ?? ''} (agencia)` : 'ENVÍO DELIVERY',
          ),
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

    // Un recojo en tienda NO genera despacho: no hay nada que transportar.
    // Antes caía en el `else` y se creaba un despacho DOMICILIO sin dirección
    // y con el courier de la zona, así que el panel ofrecía "Coordinar envío"
    // para un paquete que el cliente venía a buscar él mismo. El pedido se ve
    // igual en ventas, y que viene a la tienda lo avisa `avisarVisitaTienda`.
    //
    // Tampoco se le inventa un `tipoEnvio: 'RECOJO'`: el modal del panel pide
    // transportista, agencia, turno y fecha de despacho —nada de eso existe
    // en un recojo— y un valor que no sabe tratar le deja el formulario en
    // error al que lo abra.
    //
    // El despacho es best-effort: si falla, el pedido YA existe y perderlo
    // sería peor. Queda el aviso para que alguien lo complete a mano.
    if (!esRecojo) {
      try {
        // El courier sale de la zona configurada. Sin él, el despacho quedaba
        // en blanco y el botón "Coordinar envío" del panel no sabía con quién
        // iba el paquete.
        const zonaDelPedido = config.envio.zonas.find(
          (z) => z.nombre === borrador.zona,
        );
        await this.despacho.create(comprobanteId, empresaId, {
          tipoEnvio: (esAgencia ? 'AGENCIA' : 'DOMICILIO') as never,
          ...(zonaDelPedido?.courier
            ? { transportista: zonaDelPedido.courier }
            : {}),
          ...(borrador.agenciaSede
            ? { agenciaDestino: borrador.agenciaSede }
            : {}),
          ...(borrador.direccion
            ? { direccionDestino: borrador.direccion }
            : {}),
          ...(borrador.referencia || borrador.notaEntrega
            ? {
                observaciones: [borrador.referencia, borrador.notaEntrega]
                  .filter(Boolean)
                  .join(' — '),
              }
            : {}),
          ...(borrador.lugar ? { distrito: borrador.lugar } : {}),
          ...(borrador.nombre ? { nombreDestinatario: borrador.nombre } : {}),
          ...(borrador.dni ? { dniDestinatario: borrador.dni } : {}),
          ...(borrador.celular ? { celularDest: borrador.celular } : {}),
          // Las dos columnas de la plantilla del motorizado. Sin ellas el
          // pedido entra al panel marcado "con datos incompletos" y NO sale
          // en el Excel de reparto: el repartidor nunca se entera. Pasó con
          // el NV01-00000008, que quedó fuera del reparto del día.
          //
          // Se derivan, no se adivinan: si queda algo por cobrar es una
          // contraentrega, y si no, solo se entrega. La forma de cobro parte
          // en EFECTIVO porque es lo que lleva un motorizado a la puerta;
          // quien despacha la cambia en el panel si el cliente paga con Yape.
          ...(esAgencia
            ? {}
            : {
                tipoVentaReparto: (porCobrar > 0
                  ? 'CONTRAENTREGA'
                  : 'SOLO_ENTREGA') as never,
                formaPagoCobro: (porCobrar > 0
                  ? 'EFECTIVO'
                  : 'NO_COBRAR') as never,
              }),
          costoEnvio: envio,
          // Lo que queda por cobrar al entregar.
          montoCOD: porCobrar,
        });
      } catch (e) {
        this.logger.warn(
          `Lead: pedido ${codigo} creado pero sin despacho: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
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
          perfil,
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
      // Con adelanto, los medios de pago van UNA vez y aquí. El flujo del
      // cliente lo pide así y prohíbe insistir después: "indica una sola vez
      // el monto y los medios de pago y pide que envíe el comprobante".
      //
      // El asistente NO verifica el pago ni espera el voucher para confirmar:
      // el pedido queda agendado igual y la validación la hace una persona
      // antes de despachar. Es lo que decidió el negocio.
      ...(adelanto > 0 && config.mediosPago
        ? {
            mediosPago: config.mediosPago,
            instruccion:
              'Confirma el pedido con su número. Luego, UNA sola vez, dile el monto del adelanto y los medios de pago, y pídele que mande el comprobante por aquí. No insistas después ni vuelvas a repetirlos si no te los pide.',
          }
        : {}),
    };
  }

  /** El detalle que necesita quien va a despachar, en una sola lectura. */
  /**
   * Los productos bajo reserva del pedido, para decírselo al cliente al
   * cotizar. Bajo reserva es lo que el negocio consigue con su proveedor solo
   * para ese cliente: si se lo pide y el cliente no compra, el producto se
   * queda en el local. Por eso el negocio exige un pago antes (Hierba Sana,
   * 20-10): la reserva o, en provincia, el adelanto.
   */
  private avisoBajoReserva(
    productos: { descripcion: string; disponibilidad?: unknown; stock?: unknown }[],
  ): string | null {
    const enReserva = productos.filter(
      (p) => disponibilidadEfectiva(p as never) === 'BAJO_PEDIDO',
    );
    if (!enReserva.length) return null;
    return (
      `${enReserva.map((p) => p.descripcion).join(', ')} ${enReserva.length > 1 ? 'van' : 'va'} bajo reserva: lo conseguimos para el cliente, sin fecha prometida. ` +
      'Díselo junto con la cotización y explícale que para pedirlo tiene que pagar antes al menos la reserva (o el adelanto si es de provincia), según las reglas de pago del negocio. ' +
      'El pedido no se registra hasta que llegue ese comprobante.'
    );
  }

  /**
   * Si el pedido lleva algo bajo reserva y el cliente todavía no pagó nada,
   * la instrucción para el modelo; si no, `null`. No se exige un monto: el
   * negocio pide "al menos algo", y la reserva o el adelanto los fija su
   * contexto. Cualquier pago leído alcanza para registrar.
   */
  private async faltaPagoDeReserva(
    conversacionId: number,
    productos: { descripcion: string; disponibilidad?: unknown; stock?: unknown }[],
  ): Promise<string | null> {
    const aviso = this.avisoBajoReserva(productos);
    if (!aviso) return null;
    const { monto } = await this.pagadoPorElCliente(
      conversacionId,
      Number.MAX_SAFE_INTEGER,
    );
    if (monto > 0) return null;
    return (
      'El pedido NO se registró: lleva productos bajo reserva y el cliente todavía no pagó nada. ' +
      aviso.replace(/ El pedido no se registra hasta que llegue ese comprobante\.$/, '') +
      ' Pídele el pago y que mande el comprobante por aquí; cuando llegue, vuelve a registrar. No le digas que su pedido quedó registrado.'
    );
  }

  /**
   * Cuánto le falta pagar al cliente por lo que ya se le cotizó, para el
   * link de pago. Sale de lo guardado en el borrador —ítems con el precio de
   * HOY del catálogo, envío y descuento—, nunca de lo que diga el modelo.
   *
   * Pedido ya registrado: lo que falta es lo que el despacho cobraría al
   * entregar (o el saldo de la nota), que ya descuenta los adelantos.
   */
  async porPagarDelPedido(
    empresaId: number,
    conversacionId: number,
  ): Promise<{ total: number; pagado: number; porPagar: number } | { error: string }> {
    const borrador = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId },
      select: { itemsJson: true, costoEnvio: true, cotizadoEn: true, comprobanteId: true },
    });
    const items = normalizarItems(borrador?.itemsJson);
    if (!borrador?.cotizadoEn || !items.length) {
      return {
        error:
          'Todavía no hay nada cotizado en esta conversación. Cotiza primero con cotizar y muéstrale el total al cliente.',
      };
    }
    if (borrador.comprobanteId && (await this.pedidoCerrado(borrador.comprobanteId))) {
      return { error: 'El pedido de esta conversación ya está cerrado: no hay nada por cobrar.' };
    }
    const config = await this.configDe(empresaId);
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
      Number(borrador.costoEnvio ?? 0),
      config.descuento,
    );
    const total = Math.round(calculo.montoAPagar * 100) / 100;
    if (borrador.comprobanteId) {
      const [nota, despacho] = await Promise.all([
        this.prisma.comprobante.findUnique({
          where: { id: borrador.comprobanteId },
          select: { saldo: true },
        }),
        this.prisma.envioDespacho.findUnique({
          where: { comprobanteId: borrador.comprobanteId },
          select: { montoCOD: true },
        }),
      ]);
      const porPagar = Math.round(
        Number(despacho?.montoCOD ?? nota?.saldo ?? 0) * 100,
      ) / 100;
      return { total, pagado: Math.max(0, Math.round((total - porPagar) * 100) / 100), porPagar };
    }
    const { monto: pagado } = await this.pagadoPorElCliente(conversacionId, total);
    return { total, pagado, porPagar: Math.round((total - pagado) * 100) / 100 };
  }

  /**
   * Cuánto pagó ya el cliente, según los comprobantes que mandó.
   *
   * Se suma lo que la IA leyó de cada captura. Se descartan los rechazados
   * —alguien los miró y dijo que no— pero NO se exige que estén validados a
   * mano: si se exigiera, el pedido nacería dado por impago hasta que alguien
   * abriera el panel, y el cliente que ya pagó recibiría un saldo equivocado.
   * Entre cobrar de más y cobrar de menos, el error caro es el primero.
   *
   * Nunca pasa del total: un monto mal leído no puede dejar el pedido
   * sobrepagado ni el saldo en negativo.
   */
  private async pagadoPorElCliente(
    conversacionId: number,
    total: number,
  ): Promise<{ monto: number; medio: string }> {
    try {
      // Solo los vouchers de ESTE pedido: los de un pedido anterior de la
      // misma conversación ya pagaron ese pedido.
      const borrador = await this.prisma.leadPedidoBorrador.findUnique({
        where: { conversacionId },
        select: { pedidoDesde: true },
      });
      const pagos = await this.prisma.leadComprobantePago.findMany({
        where: {
          conversacionId,
          rechazadoEn: null,
          montoLeido: { not: null },
          ...(borrador?.pedidoDesde ? { recibidoEn: { gte: borrador.pedidoDesde } } : {}),
        },
        select: { montoLeido: true, medioLeido: true },
      });
      const suma = pagos.reduce((a, p) => a + Number(p.montoLeido ?? 0), 0);
      return {
        monto: Math.min(Math.max(0, Math.round(suma * 100) / 100), total),
        medio: medioDePago(pagos[0]?.medioLeido),
      };
    } catch (e) {
      // Sin esto el pedido se registra igual, solo que sin adelanto: perder la
      // venta por no poder leer un voucher sería peor.
      this.logger.warn(
        `Lead: no se pudo leer lo pagado en la conv ${conversacionId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { monto: 0, medio: 'EFECTIVO' };
    }
  }

  /**
   * Las líneas del comprobante: la mercadería, con su descuento.
   *
   * Hasta ahora iban a precio de lista, sin el descuento, así que un pedido
   * con descuento por volumen se facturaba de MÁS: 3×90 con S/ 10 de rebaja
   * salía en 270 en vez de 260.
   *
   * Lleva la mercadería con el descuento ya aplicado. El envío queda FUERA
   * por decisión contable del negocio: ver abajo.
   *
   * El descuento se reparte entre las líneas de producto y no se manda como
   * descuento global: ese es solo informativo para el ticket —el total sale de
   * las líneas—, así que restarlo ahí no cambiaría nada.
   */
  private lineasDelComprobante(
    items: ItemPedido[],
    productos: { id: number; precioUnitario: unknown }[],
    calculo: ReturnType<typeof calcularDescuento>,
    envio = 0,
    descripcionEnvio = 'ENVÍO',
  ): Array<Record<string, unknown>> {
    const precioDe = (id: number) =>
      Number(productos.find((p) => p.id === id)?.precioUnitario ?? 0);
    const bruto = items.reduce(
      (a, i) => a + precioDe(i.productoId) * i.cantidad,
      0,
    );
    const descuento = Math.max(0, calculo.descuento);

    let repartido = 0;
    const lineas: Array<Record<string, unknown>> = items.map((i, idx) => {
      const precio = precioDe(i.productoId);
      // El descuento se reparte en proporción a lo que pesa cada línea. Si
      // cayera entero en la primera, el ticket mostraría un producto regalado
      // y los demás a precio lleno.
      //
      // La ÚLTIMA línea se lleva lo que falte: repartir 10 entre 3 unidades
      // deja 3.3333 por unidad, y redondear eso a dos decimales hacía que el
      // comprobante saliera un céntimo arriba del total cobrado. El residuo
      // tiene que caer en algún lado y la última es el lugar natural.
      const esUltima = idx === items.length - 1;
      const parte = bruto > 0 ? (precio * i.cantidad) / bruto : 0;
      const rebaja = esUltima
        ? descuento - repartido
        : Math.round(descuento * parte * 100) / 100;
      repartido += rebaja;
      // El unitario NO se redondea a dos decimales: el total sale de
      // cantidad × unitario, así que un unitario recortado descuadra la
      // línea. Es el mismo criterio que usa `comprobante.service.ts`, que
      // deriva el unitario del valor de venta con más decimales.
      const unitario = Math.max(
        0,
        Math.round(((precio * i.cantidad - rebaja) / i.cantidad) * 1e6) / 1e6,
      );
      return {
        productoId: i.productoId,
        cantidad: i.cantidad,
        nuevoValorUnitario: unitario,
      };
    });

    // El envío entra como una línea más, sin producto del catálogo: el total
    // de la nota tiene que ser el de la cotización (pedido de Hierba Sana
    // 20-10: "ya no sería 14 sino 24"). Hasta el 17-10 quedaba afuera por
    // pedido de su contadora, para que no sumara IGV si la nota se convertía
    // en boleta; el negocio decidió cambiarlo. Si se convierte, esta línea
    // va gravada como cualquier ítem libre.
    if (envio > 0) {
      lineas.push({
        productoId: null,
        descripcion: descripcionEnvio.replace(/\s+/g, ' ').trim().toUpperCase(),
        cantidad: 1,
        nuevoValorUnitario: envio,
        unidad: 'ZZ',
      });
    }
    return lineas;
  }

  /**
   * Avisa al negocio que un cliente va a pasar por la tienda a recoger.
   *
   * El hueco que tapa, reportado en Hierba Sana: un señor de SJL dijo que el
   * envío le salía caro, que iba a pasar por la tienda, y al día siguiente
   * avisó que llegaba a las 2 p. m. El agente le contestó "sí, tenemos stock
   * asegurado para mañana" — y eso no estaba respaldado por nada: en el
   * negocio NADIE sabía que ese señor venía, ni por qué producto. El recojo
   * en tienda existía como zona de envío y se contaba en los reportes, pero
   * no había forma de registrar la visita.
   *
   * Lo que hace y lo que NO hace, a propósito: avisa, y no toca el stock. Una
   * reserva automática por cada "mañana paso" apartaría producto de gente que
   * no viene, y en la tienda el stock es limitado. Quien decide si lo separa
   * es el negocio, con el aviso a la vista.
   *
   * No crea comprobante: no hay venta todavía. La cotización ya está hecha y
   * es la que el equipo mira.
   */
  async avisarVisitaTienda(
    empresaId: number,
    conversacionId: number,
    telefono: string,
    cuando: string,
  ): Promise<{
    avisado?: boolean;
    yaAvisado?: boolean;
    pedido?: string;
    montoAPagar?: number;
    aviso?: string;
    falta?: string[];
    error?: string;
  }> {
    const borrador = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId },
    });
    if (!borrador) {
      return { error: 'Todavía no hay nada cotizado. Cotiza primero.' };
    }
    if (borrador.tipoZona !== ('RECOJO' satisfies TipoZona)) {
      return {
        error:
          'Esto es solo para recojo en tienda. Si el pedido es con envío, usa registrar_pedido.',
      };
    }
    const items = (borrador.itemsJson ?? []) as unknown as ItemPedido[];
    if (!Array.isArray(items) || items.length === 0) {
      return {
        error:
          'No hay productos confirmados. Cotiza primero y confirma con el cliente qué se lleva.',
      };
    }
    // El nombre es lo único que se exige: el negocio tiene que saber a quién
    // espera. El celular no se pide porque el WhatsApp por el que escribe ya
    // es su celular, y pedir un dato que ya se tiene es lo que más molesta en
    // el banco de pruebas.
    if (!borrador.nombre) return { falta: ['nombre completo'] };

    const momento = cuando.trim();
    if (!momento) {
      return { falta: ['el día y la hora en que va a pasar'] };
    }
    // Idempotencia sin campo nuevo: la visita se guarda en `horario`, que en
    // un recojo no se usa para otra cosa. Si vuelve a avisar lo mismo, no se
    // manda una segunda notificación —el modelo reintenta cuando el cliente
    // repite "sí, mañana voy"—, pero si cambia el día sí, porque eso el
    // negocio necesita saberlo.
    if (borrador.horario?.trim() === momento) {
      return { avisado: true, yaAvisado: true, ...(await this.notaDelRecojo(empresaId, conversacionId, telefono)) };
    }

    const productos = await this.prisma.producto.findMany({
      where: { empresaId, id: { in: items.map((i) => i.productoId) } },
      select: { id: true, descripcion: true, disponibilidad: true, stock: true },
    });
    // Antes de avisar a la tienda: un producto bajo reserva no se pide al
    // proveedor para alguien que todavía no pagó nada.
    const sinPagoDeReserva = await this.faltaPagoDeReserva(
      conversacionId,
      productos,
    );
    if (sinPagoDeReserva) return { error: sinPagoDeReserva };
    const lista = items
      .map((i) => {
        const p = productos.find((x) => x.id === i.productoId);
        return `• ${i.cantidad}x ${p?.descripcion ?? `producto ${i.productoId}`}`;
      })
      .join('\n');

    await this.prisma.leadPedidoBorrador.update({
      where: { conversacionId },
      data: { horario: momento },
    });

    await this.notificaciones
      .notificarAdminsEmpresa({
        empresaId,
        // WARNING y no INFO: pide una decisión —separar el producto o no— y
        // tiene fecha de caducidad. Un INFO se lee cuando se puede.
        tipo: 'WARNING',
        titulo: `🏬 Pasa por la tienda: ${borrador.nombre}`,
        mensaje: [
          `${borrador.nombre} va a recoger en tienda ${momento}.`,
          '',
          lista,
          '',
          'SIN RESERVA: el stock NO está apartado. Si quieres asegurarlo, sepáralo tú.',
          `WhatsApp: ${telefono}`,
        ].join('\n'),
        metaData: { origen: 'ia-ventas-visita-tienda', telefono },
      })
      .catch(() => undefined);

    this.logger.log(
      `Lead: visita a tienda avisada (empresa ${empresaId}, conv ${conversacionId}, ${momento}).`,
    );
    return { avisado: true, ...(await this.notaDelRecojo(empresaId, conversacionId, telefono)) };
  }

  /**
   * La visita a tienda también deja su nota de venta, sin envío ni despacho.
   *
   * Antes el recojo solo avisaba, y la reserva de S/ 5 que el cliente
   * yapeaba no tenía dónde quedar: al validar el voucher salía "el pedido
   * todavía no está registrado" y esa plata no figuraba en ningún lado
   * (prueba del 20-10). Lo decidió el negocio: la reserva se descuenta del
   * total, así que tiene que estar en la nota como adelanto. Si el cliente
   * no viene en las 2 semanas, la nota se anula a mano.
   */
  private async notaDelRecojo(
    empresaId: number,
    conversacionId: number,
    telefono: string,
  ): Promise<{ pedido?: string; montoAPagar?: number; aviso?: string }> {
    const r = await this.registrarPedido(empresaId, conversacionId, telefono);
    if (r.pedido) return { pedido: r.pedido, montoAPagar: r.montoAPagar };
    if (r.registrado) return {};
    return {
      aviso:
        'La tienda quedó avisada, pero la nota del pedido NO se registró. No le digas que su pedido quedó registrado.',
    };
  }

  /**
   * Cancela, a pedido del cliente, un pedido ya registrado: anula su nota.
   *
   * Sin esto el bot contestaba "queda cancelado" y la nota seguía viva, con
   * su despacho: el motorizado podía salir igual. Solo se anula sola cuando
   * no hay plata de por medio y el paquete no salió; lo demás tiene costos
   * (S/ 15 si ya salió el motorizado, S/ 10 si ya se empaquetó) y lo decide
   * una persona.
   */
  async cancelarPedido(
    empresaId: number,
    conversacionId: number,
    motivo: string,
  ): Promise<{
    cancelado?: boolean;
    pedido?: string;
    derivar?: string;
    error?: string;
  }> {
    const borrador = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId },
    });
    if (!borrador?.comprobanteId) {
      return {
        error:
          'No hay un pedido registrado que cancelar: solo estaba cotizado. Dile que no hay problema y que aquí estamos cuando lo necesite.',
      };
    }
    const nota = await this.prisma.comprobante.findUnique({
      where: { id: borrador.comprobanteId },
      select: {
        id: true,
        empresaId: true,
        serie: true,
        correlativo: true,
        estadoPago: true,
        estadoEnvioSunat: true,
        envioDespacho: { select: { estado: true } },
      },
    });
    if (!nota || nota.empresaId !== empresaId) {
      return { error: 'No hay un pedido registrado que cancelar.' };
    }
    const pedido = `${nota.serie}-${String(nota.correlativo).padStart(8, '0')}`;
    if (
      String(nota.estadoPago) === 'ANULADO' ||
      String(nota.estadoEnvioSunat) === 'ANULADO'
    ) {
      return { cancelado: true, pedido };
    }
    const pagos = await this.prisma.pago.count({
      where: { comprobanteId: nota.id },
    });
    if (pagos > 0) {
      return {
        derivar:
          'El cliente ya pagó parte de este pedido: la cancelación con adelanto la ve una persona. NO le digas que quedó cancelado: llama a derivar_a_asesor.',
      };
    }
    const estado = nota.envioDespacho?.estado;
    if (estado && estado !== 'PREPARANDO') {
      return {
        derivar:
          'El pedido ya salió a entrega: cancelarlo ahora tiene costo y lo ve una persona. NO le digas que quedó cancelado: llama a derivar_a_asesor.',
      };
    }
    try {
      await this.comprobante.anularComprobante(
        nota.id,
        `Cancelado por el cliente por WhatsApp${motivo ? `: ${motivo}` : ''}`.slice(0, 200),
        empresaId,
      );
    } catch (e) {
      this.logger.error(
        `Lead: no se pudo anular ${pedido}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        derivar:
          'No se pudo anular el pedido en el sistema. NO le digas que quedó cancelado: llama a derivar_a_asesor para que una persona lo anule.',
      };
    }
    await this.notificaciones
      .notificarAdminsEmpresa({
        empresaId,
        tipo: 'WARNING',
        titulo: `❌ Pedido cancelado por el cliente: ${pedido}`,
        mensaje: [
          `${borrador.nombre ?? 'El cliente'} canceló su pedido por WhatsApp. La nota ${pedido} quedó anulada.`,
          motivo ? `Motivo: ${motivo}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        metaData: { origen: 'ia-ventas-cancelacion', comprobanteId: nota.id },
      })
      .catch(() => undefined);
    this.logger.log(
      `Lead: pedido ${pedido} cancelado por el cliente (empresa ${empresaId}, conv ${conversacionId}).`,
    );
    return { cancelado: true, pedido };
  }

  private resumenParaElEquipo(
    perfil: {
      sexo: string | null;
      edad: number | null;
      sintomas: string | null;
    } | null,
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
      notaEntrega?: string | null;
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
    // Para la guía de consumo personalizada: el negocio la arma a mano tras
    // agendar, y sin estos datos no puede.
    if (perfil?.sexo || perfil?.edad) {
      l.push(
        `Perfil: ${[perfil.sexo === 'F' ? 'mujer' : perfil.sexo === 'M' ? 'hombre' : null, perfil.edad ? `${perfil.edad} años` : null].filter(Boolean).join(', ')}`,
      );
    }
    if (perfil?.sintomas) l.push(`Síntomas: ${perfil.sintomas}`);
    if (b.celular) l.push(`Celular: ${b.celular}`);
    if (b.zona) l.push(`Destino: ${b.zona}${b.lugar ? ` — ${b.lugar}` : ''}`);
    if (b.direccion) l.push(`Dirección: ${b.direccion}`);
    if (b.referencia) l.push(`Referencia: ${b.referencia}`);
    if (b.agenciaSede) l.push(`Agencia: ${b.agenciaSede}`);
    if (b.horario) l.push(`Horario: ${b.horario}`);
    if (b.notaEntrega) l.push(`Para la entrega: ${b.notaEntrega}`);
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

/**
 * La cotización tal como la leyó el cliente, para las observaciones de la COT:
 * sin el aviso de "con N unidades más", sin la pregunta de cierre y sin los
 * asteriscos de negrita de WhatsApp.
 */
export function resumenCotizacion(texto: string): string {
  const lineas = texto.split('\n');
  const fin = lineas.findIndex((l) => l.startsWith('Esta sería la cotización'));
  return (fin === -1 ? lineas : lineas.slice(0, fin))
    .filter((l) => !l.startsWith('(Con '))
    .map((l) => l.replace(/\*/g, ''))
    .join('\n')
    .trim();
}

/** Cómo se le pide al cliente cada dato que devuelve `faltantes`. */
const ETIQUETA_DEL_DATO: Record<string, string> = {
  'el distrito o ciudad de entrega': 'Distrito o ciudad',
  'nombre completo': 'Nombres y apellidos',
  DNI: 'DNI',
  'dirección con calle y número': 'Dirección (calle y número)',
  'una referencia para ubicar la dirección': 'Referencia',
  'el horario de entrega': 'Horario para recibir tu pedido',
  'la sede de la agencia donde recogerá': 'Agencia y sede donde recogerás',
  'celular de contacto': 'Número de celular',
};

/**
 * Los datos que faltan, en un solo bloque para que el cliente los conteste
 * todos de una vez. Pedido de Hierba Sana (20-10): de a uno eran cinco
 * idas y vueltas. Con un solo dato pendiente no hace falta el bloque.
 */
export function conBloqueDeDatos(faltan: string[]): { pedirTodoJunto?: string } {
  if (faltan.length < 2) return {};
  const lineas = faltan.map((f) => `- ${ETIQUETA_DEL_DATO[f] ?? f}:`);
  return {
    pedirTodoJunto: [
      'Para agendar tu pedido, compárteme estos datos en un solo mensaje:',
      '',
      '*DATOS PARA AGENDAR TU PEDIDO*',
      ...lineas,
    ].join('\n'),
  };
}

/** Ítems comparables: solo id y cantidad, ordenados por id. */
function normalizarItems(json: unknown): ItemPedido[] {
  if (!Array.isArray(json)) return [];
  return (json as ItemPedido[])
    .map((i) => ({ productoId: Number(i.productoId), cantidad: Number(i.cantidad) }))
    .sort((a, b) => a.productoId - b.productoId);
}

/**
 * ¿Dos nombres son de la misma persona? Sí si todas las palabras del más
 * corto están en el otro: "Diego Ortega" = "Diego Jesús Ortega Roldán", pero
 * "Diego Ortega Roldán" ≠ "Diego Ortega Ramos".
 */
export function mismaPersona(a: string, b: string): boolean {
  const palabras = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-zñ]+/)
      .filter((w) => w.length > 1);
  const [corto, largo] = [palabras(a), palabras(b)].sort((x, y) => x.length - y.length);
  if (corto.length === 0) return false;
  return corto.every((w) => largo.includes(w));
}
