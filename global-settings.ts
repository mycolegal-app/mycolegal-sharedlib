// @mycolegal-app/sharedlib/global-settings — LECTURA de parámetros globales.
//
// `ConfiguracionGlobal` es un almacén clave→valor GLOBAL (sin orgId), versionado
// por fecha, que el SuperAdmin edita desde Admin → Datos globales. Las claves
// válidas (tipo/categoría/label/default) se declaran en platform
// (`src/lib/global-settings-registry.ts`), que es el lado de ESCRITURA.
//
// Este módulo es el lado de LECTURA para las apps de negocio. Lee directo por
// Prisma — notaria/legifirma comparten la BD `mycolegal_app` con platform, así
// que no hace falta HTTP (mismo enfoque que `resolverImpuesto` en legifirma).
//
// Semántica idéntica al endpoint `/internal/global/settings`: el valor efectivo
// en una fecha es la fila con max(`vigenciaDesde`) ≤ fecha; si la org no ha
// fijado ninguna, se usa el `fallback` que aporta el consumidor (su constante
// legal de respaldo, p.ej. `ESCALA_N2_DEFAULT`). Para los parámetros no
// versionados la única fila lleva la sentinela 1970-01-01, que también es ≤ hoy.
//
// `@prisma/client` es peerDependency OPCIONAL: en runtime resuelve al cliente
// generado por la app, que debe declarar el modelo `ConfiguracionGlobal` en su
// `schema.prisma` (solo `prisma generate`; platform es dueño de la migración).

import { prisma } from './db';

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Cualquier cliente Prisma del consumidor (singleton o tx) con el modelo. */
export type GlobalSettingsDb = typeof prisma | TransactionClient;

/** Valor crudo (string) vigente en `fecha`, o `null` si la org no lo ha fijado. */
export async function getGlobalSettingRaw(
  db: GlobalSettingsDb,
  clave: string,
  fecha: Date = new Date(),
): Promise<string | null> {
  const row = await db.configuracionGlobal.findFirst({
    where: { clave, vigenciaDesde: { lte: fecha } },
    orderBy: { vigenciaDesde: 'desc' },
    select: { valor: true },
  });
  return row?.valor ?? null;
}

/** Número global vigente, o `fallback` si no hay fila / no parsea. */
export async function getGlobalSettingNumber(
  db: GlobalSettingsDb,
  clave: string,
  fallback: number,
  fecha?: Date,
): Promise<number> {
  const raw = await getGlobalSettingRaw(db, clave, fecha);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}

/** Booleano global vigente (`'true'`), o `fallback` si no hay fila. */
export async function getGlobalSettingBoolean(
  db: GlobalSettingsDb,
  clave: string,
  fallback: boolean,
  fecha?: Date,
): Promise<boolean> {
  const raw = await getGlobalSettingRaw(db, clave, fecha);
  if (raw == null) return fallback;
  return raw === 'true';
}

/** Objeto JSON global vigente, o `fallback` si no hay fila / no parsea. */
export async function getGlobalSettingJson<T>(
  db: GlobalSettingsDb,
  clave: string,
  fallback: T,
  fecha?: Date,
): Promise<T> {
  const raw = await getGlobalSettingRaw(db, clave, fecha);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
