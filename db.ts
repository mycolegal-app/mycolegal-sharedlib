// @mycolegal-app/sharedlib/db — singleton de PrismaClient compartido por las 10
// apps de usuario final (bloque byte-idéntico extraído de cada `src/lib/db.ts`).
//
// El patrón globalThis evita agotar el pool de conexiones en dev (HMR recrea
// módulos): se cachea la instancia en `globalThis` fuera de producción.
//
// `@prisma/client` es peerDependency OPCIONAL: en runtime resuelve al cliente
// generado por la app consumidora (cada app tiene su propio mirror del schema
// canónico de mycolegal-platform). Por eso aquí no se importa ningún tipo de
// modelo concreto.
//
// `withOrgScope` (la extensión multi-tenant) NO se extrae: diverge entre apps
// — la variante "smart" filtra por `Prisma.dmmf` los modelos que realmente
// tienen columna `orgId`, mientras otras la inyectan en todos. Cada app la
// mantiene local sobre este `prisma`.
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
