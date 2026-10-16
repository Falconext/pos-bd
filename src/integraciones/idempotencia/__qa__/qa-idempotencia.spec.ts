/**
 * QA funcional de la idempotencia contra una base Postgres real.
 *
 * Las 52 pruebas unitarias usan dobles, y hay exactamente una cosa que un
 * doble no puede demostrar: que dos requests SIMULTÁNEOS con la misma clave
 * colisionen de verdad en el índice único y solo uno ejecute. Eso depende del
 * motor de la base, no de nuestro código — y es justamente la promesa de toda
 * la pieza.
 *
 * Corre contra `qa_idempotencia`, una base desechable, NUNCA contra Railway.
 * Se salta sola si esa base no existe.
 *
 *   createdb qa_idempotencia && psql -d qa_idempotencia -f \
 *     prisma/migrations/20261015180000_idempotencia_api/migration.sql
 *   QA_DB=1 npx jest src/integraciones/idempotencia/__qa__
 */
import { PrismaClient } from '@prisma/client';
import { limpiar, sembrarCatalogos, sembrarEmpresa } from '../../__qa__/sembrar';
import { IdempotenciaService } from '../idempotencia.service';
import { huellaDelCuerpo } from '../idempotencia';

const correr = process.env.QA_DB === '1' ? describe : describe.skip;

const URL_QA =
  process.env.QA_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/qa_idempotencia';

const FACTURA = {
  issuer_id: 'iss_8Kp2Qm3x',
  document_type: 'invoice',
  customer: { document_type: 'ruc', document_number: '20601234567', name: 'ANDINA S.A.C.' },
  items: [{ description: 'Consultoría', quantity: 1, unit_value: 1000 }],
};

