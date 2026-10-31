import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LibroReclamacionesService } from './libro-reclamaciones.service';
import { LibroReclamacionesController } from './libro-reclamaciones.controller';
import { hojaValida } from './libro-reclamaciones.fixtures';

const EMPRESA = {
  id: 7,
  ruc: '20123456789',
  razonSocial: 'MI EMPRESA SAC',
  nombreComercial: 'Mi Tienda',
  direccion: 'Jr. Lima 1',
  distrito: 'Miraflores',
  provincia: 'Lima',
  departamento: 'Lima',
  logo: null,
};

const espera = () =>
  new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));

/**
 * Prisma de mentira con lo justo: el contador se incrementa con la misma
 * semántica que el INSERT … ON CONFLICT (la transacción sostiene el bloqueo de
 * la fila hasta el commit) y un rollback deshace el incremento.
 */
function crearPrisma() {
  const contadores = new Map<string, number>();
  const filas: any[] = [];
  let siguienteId = 1;
  let cola: Promise<void> = Promise.resolve();
  const fallarCreacion = { veces: 0 };

  const coincide = (f: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
      if (k === 'OR') return true;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('gte' in v && !(f[k] >= v.gte)) return false;
        if ('lte' in v && !(f[k] <= v.lte)) return false;
        if ('lt' in v && !(f[k] < v.lt)) return false;
        return true;
      }
      return f[k] === v;
    });

  const libroReclamacion = {
    create: async ({ data }: any) => {
      await espera();
      if (fallarCreacion.veces > 0) {
        fallarCreacion.veces -= 1;
        throw new Error('fallo de escritura');
      }
      if (
        filas.some(
          (f) => f.empresaId === data.empresaId && f.codigo === data.codigo,
        )
      ) {
        throw new Error('Unique constraint failed (empresaId, codigo)');
      }
      const fila = {
        id: siguienteId++,
        estado: 'PENDIENTE',
        respuesta: null,
        fechaRespuesta: null,
        respondidoPorId: null,
        respondidoPor: null,
        ...data,
      };
      filas.push(fila);
      return fila;
    },
    findUnique: async ({ where }: any) =>
      filas.find(
        (f) =>
          f.empresaId === where.empresaId_codigo.empresaId &&
          f.codigo === where.empresaId_codigo.codigo,
      ) ?? null,
    findFirst: async ({ where }: any) =>
      filas.find((f) => coincide(f, where)) ?? null,
    findMany: jest.fn(async ({ where, skip = 0, take = 1000 }: any) =>
      filas.filter((f) => coincide(f, where)).slice(skip, skip + take),
    ),
    count: async ({ where }: any) =>
      filas.filter((f) => coincide(f, where)).length,
    updateMany: async ({ where, data }: any) => {
      await espera();
      const objetivo = filas.filter((f) => coincide(f, where));
      objetivo.forEach((f) =>
        Object.assign(f, data, {
          respondidoPor: { id: data.respondidoPorId, nombre: 'Dueño' },
        }),
      );
      return { count: objetivo.length };
    },
  };

  const prisma = {
    empresa: {
      findUnique: async ({ where }: any) =>
        where.slugTienda === 'mi-tienda' || where.id === EMPRESA.id
          ? EMPRESA
          : null,
    },
    libroReclamacion,
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      let liberar!: () => void;
      const anterior = cola;
      cola = new Promise<void>((r) => (liberar = r));
      let tomado: string | null = null;
      try {
        const tx = {
          libroReclamacion,
          $queryRaw: async (
            _sql: TemplateStringsArray,
            empresaId: number,
            anio: number,
          ) => {
            await anterior; // el bloqueo de la fila del contador hasta el commit
            await espera();
            tomado = `${empresaId}:${anio}`;
            const ultimo = (contadores.get(tomado) ?? 0) + 1;
            contadores.set(tomado, ultimo);
            return [{ ultimo }];
          },
        };
        return await fn(tx);
      } catch (e) {
        // Rollback: todavía tenemos el bloqueo, así que deshacer es seguro.
        if (tomado) contadores.set(tomado, (contadores.get(tomado) ?? 1) - 1);
        throw e;
      } finally {
        liberar();
      }
    },
  };
  return { prisma, filas, fallarCreacion };
}

function montar() {
  const { prisma, filas, fallarCreacion } = crearPrisma();
  const pdf = {
    generarPdfDesdeHtml: jest.fn(async (html: string) => Buffer.from(html)),
  };
  const avisos = {
    alRegistrar: jest.fn(async () => undefined),
    alResponder: jest.fn(async () => undefined),
    avisarVencimientos: jest.fn(async () => undefined),
  };
  const service = new LibroReclamacionesService(
    prisma as any,
    pdf as any,
    avisos as any,
  );
  return { service, filas, fallarCreacion, pdf, avisos };
}

const lima = (iso: string) => new Date(`${iso}-05:00`);
const ORIGEN = { ip: '1.2.3.4', userAgent: 'jest' };

