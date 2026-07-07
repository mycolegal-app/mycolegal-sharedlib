// Motor de seeds idempotentes ejecutados en el ARRANQUE del servicio (decisión
// jul-2026: sustituir el modelo de "seed vía endpoint disparado a mano").
//
// Dos clases de unidad:
//  - L1 (ensure-exists): sin `once`. Re-corre cuando sube `version`. Semántica
//    create-if-absent; nunca muta/reactiva/borra lo que el admin haya tocado.
//  - L2 (provisión de entorno): `once: true`. Corre SOLO si nunca se aplicó. Un
//    bump de versión NO lo re-dispara → nunca resucita datos borrados a posteriori.
//
// Garantías del runner:
//  1. Serializado entre instancias de Cloud Run vía advisory lock de Postgres
//     (`pg_advisory_xact_lock`), que se libera solo al cerrar la transacción.
//  2. Idempotencia + versionado en la tabla `SeedState` (cada app la declara).
//  3. NUNCA lanza: un fallo de seed (o la tabla aún inexistente en el primer boot
//     antes del `db push`) no debe tumbar el arranque; se reintenta en el siguiente.

export interface SeedUnit {
  /** Clave estable (única por app). Se persiste en SeedState.name. */
  name: string;
  /** Versión del contenido. En L1, subirla re-ejecuta la unidad. */
  version: number;
  /** L2: true = provisión única (corre solo si nunca se aplicó). */
  once?: boolean;
  /** Trabajo idempotente. Recibe el cliente transaccional de Prisma. */
  run: (tx: any) => Promise<void>;
}

/** Resumen del paso de seeds (para el disparo manual desde ops). */
export interface SeedRunSummary {
  applied: string[];
  skipped: string[];
  error?: string;
}

// Clave de lock estable a partir del appSlug (31 bits → cabe en bigint de Postgres).
function advisoryKey(appSlug: string): number {
  let h = 0;
  for (let i = 0; i < appSlug.length; i++) h = (Math.imul(31, h) + appSlug.charCodeAt(i)) | 0;
  return Math.abs(h) % 2147483647;
}

/**
 * Ejecuta las unidades de seed en una única transacción bajo advisory lock.
 * `prisma` es el PrismaClient de la app (debe exponer el modelo `SeedState`).
 * `opts.force` = nombres de unidad a re-ejecutar aunque ya estén aplicadas
 * (disparo manual desde ops). Devuelve el resumen; NUNCA lanza.
 */
export async function runStartupSeeds(
  prisma: any,
  units: SeedUnit[],
  opts: { appSlug: string; force?: string[]; log?: (msg: string) => void },
): Promise<SeedRunSummary> {
  const log = opts.log ?? ((m: string) => console.log(`[seeds] ${m}`));
  if (!units.length) return { applied: [], skipped: [] };
  const forceSet = new Set(opts.force ?? []);
  const names = units.map((u) => u.name);

  // Pre-check barato (sin lock ni tx de escritura): en régimen normal el arranque
  // solo hace UN read y sale. Solo si hay algo pendiente (o `force`) abrimos la
  // transacción con advisory lock. Reduce overhead y locks retenidos en autoscale.
  if (forceSet.size === 0) {
    try {
      const rows = await prisma.seedState.findMany({
        where: { name: { in: names } },
        select: { name: true, version: true },
      });
      const byName = new Map(rows.map((r: { name: string; version: number }) => [r.name, r]));
      const anyPending = units.some((u) => {
        const prev = byName.get(u.name);
        return u.once ? !prev : !prev || prev.version < u.version;
      });
      if (!anyPending) return { applied: [], skipped: names };
    } catch {
      // Tabla aún inexistente (primer boot antes de la migración) o error de
      // lectura: caemos al camino con tx, que también lo captura sin lanzar.
    }
  }

  try {
    return await prisma.$transaction(
      async (tx: any): Promise<SeedRunSummary> => {
        // Serializa el arranque de todas las instancias contra la misma BD.
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock($1)", advisoryKey(opts.appSlug));
        const applied: string[] = [];
        const skipped: string[] = [];
        for (const u of units) {
          const prev = await tx.seedState.findUnique({ where: { name: u.name } });
          const forced = forceSet.has(u.name);
          const shouldRun = forced || (u.once ? !prev : !prev || prev.version < u.version);
          if (!shouldRun) {
            skipped.push(u.name);
            continue;
          }
          await u.run(tx);
          await tx.seedState.upsert({
            where: { name: u.name },
            create: { name: u.name, version: u.version },
            update: { version: u.version },
          });
          applied.push(u.name);
          log(`applied ${u.name} v${u.version}${u.once ? " (once)" : ""}${forced ? " [forced]" : ""}`);
        }
        return { applied, skipped };
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  } catch (err) {
    // No propagamos: el arranque no debe caer por un fallo de seed. La tx hace
    // rollback, así que `applied` real es vacío.
    const msg = err instanceof Error ? err.message : String(err);
    log(`ERROR (se reintenta en el próximo arranque): ${msg}`);
    return { applied: [], skipped: [], error: msg };
  }
}
