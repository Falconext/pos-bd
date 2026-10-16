/**
 * QA funcional del aislamiento entre integradores, contra Postgres real.
 *
 * La regla que se prueba acá es la que separa a un integrador de otro: una
 * API key solo emite por los emisores que ESE integrador dio de alta. Si
 * falla, conocer un `issuer_id` ajeno basta para emitir comprobantes ante
 * SUNAT a nombre de otra empresa — y el `issuer_id` viaja en cada request.
 *
 * Con dobles no alcanza: lo que decide es la consulta con `integradorId` en
 * el WHERE, y eso solo se demuestra contra la base.
 *
 *   QA_DB=1 npx jest src/integraciones/emisores/__qa__
 */
import { PrismaClient } from '@prisma/client';
import { limpiar, sembrarCatalogos, sembrarEmpresa } from '../../__qa__/sembrar';
import { ForbiddenException } from '@nestjs/common';
import { EmisoresService } from '../emisores.service';

const correr = process.env.QA_DB === '1' ? describe : describe.skip;
const URL_QA =
  process.env.QA_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/qa_idempotencia';

correr('emisores de un integrador, contra Postgres real', () => {
  jest.setTimeout(60_000);
  let prisma: PrismaClient;
  let servicio: EmisoresService;
  const INTEGRADOR_A = 9001;
  const INTEGRADOR_B = 9002;

  /** Una empresa válida según el esquema de hoy, no según el de la base vieja. */
  const crearEmpresa = (id: number, razon: string) => sembrarEmpresa(prisma, id, razon);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL_QA } } });
    await prisma.$connect();
    await sembrarCatalogos(prisma);
    servicio = new EmisoresService(prisma as never);
  });

  afterAll(async () => {
    await limpiar(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiar(prisma);
    await crearEmpresa(INTEGRADOR_A, 'ERP DEL NORTE SAC');
    await crearEmpresa(INTEGRADOR_B, 'SOFTWARE SUR SAC');
    await crearEmpresa(9010, 'BODEGA LA ESQUINA');
    await crearEmpresa(9011, 'FERRETERIA CENTRAL');
    await crearEmpresa(9020, 'PANADERIA DEL SUR');
  });

  it('vincular le asigna un id público que no revela el id interno', async () => {
    const r = await servicio.vincular(INTEGRADOR_A, 9010);
    expect(r.apiPublicId).toMatch(/^iss_[A-Za-z0-9_-]+$/);
    expect(r.apiPublicId).not.toContain('9010');
    expect(r.integradorId).toBe(INTEGRADOR_A);
  });

  it('un integrador NO puede emitir por el emisor de otro', async () => {
    // El peor escenario: emitir ante SUNAT a nombre de una empresa ajena.
    const { apiPublicId } = await servicio.vincular(INTEGRADOR_A, 9010);
    await expect(
      servicio.resolverParaIntegrador(INTEGRADOR_B, apiPublicId!),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Y para el suyo sí resuelve.
    await expect(
      servicio.resolverParaIntegrador(INTEGRADOR_A, apiPublicId!),
    ).resolves.toMatchObject({ id: 9010 });
  });

  it('un emisor ajeno y uno inexistente dan el MISMO error', async () => {
    // Si se distinguieran, un integrador podría averiguar qué issuer_id son
    // válidos probando y mirando el mensaje.
    const { apiPublicId } = await servicio.vincular(INTEGRADOR_A, 9010);
    const ajeno = await servicio
      .resolverParaIntegrador(INTEGRADOR_B, apiPublicId!)
      .catch((e) => e.getResponse());
    const inexistente = await servicio
      .resolverParaIntegrador(INTEGRADOR_B, 'iss_noexiste')
      .catch((e) => e.getResponse());
    expect(ajeno.code).toBe(inexistente.code);
    expect(ajeno.code).toBe('issuer_forbidden');
  });

  it('no se puede robar un emisor que ya es de otro integrador', async () => {
    await servicio.vincular(INTEGRADOR_A, 9010);
    await expect(servicio.vincular(INTEGRADOR_B, 9010)).rejects.toMatchObject({
      response: { code: 'issuer_already_linked' },
    });
  });

  it('revincular al MISMO integrador conserva el id público', async () => {
    // Cambiarlo rompería las referencias que el integrador guardó.
    const primero = await servicio.vincular(INTEGRADOR_A, 9010);
    const segundo = await servicio.vincular(INTEGRADOR_A, 9010);
    expect(segundo.apiPublicId).toBe(primero.apiPublicId);
  });

  it('un integrador no puede ser emisor de sí mismo', async () => {
    await expect(servicio.vincular(INTEGRADOR_A, INTEGRADOR_A)).rejects.toMatchObject({
      response: { code: 'issuer_self_reference' },
    });
  });

  it('el listado trae solo los propios', async () => {
    await servicio.vincular(INTEGRADOR_A, 9010);
    await servicio.vincular(INTEGRADOR_A, 9011);
    await servicio.vincular(INTEGRADOR_B, 9020);
    const a = await servicio.listar(INTEGRADOR_A);
    expect(a).toHaveLength(2);
    expect(a.map((e) => e.legal_name).sort()).toEqual(['BODEGA LA ESQUINA', 'FERRETERIA CENTRAL']);
    await expect(servicio.listar(INTEGRADOR_B)).resolves.toHaveLength(1);
  });

  it('un emisor sin credenciales de firma sale como pending_setup', async () => {
    // Decirlo antes y con nuestras palabras: si no, la emisión falla recién
    // en el proveedor, con un error que el integrador no puede interpretar.
    const { apiPublicId } = await servicio.vincular(INTEGRADOR_A, 9010);
    const [emisor] = await servicio.listar(INTEGRADOR_A);
    expect(emisor.id).toBe(apiPublicId);
    expect(emisor.status).toBe('pending_setup');

    await prisma.$executeRawUnsafe(`UPDATE "Empresa" SET "usuarioPse"='USR123' WHERE id=9010`);
    await expect(servicio.listar(INTEGRADOR_A)).resolves.toMatchObject([{ status: 'active' }]);
  });

  it('desvincular corta la relación pero NO borra la empresa', async () => {
    // Es un RUC real con comprobantes ante SUNAT: se corta el vínculo
    // comercial, no la historia fiscal.
    const { apiPublicId } = await servicio.vincular(INTEGRADOR_A, 9010);
    await expect(servicio.desvincular(INTEGRADOR_A, apiPublicId!)).resolves.toBe(true);
    const sigue = await prisma.empresa.findUnique({
      where: { id: 9010 },
      select: { id: true, integradorId: true, apiPublicId: true },
    });
    expect(sigue).not.toBeNull();
    expect(sigue!.integradorId).toBeNull();
    await expect(servicio.listar(INTEGRADOR_A)).resolves.toHaveLength(0);
  });

  it('nadie puede desvincular el emisor de otro', async () => {
    const { apiPublicId } = await servicio.vincular(INTEGRADOR_A, 9010);
    await expect(servicio.desvincular(INTEGRADOR_B, apiPublicId!)).resolves.toBe(false);
    await expect(servicio.listar(INTEGRADOR_A)).resolves.toHaveLength(1);
  });

  it('borrar al integrador NO borra a sus emisores', async () => {
    // La FK es SET NULL a propósito: son RUC reales con comprobantes
    // emitidos; lo que se corta es la relación, no la empresa.
    await servicio.vincular(INTEGRADOR_A, 9010);
    await prisma.$executeRawUnsafe(`DELETE FROM "Empresa" WHERE id=${INTEGRADOR_A}`);
    const emisor = await prisma.empresa.findUnique({
      where: { id: 9010 },
      select: { id: true, integradorId: true },
    });
    expect(emisor).not.toBeNull();
    expect(emisor!.integradorId).toBeNull();
  });

  it('dos ids públicos nunca chocan', async () => {
    const ids = new Set(Array.from({ length: 200 }, () => EmisoresService.nuevoPublicId()));
    expect(ids.size).toBe(200);
  });
});
