/**
 * Sembrado compartido para las QA funcionales.
 *
 * Existe por un error que se pagó caro: cada suite insertaba su `Empresa` con
 * las dos o tres columnas que le interesaban. Funcionó mientras la base de QA
 * fue una copia vieja con esas columnas nullables. Contra el esquema actual
 * —donde `ruc`, `direccion`, `fechaActivacion`, `fechaExpiracion` y `planId`
 * son NOT NULL— las tres suites se cayeron a la vez.
 *
 * Lo grave no fue que se cayeran: fue que durante ese tiempo estuvieron
 * pasando contra un esquema que ya no era el de producción, dando una
 * confianza que no correspondía. Con un sembrador único, el día que aparezca
 * otra columna obligatoria falla UN archivo y se arregla UNA vez.
 */
import type { PrismaClient } from '@prisma/client';

/** Id del plan de prueba. Fuera del rango de los reales. */
export const PLAN_QA = 900;

/** Todas las empresas de QA viven de 9000 para arriba, para poder borrarlas. */
export const PRIMER_ID_QA = 9000;

export async function sembrarCatalogos(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Plan" (id,nombre) VALUES ($1,'PLAN QA') ON CONFLICT (id) DO NOTHING`,
    PLAN_QA,
  );
  for (const [id, codigo, desc] of [
    [1, '1', 'DNI'],
    [2, '6', 'RUC'],
    [3, '4', 'CARNET DE EXTRANJERIA'],
    [4, '0', 'OTROS'],
    [5, '7', 'PASAPORTE'],
  ] as [number, string, string][]) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TipoDocumento" (id,codigo,descripcion) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
      id, codigo, desc,
    );
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TipoOperacion" (id,codigo,descripcion) VALUES (1,'0101','VENTA INTERNA') ON CONFLICT (id) DO NOTHING`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "UnidadMedida" (codigo,nombre) VALUES ('NIU','UNIDAD') ON CONFLICT (codigo) DO NOTHING`,
  );
  // Las QA de kardex y soporte buscan "un usuario cualquiera" para firmar los
  // movimientos. Sin él fallaban con "falta catálogo base en la BD local" y la
  // suite entera quedaba sin correr.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Usuario" (nombre,dni,celular,email,password,rol)
     SELECT 'USUARIO QA','00000000','999999999','qa@local.test','x','ADMIN_EMPRESA'
     WHERE NOT EXISTS (SELECT 1 FROM "Usuario" WHERE email='qa@local.test')`,
  );
}

/**
 * El catálogo mínimo que esperan las QA heredadas (kardex, soporte,
 * comisiones): un plan, una unidad y un usuario. Se expone aparte porque esas
 * suites no usan el resto del sembrado.
 */
export const sembrarCatalogoBase = sembrarCatalogos;

/**
 * Una empresa válida según el esquema de hoy.
 *
 * El RUC se deriva del id para que sea único sin que cada suite tenga que
 * inventarse uno: dos empresas con el mismo RUC romperían por otra razón y
 * costaría ver que el problema era el fixture.
 */
export async function sembrarEmpresa(
  prisma: PrismaClient,
  id: number,
  razonSocial: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Empresa" (id,ruc,"razonSocial",direccion,"fechaActivacion","fechaExpiracion","planId")
     VALUES ($1,$2,$3,'Av. QA 123',now(),now() + interval '1 year',$4)
     ON CONFLICT (id) DO NOTHING`,
    id, String(20600000000 + id), razonSocial, PLAN_QA,
  );
}

/** Deja la base como estaba. Respeta el orden de las claves foráneas. */
export async function limpiar(prisma: PrismaClient, desde = PRIMER_ID_QA): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "DetalleComprobante" WHERE "comprobanteId" IN (SELECT id FROM "Comprobante" WHERE "empresaId" >= $1)`, desde).catch(() => undefined);
  for (const tabla of ['IdempotenciaApi', 'ApiKeyLogistica', 'WebhookEndpointLogistica', 'Comprobante', 'Cliente']) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "empresaId" >= $1`, desde).catch(() => undefined);
  }
  // La auto-relación primero: una empresa no se borra mientras otra la apunte.
  await prisma.$executeRawUnsafe(`UPDATE "Empresa" SET "integradorId" = NULL WHERE id >= $1`, desde);
  await prisma.$executeRawUnsafe(`DELETE FROM "Empresa" WHERE id >= $1`, desde);
}