correr('idempotencia contra Postgres real', () => {
  jest.setTimeout(60_000);
  let prisma: PrismaClient;
  let servicio: IdempotenciaService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL_QA } } });
    await prisma.$connect();
    // Siembra propia: antes dependía de que la base de QA ya tuviera estas
    // empresas, lo que la ataba a una copia vieja de producción.
    await sembrarCatalogos(prisma);
    for (const [id, nombre] of [[50, 'EMPRESA A'], [89, 'EMPRESA B'], [777, 'TEMPORAL QA']] as [number, string][]) {
      await sembrarEmpresa(prisma, id, nombre);
    }
    servicio = new IdempotenciaService(prisma as never);
  });

  afterAll(async () => {
    await prisma.idempotenciaApi.deleteMany({});
    await limpiar(prisma, 50);
    await prisma.$disconnect();
  });

  beforeEach(() => prisma.idempotenciaApi.deleteMany({}));

  const base = (clave: string) => ({
    empresaId: 89,
    clave,
    metodo: 'POST',
    ruta: '/invoices',
    cuerpo: FACTURA,
  });

  it('la primera llamada ejecuta y queda reservada', async () => {
    await expect(servicio.reservar(base('k1'))).resolves.toEqual({ tipo: 'nueva' });
    const fila = await prisma.idempotenciaApi.findUnique({
      where: { empresaId_clave: { empresaId: 89, clave: 'k1' } },
    });
    expect(fila).toMatchObject({ huella: huellaDelCuerpo(FACTURA), estadoHttp: null });
    expect(fila!.respuesta).toBeNull();
  });

  it('DIEZ reintentos simultáneos: exactamente UNO ejecuta', async () => {
    // Es la prueba que justifica toda la pieza. Sin el índice único, varios
    // emitirían la misma factura. Con doble no se puede demostrar: depende
    // del motor de la base.
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => servicio.reservar(base('carrera'))),
    );
    const nuevas = resultados.filter((r) => r.tipo === 'nueva');
    expect(nuevas).toHaveLength(1);
    // Los otros nueve esperan, no emiten ni fallan.
    expect(resultados.filter((r) => r.tipo === 'en_curso')).toHaveLength(9);
    expect(await prisma.idempotenciaApi.count({ where: { clave: 'carrera' } })).toBe(1);
  });

  it('el reintento posterior recibe lo guardado sin volver a ejecutar', async () => {
    await servicio.reservar(base('k2'));
    await servicio.guardarRespuesta({
      empresaId: 89,
      clave: 'k2',
      estadoHttp: 202,
      respuesta: { id: 'inv_1', full_number: 'F001-00001234' },
    });
    await expect(servicio.reservar(base('k2'))).resolves.toEqual({
      tipo: 'repetida',
      estadoHttp: 202,
      respuesta: { id: 'inv_1', full_number: 'F001-00001234' },
    });
  });

  it('la misma clave con otro cuerpo es conflicto', async () => {
    await servicio.reservar(base('k3'));
    await servicio.guardarRespuesta({ empresaId: 89, clave: 'k3', estadoHttp: 202, respuesta: { id: 'x' } });
    const otro = { ...base('k3'), cuerpo: { ...FACTURA, document_type: 'receipt' } };
    await expect(servicio.reservar(otro)).resolves.toEqual({ tipo: 'conflicto' });
  });

  it('dos integradores pueden usar la MISMA clave sin pisarse', async () => {
    // La clave la elige el integrador; "ORD-1" es un id obvio y dos clientes
    // distintos van a usarlo el mismo día. Si la unicidad no incluyera la
    // empresa, el segundo recibiría la factura del primero.
    await expect(servicio.reservar({ ...base('ORD-1'), empresaId: 89 })).resolves.toEqual({ tipo: 'nueva' });
    await expect(servicio.reservar({ ...base('ORD-1'), empresaId: 50 })).resolves.toEqual({ tipo: 'nueva' });
    expect(await prisma.idempotenciaApi.count({ where: { clave: 'ORD-1' } })).toBe(2);
  });

  it('tras un 5xx el reintento vuelve a ejecutar de verdad', async () => {
    await servicio.reservar(base('k4'));
    await servicio.guardarRespuesta({ empresaId: 89, clave: 'k4', estadoHttp: 503, respuesta: null });
    expect(await prisma.idempotenciaApi.count({ where: { clave: 'k4' } })).toBe(0);
    await expect(servicio.reservar(base('k4'))).resolves.toEqual({ tipo: 'nueva' });
  });

  it('una clave vencida se reusa sin dejar huecos', async () => {
    await servicio.reservar(base('k5'));
    await servicio.guardarRespuesta({ empresaId: 89, clave: 'k5', estadoHttp: 202, respuesta: { id: 'viejo' } });
    await prisma.idempotenciaApi.updateMany({
      where: { clave: 'k5' },
      data: { expiraEn: new Date(Date.now() - 1000) },
    });
    await expect(servicio.reservar(base('k5'))).resolves.toEqual({ tipo: 'nueva' });
    // Una sola fila en todo momento: nunca se borra para volver a insertar.
    expect(await prisma.idempotenciaApi.count({ where: { clave: 'k5' } })).toBe(1);
    const fila = await prisma.idempotenciaApi.findFirst({ where: { clave: 'k5' } });
    expect(fila!.estadoHttp).toBeNull();
  });

  it('borrar la empresa se lleva sus claves', async () => {
    await sembrarEmpresa(prisma, 777, 'TEMPORAL QA');
    await servicio.reservar({ ...base('k6'), empresaId: 777 });
    await prisma.$executeRawUnsafe(`DELETE FROM "Empresa" WHERE id=777`);
    expect(await prisma.idempotenciaApi.count({ where: { empresaId: 777 } })).toBe(0);
  });

  it('la limpieza borra solo las vencidas', async () => {
    await servicio.reservar(base('viva'));
    await servicio.reservar(base('vencida'));
    await prisma.idempotenciaApi.updateMany({
      where: { clave: 'vencida' },
      data: { expiraEn: new Date(Date.now() - 1000) },
    });
    await expect(servicio.limpiarVencidas()).resolves.toBe(1);
    expect(await prisma.idempotenciaApi.count()).toBe(1);
    expect((await prisma.idempotenciaApi.findFirst())!.clave).toBe('viva');
  });
});
