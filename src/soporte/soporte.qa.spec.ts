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

  /** Varias empresas de golpe, para los casos de bandeja con carga real. */
  const crearEmpresas = async (cuantas: number, brand: string, prefijo: string) => {
    const ids: number[] = [];
    for (let i = 0; i < cuantas; i++) {
      ids.push(await crearEmpresa(`${prefijo}-${i}-${Date.now()}`, brand));
    }
    return ids;
  };

  const borrarEmpresas = async (ids: number[]) => {
    for (const id of ids) {
      await prisma.soporteMensaje.deleteMany({
        where: { conversacion: { empresaId: id } },
      });
      await prisma.soporteConversacion.deleteMany({ where: { empresaId: id } });
      await prisma.empresa.delete({ where: { id } }).catch(() => {});
    }
  };

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

  // ── Varias empresas hablando a la vez ─────────────────────────────────────
  // Con una sola empresa no se ve nada de esto: los hilos son por empresa, los
  // contadores son por hilo y la bandeja los mezcla todos. Aquí es donde se
  // cruzarían si algo estuviera mal.
  describe('varias empresas escribiendo al mismo tiempo', () => {
    let muchas: number[] = [];

    beforeAll(async () => {
      muchas = await crearEmpresas(6, 'krezka', 'qa-soporte-multi');
    });

    afterAll(async () => {
      await borrarEmpresas(muchas);
    });

    it('cada empresa tiene SU hilo, no uno compartido', async () => {
      await Promise.all(
        muchas.map((id, i) =>
          soporte.enviarMensajeEmpresa(id, usuarioEmpresaId, `consulta de la empresa ${i}`),
        ),
      );

      const hilos = await Promise.all(muchas.map((id) => leerConversacion(id)));
      const ids = hilos.map((h) => h!.id);
      expect(new Set(ids).size).toBe(muchas.length);
    });

    it('cada una ve solo sus propios mensajes', async () => {
      for (let i = 0; i < muchas.length; i++) {
        const { mensajes } = await soporte.listarMensajes(muchas[i]);
        expect(mensajes).toHaveLength(1);
        expect(mensajes[0].contenido).toBe(`consulta de la empresa ${i}`);
      }
    });

    it('los contadores de no leídos no se cruzan entre empresas', async () => {
      // La empresa 0 escribe tres veces más; eso no puede mover a las demás.
      await soporte.enviarMensajeEmpresa(muchas[0], usuarioEmpresaId, 'insisto 1');
      await soporte.enviarMensajeEmpresa(muchas[0], usuarioEmpresaId, 'insisto 2');
      await soporte.enviarMensajeEmpresa(muchas[0], usuarioEmpresaId, 'insisto 3');

      expect((await leerConversacion(muchas[0]))!.noLeidosSistema).toBe(4);
      for (const id of muchas.slice(1)) {
        expect((await leerConversacion(id))!.noLeidosSistema).toBe(1);
      }
    });

    it('la bandeja las lista a todas, cada una con su último mensaje', async () => {
      const lista = await soporte.listarConversacionesSistema('krezka');
      for (let i = 0; i < muchas.length; i++) {
        const fila = lista.find((c) => c.empresaId === muchas[i]);
        expect(fila).toBeDefined();
        expect(fila!.ultimoMensaje).toBe(
          i === 0 ? 'insisto 3' : `consulta de la empresa ${i}`,
        );
      }
    });

    it('Krezka responde a varias y cada respuesta llega a su hilo', async () => {
      const hilos = await Promise.all(muchas.map((id) => leerConversacion(id)));
      await Promise.all(
        hilos.map((h, i) =>
          soporte.enviarMensajeSistema(
            h!.id,
            'krezka',
            usuarioKrezkaId,
            `respuesta para la ${i}`,
          ),
        ),
      );

      for (let i = 0; i < muchas.length; i++) {
        const { mensajes } = await soporte.listarMensajes(muchas[i]);
        const ultimo = mensajes[mensajes.length - 1];
        expect(ultimo.rol).toBe('SISTEMA');
        expect(ultimo.contenido).toBe(`respuesta para la ${i}`);
      }
    });

    it('atender a una empresa no marca como leídas las demás', async () => {
      // El error clásico: poner los contadores en cero de golpe al abrir la
      // bandeja, y perder los pedidos de todos los que no se atendieron.
      await Promise.all(
        muchas.map((id) => soporte.enviarMensajeEmpresa(id, usuarioEmpresaId, 'algo nuevo')),
      );
      const hilo0 = await leerConversacion(muchas[0]);
      await soporte.obtenerConversacionSistema(hilo0!.id, 'krezka');

      expect((await leerConversacion(muchas[0]))!.noLeidosSistema).toBe(0);
      for (const id of muchas.slice(1)) {
        expect((await leerConversacion(id))!.noLeidosSistema).toBeGreaterThan(0);
      }
    });

    it('cerrar el hilo de una no cierra el de las otras', async () => {
      const hilo0 = await leerConversacion(muchas[0]);
      await soporte.cerrarConversacion(hilo0!.id, 'krezka');

      expect((await leerConversacion(muchas[0]))!.estado).toBe('CERRADA');
      for (const id of muchas.slice(1)) {
        expect((await leerConversacion(id))!.estado).toBe('ABIERTA');
      }
    });

    it('la bandeja mezcla marcas distintas sin filtrarlas mal', async () => {
      const deOtraMarca = await crearEmpresas(3, 'falconext', 'qa-soporte-mixto');
      try {
        await Promise.all(
          deOtraMarca.map((id) =>
            soporte.enviarMensajeEmpresa(id, usuarioEmpresaId, 'soy de la otra marca'),
          ),
        );

        const krezka = await soporte.listarConversacionesSistema('krezka');
        const otra = await soporte.listarConversacionesSistema('falconext');

        // Ninguna de las seis de Krezka se cuela en la bandeja de la otra…
        for (const id of muchas) {
          expect(otra.some((c) => c.empresaId === id)).toBe(false);
        }
        // …ni al revés.
        for (const id of deOtraMarca) {
          expect(krezka.some((c) => c.empresaId === id)).toBe(false);
          expect(otra.some((c) => c.empresaId === id)).toBe(true);
        }
      } finally {
        await borrarEmpresas(deOtraMarca);
      }
    });

    it('dos empleados de la MISMA empresa escribiendo a la vez no chocan', async () => {
      // `obtenerOCrearConversacion` lee y después crea; dos mensajes a la vez
      // sobre una empresa sin hilo podrían intentar crearlo dos veces, y la
      // columna es única.
      const nueva = (await crearEmpresas(1, 'krezka', 'qa-soporte-carrera'))[0];
      try {
        const resultados = await Promise.allSettled([
          soporte.enviarMensajeEmpresa(nueva, usuarioEmpresaId, 'del vendedor'),
          soporte.enviarMensajeEmpresa(nueva, usuarioEmpresaId, 'del administrador'),
        ]);

        const fallidos = resultados.filter((r) => r.status === 'rejected');
        if (fallidos.length > 0) {
          const motivo = (fallidos[0] as PromiseRejectedResult).reason;
          throw new Error(
            `dos mensajes simultáneos de la misma empresa fallaron: ${String(motivo?.code ?? '')} ${String(motivo?.message ?? motivo).slice(0, 400)}`,
          );
        }
        const { mensajes } = await soporte.listarMensajes(nueva);
        expect(mensajes).toHaveLength(2);
      } finally {
        await borrarEmpresas([nueva]);
      }
    });

    it('con 20 empresas escribiendo, la bandeja sigue ordenada por actividad', async () => {
      const lote = await crearEmpresas(20, 'krezka', 'qa-soporte-lote');
      try {
        // En orden: la última en escribir tiene que quedar primera.
        for (const id of lote) {
          await soporte.enviarMensajeEmpresa(id, usuarioEmpresaId, `soy ${id}`);
        }

        const lista = await soporte.listarConversacionesSistema('krezka');
        const delLote = lista.filter((c) => lote.includes(c.empresaId));
        expect(delLote).toHaveLength(lote.length);

        const fechas = delLote.map((c) => new Date(c.actualizadoEn).getTime());
        expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
        // La primera de la bandeja es la última que escribió.
        expect(delLote[0].empresaId).toBe(lote[lote.length - 1]);
      } finally {
        await borrarEmpresas(lote);
      }
    });
  });

  // ── Lo que pasa cuando algo alrededor falla ───────────────────────────────
  describe('cuando el aviso en vivo falla', () => {
    /** Un servicio de soporte cuyo aviso revienta, como si el socket se cayera. */
    const conAvisoRoto = () => {
      const notificaciones: any = new Proxy(
        {},
        {
          get: () => () => {
            throw new Error('socket caído');
          },
        },
      );
      return new SoporteService(prisma as any, notificaciones);
    };

    it('el mensaje no se pierde si el aviso revienta', async () => {
      const empresa = (await crearEmpresas(1, 'krezka', 'qa-soporte-aviso'))[0];
      try {
        const roto = conAvisoRoto();
        await roto.enviarMensajeEmpresa(empresa, usuarioEmpresaId, 'se cayó el socket').catch(() => {});

        // Haya fallado o no el envío, el mensaje YA está guardado.
        const { mensajes } = await soporte.listarMensajes(empresa);
        expect(mensajes).toHaveLength(1);
      } finally {
        await borrarEmpresas([empresa]);
      }
    });

    it('un aviso caído no le devuelve error al empresario', async () => {
      // Si rechaza, el empresario ve un error, reintenta, y el mensaje queda
      // DUPLICADO: el primero sí se había guardado.
      const empresa = (await crearEmpresas(1, 'krezka', 'qa-soporte-aviso2'))[0];
      try {
        const roto = conAvisoRoto();
        await expect(
          roto.enviarMensajeEmpresa(empresa, usuarioEmpresaId, 'primer intento'),
        ).resolves.toBeDefined();
      } finally {
        await borrarEmpresas([empresa]);
      }
    });

    it('lo mismo del lado de Krezka al responder', async () => {
      const empresa = (await crearEmpresas(1, 'krezka', 'qa-soporte-aviso3'))[0];
      try {
        await soporte.enviarMensajeEmpresa(empresa, usuarioEmpresaId, 'hola');
        const hilo = await leerConversacion(empresa);
        const roto = conAvisoRoto();
        await expect(
          roto.enviarMensajeSistema(hilo!.id, 'krezka', usuarioKrezkaId, 'respondo'),
        ).resolves.toBeDefined();
      } finally {
        await borrarEmpresas([empresa]);
      }
    });
  });

  // ── El contenido que la gente escribe de verdad ───────────────────────────
  describe('contenido', () => {
    let empresa: number;
    beforeAll(async () => {
      empresa = (await crearEmpresas(1, 'krezka', 'qa-soporte-texto'))[0];
    });
    afterAll(async () => {
      await borrarEmpresas([empresa]);
    });

    it('acepta tildes, ñ y emoji sin romperlos', async () => {
      const texto = 'La boleta de mañana salió mal 😕 ¿me ayudan?';
      await soporte.enviarMensajeEmpresa(empresa, usuarioEmpresaId, texto);
      const { mensajes } = await soporte.listarMensajes(empresa);
      expect(mensajes[mensajes.length - 1].contenido).toBe(texto);
    });

    it('un mensaje largo se guarda entero, sin cortarlo', async () => {
      const largo = 'necesito ayuda con esto. '.repeat(400); // ~10 000 caracteres
      await soporte.enviarMensajeEmpresa(empresa, usuarioEmpresaId, largo);
      const { mensajes } = await soporte.listarMensajes(empresa);
      expect(mensajes[mensajes.length - 1].contenido).toHaveLength(largo.trim().length);
    });

    it('los saltos de línea se conservan', async () => {
      const texto = 'primero esto\nsegundo esto\n\ny esto';
      await soporte.enviarMensajeEmpresa(empresa, usuarioEmpresaId, texto);
      const { mensajes } = await soporte.listarMensajes(empresa);
      expect(mensajes[mensajes.length - 1].contenido).toBe(texto);
    });

    it('el texto se guarda tal cual, sin interpretarlo', async () => {
      // Parece SQL y parece HTML; para el chat es texto y nada más.
      const texto = "'; DROP TABLE \"SoporteMensaje\"; -- <script>alert(1)</script>";
      await soporte.enviarMensajeEmpresa(empresa, usuarioEmpresaId, texto);
      const { mensajes } = await soporte.listarMensajes(empresa);
      expect(mensajes[mensajes.length - 1].contenido).toBe(texto);
      // Y la tabla sigue ahí.
      expect(await prisma.soporteMensaje.count()).toBeGreaterThan(0);
    });
  });

  // ── El orden del hilo, que es lo que hace legible la conversación ─────────
  describe('orden de los mensajes', () => {
    it('una ráfaga de mensajes seguidos se lee en el orden en que se escribió', async () => {
      const empresa = (await crearEmpresas(1, 'krezka', 'qa-soporte-orden'))[0];
      try {
        for (let i = 1; i <= 12; i++) {
          await soporte.enviarMensajeEmpresa(empresa, usuarioEmpresaId, `mensaje ${i}`);
        }
        const { mensajes } = await soporte.listarMensajes(empresa);
        expect(mensajes.map((m) => m.contenido)).toEqual(
          Array.from({ length: 12 }, (_, i) => `mensaje ${i + 1}`),
        );
      } finally {
        await borrarEmpresas([empresa]);
      }
    });

    it('ida y vuelta entre empresa y Krezka queda intercalado correctamente', async () => {
      const empresa = (await crearEmpresas(1, 'krezka', 'qa-soporte-ida'))[0];
      try {
        await soporte.enviarMensajeEmpresa(empresa, usuarioEmpresaId, 'pregunta 1');
        const hilo = await leerConversacion(empresa);
        await soporte.enviarMensajeSistema(hilo!.id, 'krezka', usuarioKrezkaId, 'respuesta 1');
        await soporte.enviarMensajeEmpresa(empresa, usuarioEmpresaId, 'pregunta 2');
        await soporte.enviarMensajeSistema(hilo!.id, 'krezka', usuarioKrezkaId, 'respuesta 2');

        const { mensajes } = await soporte.listarMensajes(empresa);
        expect(mensajes.map((m) => `${m.rol}:${m.contenido}`)).toEqual([
          'EMPRESA:pregunta 1',
          'SISTEMA:respuesta 1',
          'EMPRESA:pregunta 2',
          'SISTEMA:respuesta 2',
        ]);
      } finally {
        await borrarEmpresas([empresa]);
      }
    });

    it('mensajes simultáneos: no se pierde ninguno y el contador es exacto', async () => {
      const empresa = (await crearEmpresas(1, 'krezka', 'qa-soporte-rafaga'))[0];
      try {
        // El hilo ya existe, así que esto no prueba la carrera de creación
        // sino que los `increment` del contador no se pisen entre sí.
        await soporte.estado(empresa);
        await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            soporte.enviarMensajeEmpresa(empresa, usuarioEmpresaId, `simultáneo ${i}`),
          ),
        );

        const { mensajes } = await soporte.listarMensajes(empresa);
        expect(mensajes).toHaveLength(10);
        // Se leyó recién arriba, así que el de la empresa quedó en 0; el que
        // importa es el de Krezka, que tiene que contar los 10.
        const hilo = await leerConversacion(empresa);
        expect(hilo!.noLeidosSistema).toBe(10);
      } finally {
        await borrarEmpresas([empresa]);
      }
    });
  });
});
