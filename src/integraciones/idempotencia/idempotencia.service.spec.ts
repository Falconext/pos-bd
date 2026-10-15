/**
 * La parte de la idempotencia que no se puede probar sin pensar en la base:
 * qué pasa cuando DOS reintentos llegan a la vez.
 *
 * La decisión pura ya está probada aparte. Lo que se defiende acá es la
 * reserva: se hace con un INSERT contra el índice único (empresaId, clave) y
 * no con un "leer y después escribir". Entre leer y escribir caben dos
 * reintentos, y los dos emitirían — que es exactamente lo que esta tabla
 * existe para impedir.
 */
import { IdempotenciaService } from './idempotencia.service';
import { huellaDelCuerpo } from './idempotencia';

const CUERPO = { issuer_id: 'iss_1', document_type: 'invoice', items: [{ unit_value: 1000 }] };

function armar(filaPrevia: Record<string, unknown> | null = null) {
  const estado = { fila: filaPrevia as any };
  const prisma: any = {
    idempotenciaApi: {
      create: jest.fn(async ({ data }: any) => {
        if (estado.fila) {
          const e: any = new Error('unique');
          e.code = 'P2002';
          throw e;
        }
        estado.fila = { id: 1, estadoHttp: null, respuesta: null, ...data };
        return estado.fila;
      }),
      findUnique: jest.fn(async () => estado.fila),
      update: jest.fn(async ({ data }: any) => {
        estado.fila = { ...estado.fila, ...data };
        return estado.fila;
      }),
      deleteMany: jest.fn(async () => {
        const habia = estado.fila && estado.fila.estadoHttp === null;
        if (habia) estado.fila = null;
        return { count: habia ? 1 : 0 };
      }),
    },
  };
  return { servicio: new IdempotenciaService(prisma), prisma, estado };
}

const base = { empresaId: 89, clave: 'ORD-10482', metodo: 'POST', ruta: '/invoices', cuerpo: CUERPO };
const futuro = () => new Date(Date.now() + 60_000);

describe('reservar la clave', () => {
  it('la primera llamada ejecuta', async () => {
    const { servicio } = armar();
    await expect(servicio.reservar(base)).resolves.toEqual({ tipo: 'nueva' });
  });

  it('reserva con INSERT, no leyendo primero', async () => {
    // Si leyera antes de escribir, dos reintentos simultáneos verían "no hay
    // nada" y emitirían los dos. El INSERT contra el índice único es lo que
    // hace que solo uno gane.
    const { servicio, prisma } = armar();
    await servicio.reservar(base);
    expect(prisma.idempotenciaApi.create).toHaveBeenCalled();
    expect(prisma.idempotenciaApi.findUnique).not.toHaveBeenCalled();
  });

  it('el segundo simultáneo NO ejecuta: espera, no emite', async () => {
    const { servicio } = armar({
      huella: huellaDelCuerpo(CUERPO),
      estadoHttp: null,
      respuesta: null,
      expiraEn: futuro(),
    });
    await expect(servicio.reservar(base)).resolves.toEqual({ tipo: 'en_curso' });
  });

  it('el reintento posterior recibe lo guardado sin volver a emitir', async () => {
    const { servicio } = armar({
      huella: huellaDelCuerpo(CUERPO),
      estadoHttp: 202,
      respuesta: { id: 'inv_1', full_number: 'F001-00001234' },
      expiraEn: futuro(),
    });
    await expect(servicio.reservar(base)).resolves.toEqual({
      tipo: 'repetida',
      estadoHttp: 202,
      respuesta: { id: 'inv_1', full_number: 'F001-00001234' },
    });
  });

  it('la misma clave con otro cuerpo es conflicto', async () => {
    const { servicio } = armar({
      huella: huellaDelCuerpo({ otra: 'cosa' }),
      estadoHttp: 202,
      respuesta: { id: 'inv_1' },
      expiraEn: futuro(),
    });
    await expect(servicio.reservar(base)).resolves.toEqual({ tipo: 'conflicto' });
  });

  it('una clave vencida se reusa con update, no borrando e insertando', async () => {
    // Borrar e insertar abre una ventana en la que la clave no existe: un
    // tercer request simultáneo también la reservaría.
    const { servicio, prisma } = armar({
      id: 7,
      huella: huellaDelCuerpo({ viejo: true }),
      estadoHttp: 202,
      respuesta: { id: 'viejo' },
      expiraEn: new Date(Date.now() - 1),
    });
    await expect(servicio.reservar(base)).resolves.toEqual({ tipo: 'nueva' });
    expect(prisma.idempotenciaApi.update).toHaveBeenCalled();
    expect(prisma.idempotenciaApi.deleteMany).not.toHaveBeenCalled();
    const data = prisma.idempotenciaApi.update.mock.calls[0][0].data;
    expect(data.estadoHttp).toBeNull();
    expect(data.huella).toBe(huellaDelCuerpo(CUERPO));
  });

  it('un error que no sea de clave duplicada se propaga', async () => {
    const { servicio, prisma } = armar();
    prisma.idempotenciaApi.create.mockRejectedValue(
      Object.assign(new Error('sin conexión'), { code: 'P1001' }),
    );
    await expect(servicio.reservar(base)).rejects.toThrow('sin conexión');
  });
});

