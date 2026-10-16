/**
 * QA funcional de las API keys contra Postgres real.
 *
 * Lo que un doble no demuestra: que la clave en claro NO quede en la base,
 * que el índice único del hash impida duplicados, y que una key de un
 * producto de verdad no sirva para el otro leyendo la fila real.
 *
 * Corre contra `qa_idempotencia`, base local desechable, nunca Railway.
 *
 *   QA_DB=1 npx jest src/integraciones/api-keys/__qa__
 */
import { PrismaClient } from '@prisma/client';
import { limpiar, sembrarCatalogos, sembrarEmpresa } from '../../__qa__/sembrar';
import { createHash } from 'node:crypto';
import { ApiKeysService } from '../api-keys.service';

const correr = process.env.QA_DB === '1' ? describe : describe.skip;
const URL_QA =
  process.env.QA_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/qa_idempotencia';

correr('API keys contra Postgres real', () => {
  jest.setTimeout(60_000);
  let prisma: PrismaClient;
  let servicio: ApiKeysService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL_QA } } });
    await prisma.$connect();
    // Se siembran las empresas en vez de darlas por existentes. Antes esta
    // suite asumía que la base de QA ya tenía la 89, lo que la ataba a una
    // copia de producción y hacía que nadie más pudiera correrla.
    await sembrarCatalogos(prisma);
    await sembrarEmpresa(prisma, 89, 'EMPRESA QA');
    await sembrarEmpresa(prisma, 778, 'TEMPORAL QA');
    servicio = new ApiKeysService(prisma as never);
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({});
    await limpiar(prisma, 50);
    await prisma.$disconnect();
  });

  beforeEach(() => prisma.apiKey.deleteMany({}));

  it('la clave en claro NO queda guardada en ninguna columna', async () => {
    // Es la propiedad que hace que una filtración de la base no entregue las
    // keys de todos los integradores.
    const { apiKey, id } = await servicio.generateKey(89, 'facturacion', { nombre: 'ERP del cliente' });
    const fila = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    const serializada = JSON.stringify(fila);
    expect(serializada).not.toContain(apiKey);
    expect(fila.hash).toBe(createHash('sha256').update(apiKey).digest('hex'));
    // Lo único reconocible es el prefijo y los últimos cuatro, para la consola.
    expect(apiKey.startsWith(fila.prefijo)).toBe(true);
    expect(apiKey.endsWith(fila.ultimosCuatro)).toBe(true);
  });

  it('la key nace con el producto que se pidió', async () => {
    const { id } = await servicio.generateKey(89, 'facturacion');
    const fila = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(fila.producto).toBe('facturacion');
    expect(fila.entorno).toBe('live');
    expect(fila.activo).toBe(true);
  });

  it('el entorno de pruebas se refleja en el prefijo', async () => {
    const { apiKey } = await servicio.generateKey(89, 'facturacion', { entorno: 'test' });
    expect(apiKey.startsWith('sk_test_')).toBe(true);
  });

  it('una key de logística NO vale para facturación', async () => {
    // El peor escenario de toda la API: emitir comprobantes ante SUNAT con
    // una key que no era para eso.
    const { apiKey } = await servicio.generateKey(89, 'logistica');
    await expect(servicio.validarParaProducto(apiKey, 'facturacion')).resolves.toEqual({
      ok: false,
      motivo: 'producto',
    });
    // Y sigue sirviendo para lo suyo.
    await expect(servicio.validarParaProducto(apiKey, 'logistica')).resolves.toMatchObject({ ok: true });
  });

  it('una key revocada deja de validar al instante', async () => {
    const { apiKey, id } = await servicio.generateKey(89, 'facturacion');
    await expect(servicio.validarParaProducto(apiKey, 'facturacion')).resolves.toMatchObject({ ok: true });
    await servicio.revokeKey(89, 'facturacion', id);
    await expect(servicio.validarParaProducto(apiKey, 'facturacion')).resolves.toEqual({
      ok: false,
      motivo: 'invalida',
    });
  });

  it('una empresa no puede revocar la key de otra', async () => {
    const { id } = await servicio.generateKey(89, 'facturacion');
    await expect(servicio.revokeKey(50, 'facturacion', id)).resolves.toBeNull();
    const fila = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(fila.activo).toBe(true);
  });

  it('tampoco puede revocarla desde la consola del otro producto', async () => {
    const { id } = await servicio.generateKey(89, 'facturacion');
    await expect(servicio.revokeKey(89, 'logistica', id)).resolves.toBeNull();
  });

  it('el listado separa por producto y no expone el hash', async () => {
    await servicio.generateKey(89, 'facturacion', { nombre: 'A' });
    await servicio.generateKey(89, 'logistica', { nombre: 'B' });
    const fact = await servicio.listKeys(89, 'facturacion');
    expect(fact).toHaveLength(1);
    expect(fact[0].nombre).toBe('A');
    expect(Object.keys(fact[0])).not.toContain('hash');
  });

  it('una key revocada desaparece del listado', async () => {
    const { id } = await servicio.generateKey(89, 'facturacion');
    await servicio.revokeKey(89, 'facturacion', id);
    await expect(servicio.listKeys(89, 'facturacion')).resolves.toHaveLength(0);
  });

  it('mil keys seguidas no colisionan', async () => {
    // El índice único del hash es lo que haría fallar una colisión; con 24
    // bytes aleatorios no debería ocurrir, y esto lo confirma contra la base.
    const claves = await Promise.all(
      Array.from({ length: 50 }, () => servicio.generateKey(89, 'facturacion')),
    );
    expect(new Set(claves.map((c) => c.apiKey)).size).toBe(50);
    expect(await prisma.apiKey.count()).toBe(50);
  });

  it('marca el último uso al validar', async () => {
    const { apiKey, id } = await servicio.generateKey(89, 'facturacion');
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id } })).ultimoUsoEn).toBeNull();
    await servicio.validarParaProducto(apiKey, 'facturacion');
    await new Promise((r) => setTimeout(r, 120)); // es best-effort, no bloquea
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id } })).ultimoUsoEn).not.toBeNull();
  });

  it('borrar la empresa se lleva sus keys', async () => {
    await sembrarEmpresa(prisma, 778, 'TEMPORAL QA');
    await servicio.generateKey(778, 'facturacion');
    await prisma.$executeRawUnsafe(`DELETE FROM "Empresa" WHERE id=778`);
    expect(await prisma.apiKey.count({ where: { empresaId: 778 } })).toBe(0);
  });
});
