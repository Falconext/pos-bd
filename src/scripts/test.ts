import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();
prisma.producto
  .count({ where: { atributosTecnicos: { string_contains: 'SERVICIO' } } })
  .then(console.log)
  .catch((e) => console.log(e.message))
  .finally(() => process.exit(0));