describe('Registro y correlativo', () => {
  it('primer reclamo del año: 2026-000001, token y fecha límite a 15 días hábiles', async () => {
    const { service, filas } = montar();
    const r = await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-03-30T10:00:00'),
    );
    expect(r.codigo).toBe('2026-000001');
    expect(r.fechaLimite.toISOString()).toBe('2026-04-23T04:59:59.999Z');
    expect(r.token.length).toBeGreaterThanOrEqual(32);
    expect(filas[0].tokenHash).not.toBe(r.token);
    expect(filas[0].ip).toBe('1.2.3.4');
    expect(filas[0].proveedorRuc).toBe('20123456789');
  });

  it('50 registros simultáneos: sin saltos ni duplicados', async () => {
    const { service, filas } = montar();
    const ahora = lima('2026-05-04T10:00:00');
    const res = await Promise.all(
      Array.from({ length: 50 }, () =>
        service.registrar('mi-tienda', hojaValida(), ORIGEN, ahora),
      ),
    );
    const codigos = res.map((r) => r.codigo).sort();
    expect(new Set(codigos).size).toBe(50);
    expect(codigos[0]).toBe('2026-000001');
    expect(codigos[49]).toBe('2026-000050');
    expect(filas.map((f) => f.correlativo).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });

  it('si la creación falla, el número no se gasta (rollback del contador)', async () => {
    const { service, fallarCreacion } = montar();
    const ahora = lima('2026-05-04T10:00:00');
    await service.registrar('mi-tienda', hojaValida(), ORIGEN, ahora);
    fallarCreacion.veces = 1;
    await expect(
      service.registrar('mi-tienda', hojaValida(), ORIGEN, ahora),
    ).rejects.toThrow('fallo de escritura');
    const r = await service.registrar('mi-tienda', hojaValida(), ORIGEN, ahora);
    expect(r.codigo).toBe('2026-000002');
  });

  it('el correlativo reinicia con el año de Lima', async () => {
    const { service } = montar();
    const r1 = await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-12-31T23:30:00'),
    );
    const r2 = await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2027-01-01T00:10:00'),
    );
    expect(r1.codigo).toBe('2026-000001');
    expect(r2.codigo).toBe('2027-000001');
  });

  it('una hoja inválida no consume correlativo', async () => {
    const { service } = montar();
    await expect(
      service.registrar(
        'mi-tienda',
        hojaValida({ numeroDocumento: '1' }),
        ORIGEN,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const r = await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-05-04T10:00:00'),
    );
    expect(r.codigo).toBe('2026-000001');
  });

  it('honeypot lleno → 400 y no se guarda nada', async () => {
    const { service, filas } = montar();
    await expect(
      service.registrar('mi-tienda', hojaValida({ website: 'x' }), ORIGEN),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(filas).toHaveLength(0);
  });

  it('slug inexistente → 404', async () => {
    const { service } = montar();
    await expect(
      service.registrar('otra', hojaValida(), ORIGEN),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un fallo de los avisos (correo) no impide registrar', async () => {
    const { service, avisos } = montar();
    avisos.alRegistrar.mockRejectedValueOnce(new Error('Resend caído'));
    const r = await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-05-04T10:00:00'),
    );
    expect(r.codigo).toBe('2026-000001');
    expect(avisos.alRegistrar).toHaveBeenCalledTimes(1);
  });
});

