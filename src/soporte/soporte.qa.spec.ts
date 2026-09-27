/**
 * QA funcional del chat de soporte, contra PostgreSQL real.
 *
 * Es un hilo continuo por empresa, no un sistema de tickets: el empresario
 * escribe desde su panel y el equipo de Krezka responde desde la bandeja.
 *
 * Lo que más importa verificar es el aislamiento entre marcas —una empresa no
 * puede ver el hilo de otra, y un admin de una marca no puede leer los de
 * otra— y que los contadores de no leídos no mientan, porque de eso dependen
 * los avisos que hacen que alguien conteste.
 *
 *   DATABASE_URL_TEST="postgresql://postgres:developer@localhost:5432/sistema_mype" \
 *     NINJA_ENV=parentDisabled npx jest --runInBand src/soporte/soporte.qa
 */
import { PrismaClient } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SoporteService } from './soporte.service';

const URL = process.env.DATABASE_URL_TEST;
const describeSiHayBase = URL ? describe : describe.skip;

describeSiHayBase('Chat de soporte · contra base real', () => {
  let prisma: PrismaClient;
  let soporte: SoporteService;
  /** Los avisos en vivo se registran aquí en vez de enviarse. */
  let avisos: Array<{ metodo: string; args: any[] }>;

  let krezkaId: number;
  let otraMarcaId: number;
  let usuarioEmpresaId: number;
  let usuarioKrezkaId: number;

  const crearEmpresa = async (marca: string, brand: string) => {
    const plan = await prisma.plan.findFirst({ select: { id: true } });
    const anio = 1000 * 60 * 60 * 24 * 365;
    return (
      await prisma.empresa.create({
        data: {
          razonSocial: marca,
          nombreComercial: marca,
          direccion: 'QA',
          ruc: `${Date.now()}${Math.floor(Math.random() * 100)}`.slice(-11),
          planId: plan!.id,
          brand,
          fechaActivacion: new Date(),
          fechaExpiracion: new Date(Date.now() + anio),
        },
        select: { id: true },
      })
    ).id;
  };

  const leerConversacion = (empresaId: number) =>
    prisma.soporteConversacion.findUnique({ where: { empresaId } });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();

    avisos = [];
    const notificaciones: any = new Proxy(
      {},
      {
        get: (_t, metodo: string) => (...args: any[]) => {
          avisos.push({ metodo, args });
          return Promise.resolve();
        },
      },
    );
    soporte = new SoporteService(prisma as any, notificaciones);

    krezkaId = await crearEmpresa(`qa-soporte-krezka-${Date.now()}`, 'krezka');
    otraMarcaId = await crearEmpresa(`qa-soporte-otra-${Date.now()}`, 'falconext');

    const usuario = await prisma.usuario.findFirst({ select: { id: true } });
    usuarioEmpresaId = usuario!.id;
    usuarioKrezkaId = usuario!.id;
  });

  afterAll(async () => {
    for (const id of [krezkaId, otraMarcaId]) {
      if (!id) continue;
      await prisma.soporteMensaje.deleteMany({
        where: { conversacion: { empresaId: id } },
      });
      await prisma.soporteConversacion.deleteMany({ where: { empresaId: id } });
      await prisma.empresa.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    avisos = [];
  });

  // ── El hilo de la empresa ─────────────────────────────────────────────────
  describe('el empresario escribe', () => {
    it('la primera consulta crea el hilo sola, sin que nadie lo abra', async () => {
      // No hay "crear ticket": el hilo existe desde que hace falta.
      const estado = await soporte.estado(krezkaId);
      expect(estado).toEqual({ noLeidos: 0 });
      expect(await leerConversacion(krezkaId)).not.toBeNull();
    });

    it('el mensaje queda guardado y con el nombre de quien escribió', async () => {
      await soporte.enviarMensajeEmpresa(
        krezkaId,
        usuarioEmpresaId,
        'No me deja emitir una boleta',
      );
      const { mensajes } = await soporte.listarMensajes(krezkaId);
      expect(mensajes).toHaveLength(1);
      expect(mensajes[0].contenido).toBe('No me deja emitir una boleta');
      expect(mensajes[0].rol).toBe('EMPRESA');
      expect(mensajes[0].autorNombre).toBeTruthy();
    });

    it('un mensaje en blanco se rechaza con un motivo', async () => {
      // Antes se devolvía OK sin guardar nada y el mensaje desaparecía.
      await expect(
        soporte.enviarMensajeEmpresa(krezkaId, usuarioEmpresaId, '   '),
      ).rejects.toThrow(BadRequestException);
      await expect(
        soporte.enviarMensajeEmpresa(krezkaId, usuarioEmpresaId, '\n\t '),
      ).rejects.toThrow('Escribe un mensaje');
    });

    it('el texto se guarda sin los espacios de los bordes', async () => {
      await soporte.enviarMensajeEmpresa(krezkaId, usuarioEmpresaId, '  hola  ');
      const { mensajes } = await soporte.listarMensajes(krezkaId);
      expect(mensajes[mensajes.length - 1].contenido).toBe('hola');
    });

    it('escribir avisa a Krezka en vivo', async () => {
      await soporte.enviarMensajeEmpresa(krezkaId, usuarioEmpresaId, '¿hay alguien?');
      expect(avisos.length).toBeGreaterThan(0);
    });
  });

  // ── Los contadores, que son los que hacen que alguien conteste ────────────
  describe('no leídos', () => {
    it('cada mensaje de la empresa sube el contador de Krezka', async () => {
      const antes = (await leerConversacion(krezkaId))!.noLeidosSistema;
      await soporte.enviarMensajeEmpresa(krezkaId, usuarioEmpresaId, 'uno');
      await soporte.enviarMensajeEmpresa(krezkaId, usuarioEmpresaId, 'dos');
      expect((await leerConversacion(krezkaId))!.noLeidosSistema).toBe(antes + 2);
    });

    it('abrir la conversación en la bandeja los marca como leídos', async () => {
      const conv = await leerConversacion(krezkaId);
      await soporte.obtenerConversacionSistema(conv!.id, 'krezka');
      expect((await leerConversacion(krezkaId))!.noLeidosSistema).toBe(0);
    });

    it('la respuesta de Krezka sube el contador de la empresa', async () => {
      const conv = await leerConversacion(krezkaId);
      const antes = (await leerConversacion(krezkaId))!.noLeidosEmpresa;
      await soporte.enviarMensajeSistema(
        conv!.id,
        'krezka',
        usuarioKrezkaId,
        'Ya lo estamos viendo',
      );
      expect((await leerConversacion(krezkaId))!.noLeidosEmpresa).toBe(antes + 1);
    });

    it('`estado` NO marca como leído: es solo para el globito', async () => {
      // Si contara como leer, el aviso desaparecería sin que nadie abra el chat.
      const antes = (await leerConversacion(krezkaId))!.noLeidosEmpresa;
      expect(antes).toBeGreaterThan(0);
      const estado = await soporte.estado(krezkaId);
      expect(estado.noLeidos).toBe(antes);
      expect((await leerConversacion(krezkaId))!.noLeidosEmpresa).toBe(antes);
    });

    it('abrir el chat sí los marca como leídos', async () => {
      await soporte.listarMensajes(krezkaId);
      expect((await leerConversacion(krezkaId))!.noLeidosEmpresa).toBe(0);
    });
  });

  // ── El aislamiento entre marcas ───────────────────────────────────────────
  describe('cada marca ve solo lo suyo', () => {
    it('la bandeja de una marca no lista los hilos de otra', async () => {
      await soporte.enviarMensajeEmpresa(otraMarcaId, usuarioEmpresaId, 'hola desde la otra marca');

      const deKrezka = await soporte.listarConversacionesSistema('krezka');
      const deOtra = await soporte.listarConversacionesSistema('falconext');

      expect(deKrezka.some((c) => c.empresaId === krezkaId)).toBe(true);
      expect(deKrezka.some((c) => c.empresaId === otraMarcaId)).toBe(false);
      expect(deOtra.some((c) => c.empresaId === otraMarcaId)).toBe(true);
      expect(deOtra.some((c) => c.empresaId === krezkaId)).toBe(false);
    });

    it('no se puede abrir el hilo de otra marca ni sabiendo su id', async () => {
      const ajena = await leerConversacion(otraMarcaId);
      // Responde "no encontrada", no "sin permiso": no confirma que exista.
      await expect(
        soporte.obtenerConversacionSistema(ajena!.id, 'krezka'),
      ).rejects.toThrow(NotFoundException);
    });

    it('tampoco se le puede escribir a un hilo de otra marca', async () => {
      const ajena = await leerConversacion(otraMarcaId);
      await expect(
        soporte.enviarMensajeSistema(ajena!.id, 'krezka', usuarioKrezkaId, 'intruso'),
      ).rejects.toThrow(NotFoundException);
    });

    it('ni cerrarlo', async () => {
      const ajena = await leerConversacion(otraMarcaId);
      await expect(
        soporte.cerrarConversacion(ajena!.id, 'krezka'),
      ).rejects.toThrow(NotFoundException);
    });

    it('un admin sin marca asignada ve todas', async () => {
      const todas = await soporte.listarConversacionesSistema(null);
      expect(todas.some((c) => c.empresaId === krezkaId)).toBe(true);
      expect(todas.some((c) => c.empresaId === otraMarcaId)).toBe(true);
    });
  });

  // ── El ciclo de vida del hilo ─────────────────────────────────────────────
  describe('abrir y cerrar', () => {
    it('cerrar deja el hilo cerrado, sin borrar el historial', async () => {
      const conv = await leerConversacion(krezkaId);
      const antes = (await soporte.listarMensajes(krezkaId)).mensajes.length;

      await soporte.cerrarConversacion(conv!.id, 'krezka');

      const despues = await soporte.listarMensajes(krezkaId);
      expect(despues.estado).toBe('CERRADA');
      expect(despues.mensajes).toHaveLength(antes);
    });

    it('un hilo cerrado se reabre solo cuando el empresario vuelve a escribir', async () => {
      // No hay que pedirle a nadie que lo reabra: escribir alcanza.
      await soporte.enviarMensajeEmpresa(krezkaId, usuarioEmpresaId, 'volvió a pasar');
      expect((await leerConversacion(krezkaId))!.estado).toBe('ABIERTA');
    });

    it('responder desde la bandeja también lo reabre y deja el hilo asignado', async () => {
      const conv = await leerConversacion(krezkaId);
      await soporte.cerrarConversacion(conv!.id, 'krezka');
      await soporte.enviarMensajeSistema(
        conv!.id,
        'krezka',
        usuarioKrezkaId,
        'seguimos acá',
      );

      const actualizada = await leerConversacion(krezkaId);
      expect(actualizada!.estado).toBe('ABIERTA');
      // Queda claro quién lo está atendiendo.
      expect(actualizada!.asignadoAId).toBe(usuarioKrezkaId);
      expect(actualizada!.asignadoANombre).toBeTruthy();
    });

    it('la bandeja se puede filtrar por estado', async () => {
      const conv = await leerConversacion(krezkaId);
      await soporte.cerrarConversacion(conv!.id, 'krezka');

      const cerradas = await soporte.listarConversacionesSistema('krezka', 'CERRADA');
      const abiertas = await soporte.listarConversacionesSistema('krezka', 'ABIERTA');
      expect(cerradas.some((c) => c.empresaId === krezkaId)).toBe(true);
      expect(abiertas.some((c) => c.empresaId === krezkaId)).toBe(false);
    });
  });

  // ── Lo que la bandeja muestra ─────────────────────────────────────────────
  describe('la bandeja', () => {
    it('muestra el último mensaje y el nombre de la empresa', async () => {
      await soporte.enviarMensajeEmpresa(krezkaId, usuarioEmpresaId, 'el último que escribí');
      const lista = await soporte.listarConversacionesSistema('krezka');
      const fila = lista.find((c) => c.empresaId === krezkaId);

      expect(fila?.ultimoMensaje).toBe('el último que escribí');
      expect(fila?.empresaNombre).toBeTruthy();
    });

    it('ordena por actividad: lo que se movió último va primero', async () => {
      // Lo contrario haría que los pedidos nuevos queden enterrados.
      const todas = await soporte.listarConversacionesSistema(null);
      const fechas = todas.map((c) => new Date(c.actualizadoEn).getTime());
      const ordenadas = [...fechas].sort((a, b) => b - a);
      expect(fechas).toEqual(ordenadas);
    });

    it('un hilo sin mensajes no rompe la lista', async () => {
      // El hilo se crea con el primer `estado`, antes de cualquier mensaje.
      const vacia = await crearEmpresa(`qa-soporte-vacia-${Date.now()}`, 'krezka');
      await soporte.estado(vacia);

      const lista = await soporte.listarConversacionesSistema('krezka');
      const fila = lista.find((c) => c.empresaId === vacia);
      expect(fila?.ultimoMensaje).toBeNull();

      await prisma.soporteConversacion.deleteMany({ where: { empresaId: vacia } });
      await prisma.empresa.delete({ where: { id: vacia } }).catch(() => {});
    });
  });
});