describe('guardar la respuesta', () => {
  it('guarda un 202 para el próximo reintento', async () => {
    const { servicio, prisma } = armar();
    await servicio.reservar(base);
    await servicio.guardarRespuesta({ empresaId: 89, clave: 'ORD-10482', estadoHttp: 202, respuesta: { id: 'inv_1' } });
    expect(prisma.idempotenciaApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estadoHttp: 202, respuesta: { id: 'inv_1' } } }),
    );
  });

  it('guarda también un 422: va a repetirse igual', async () => {
    const { servicio, prisma } = armar();
    await servicio.reservar(base);
    await servicio.guardarRespuesta({ empresaId: 89, clave: 'ORD-10482', estadoHttp: 422, respuesta: { code: 'invalid_ruc' } });
    expect(prisma.idempotenciaApi.update).toHaveBeenCalled();
  });

  it('un 5xx libera la reserva en vez de guardarla', async () => {
    // Si quedara reservada, el integrador recibiría 409 durante 24 horas por
    // una falla nuestra de hace un segundo, sin más salida que cambiar la clave.
    const { servicio, prisma, estado } = armar();
    await servicio.reservar(base);
    await servicio.guardarRespuesta({ empresaId: 89, clave: 'ORD-10482', estadoHttp: 503, respuesta: null });
    expect(prisma.idempotenciaApi.deleteMany).toHaveBeenCalled();
    expect(prisma.idempotenciaApi.update).not.toHaveBeenCalled();
    expect(estado.fila).toBeNull();
  });

  it('tras un 5xx, el reintento vuelve a ejecutar', async () => {
    const { servicio } = armar();
    await servicio.reservar(base);
    await servicio.guardarRespuesta({ empresaId: 89, clave: 'ORD-10482', estadoHttp: 500, respuesta: null });
    await expect(servicio.reservar(base)).resolves.toEqual({ tipo: 'nueva' });
  });

  it('si la base falla al guardar, no tumba la respuesta al integrador', async () => {
    // Ya se emitió: perder el registro de idempotencia es malo, perder la
    // respuesta de una factura emitida es peor.
    const { servicio, prisma } = armar();
    await servicio.reservar(base);
    prisma.idempotenciaApi.update.mockRejectedValue(new Error('timeout'));
    await expect(
      servicio.guardarRespuesta({ empresaId: 89, clave: 'ORD-10482', estadoHttp: 202, respuesta: {} }),
    ).resolves.toBeUndefined();
  });
});

describe('los 409 que ve el integrador', () => {
  it('el de clave reusada dice qué hacer', () => {
    const e: any = IdempotenciaService.conflicto();
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse().code).toBe('idempotency_key_reused');
    expect(e.getResponse().message).toMatch(/clave nueva/i);
  });

  it('el de solicitud en curso invita a reintentar, no a cambiar la clave', () => {
    const e: any = IdempotenciaService.enCurso();
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse().code).toBe('idempotency_request_in_progress');
    expect(e.getResponse().message).toMatch(/reintenta/i);
  });
});