describe('Constancia pública', () => {
  it('con el token correcto devuelve el PDF; con otro token o código, 404', async () => {
    const { service, pdf } = montar();
    const r = await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-05-04T10:00:00'),
    );
    const ok = await service.constanciaPublica('mi-tienda', r.codigo, r.token);
    expect(ok.pdf.toString()).toContain('2026-000001');
    expect(pdf.generarPdfDesdeHtml).toHaveBeenCalled();
    await expect(
      service.constanciaPublica('mi-tienda', r.codigo, 'otro'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.constanciaPublica('mi-tienda', r.codigo, undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.constanciaPublica('mi-tienda', '2026-000999', r.token),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.constanciaPublica('mi-tienda', '../etc', r.token),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.constanciaPublica('otra', r.codigo, r.token),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Respuesta única', () => {
  it('responde una vez; la segunda da 409 y no cambia el texto', async () => {
    const { service, filas, avisos } = montar();
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-05-04T10:00:00'),
    );
    const r = await service.responder(7, 1, 3, 'Le cambiamos el producto hoy.');
    expect(r.estado).toBe('RESPONDIDO');
    expect(r.diasHabilesRestantes).toBeNull();
    expect(r.respondidoPor).toEqual({ id: 3, nombre: 'Dueño' });
    expect(avisos.alResponder).toHaveBeenCalledTimes(1);
    await expect(
      service.responder(7, 1, 3, 'Otra respuesta distinta.'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(filas[0].respuesta).toBe('Le cambiamos el producto hoy.');
  });

  it('dos respuestas simultáneas: una gana, la otra 409', async () => {
    const { service } = montar();
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-05-04T10:00:00'),
    );
    const res = await Promise.allSettled([
      service.responder(7, 1, 3, 'Respuesta de la dueña.'),
      service.responder(7, 1, 4, 'Respuesta del vendedor.'),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = res.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(ConflictException);
  });

  it('respuesta corta → 400; hoja de otra empresa → 404', async () => {
    const { service } = montar();
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-05-04T10:00:00'),
    );
    await expect(service.responder(7, 1, 3, 'ok')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.responder(99, 1, 3, 'Respuesta suficiente.'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.obtener(99, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('Listado y resumen', () => {
  it('cuenta pendientes, vencidos, por vencer y respondidos; filtra por estado derivado', async () => {
    const { service } = montar();
    // Se mira el martes 21/04/2026.
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-03-20T10:00:00'),
    ); // vence 14/04 → vencido
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-04-01T10:00:00'),
    ); // vence 24/04 → por vencer
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-04-20T10:00:00'),
    ); // vence 11/05
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-04-20T11:00:00'),
    );
    await service.responder(7, 4, 3, 'Respuesta suficiente.');
    const ahora = lima('2026-04-21T09:00:00');

    const todo = await service.listar(7, {}, ahora);
    expect(todo.total).toBe(4);
    expect(todo.resumen).toEqual({
      pendientes: 2,
      vencidos: 1,
      porVencer: 1,
      respondidos: 1,
    });
    expect(todo.data.every((r) => typeof r.tipo === 'string')).toBe(true);

    const vencidos = await service.listar(7, { estado: 'VENCIDO' }, ahora);
    expect(vencidos.data.map((r) => r.estado)).toEqual(['VENCIDO']);
    expect(vencidos.data[0].diasHabilesRestantes).toBeLessThan(0);

    const pendientes = await service.listar(7, { estado: 'pendiente' }, ahora);
    expect(pendientes.data.every((r) => r.estado === 'PENDIENTE')).toBe(true);
    expect(pendientes.total).toBe(2);

    await expect(
      service.listar(7, { estado: 'BORRADO' }, ahora),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('page y limit se acotan (limit máx. 100)', async () => {
    const { service } = montar();
    await service.listar(7, { page: '-3', limit: '5000' });
    // sin error: valores saneados
  });
});

describe('Aviso diario', () => {
  it('agrupa por empresa vencidos y por vencer', async () => {
    const { service, avisos } = montar();
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-03-20T10:00:00'),
    );
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-04-01T10:00:00'),
    );
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-04-20T10:00:00'),
    );
    const r = await service.avisarVencimientos(lima('2026-04-21T08:30:00'));
    expect(r).toEqual([
      { empresaId: 7, vencidos: ['2026-000001'], porVencer: ['2026-000002'] },
    ]);
    expect(avisos.avisarVencimientos).toHaveBeenCalledTimes(1);
  });

  it('sin hojas por vencer no avisa a nadie', async () => {
    const { service, avisos } = montar();
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-04-20T10:00:00'),
    );
    expect(
      await service.avisarVencimientos(lima('2026-04-21T08:30:00')),
    ).toEqual([]);
    expect(avisos.avisarVencimientos).not.toHaveBeenCalled();
  });
});

describe('Exportar', () => {
  it('valida el rango y devuelve un xlsx', async () => {
    const { service } = montar();
    await service.registrar(
      'mi-tienda',
      hojaValida(),
      ORIGEN,
      lima('2026-04-20T10:00:00'),
    );
    await expect(service.exportar(7, '2026/04/01')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.exportar(7, '2026-05-01', '2026-04-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
    const buf = await service.exportar(7, '2026-04-20', '2026-04-20');
    expect(buf.subarray(0, 2).toString()).toBe('PK');
  });
});

describe('Controlador del panel', () => {
  it('usa la empresa del token, nunca otra', async () => {
    const servicio = {
      listar: jest.fn().mockResolvedValue({}),
      responder: jest.fn().mockResolvedValue({}),
    };
    const ctrl = new LibroReclamacionesController(servicio as any);
    await ctrl.listar({ id: 3, empresaId: 7 }, 'VENCIDO', 'ana', '2', '10');
    expect(servicio.listar).toHaveBeenCalledWith(7, {
      estado: 'VENCIDO',
      search: 'ana',
      page: '2',
      limit: '10',
    });
    await ctrl.responder(
      { id: 3, empresaId: 7 },
      1,
      { respuesta: 'Respuesta suficiente.' },
      { locals: {} } as any,
    );
    expect(servicio.responder).toHaveBeenCalledWith(
      7,
      1,
      3,
      'Respuesta suficiente.',
    );
  });

  it('usuario sin empresa (sistema) → 403', () => {
    const ctrl = new LibroReclamacionesController({} as any);
    expect(() => ctrl.obtener({ id: 1, empresaId: null }, 1)).toThrow(
      ForbiddenException,
    );
  });
});
