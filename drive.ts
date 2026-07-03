// @mycolegal-app/sharedlib/drive — helper del catálogo unificado de ficheros
// (Unidad de Red). Chokepoint único: toda alta/carpeta/movimiento/borrado de
// ficheros pasa por aquí, de modo que el catálogo (`DriveNode`) y GCS nunca
// divergen. Ver mycolegal-platform/PLAN_TECNICO_UNIDAD_ARCHIVO.md.
//
// Coexistencia: cada app conserva su tabla de dominio y añade la fila de
// catálogo EN LA MISMA TRANSACCIÓN (misma BD mycolegal_app). Por eso las
// funciones reciben el `db`/`tx` de la app (peer Prisma), tipado con una
// interfaz estructural mínima para ser compatible con el cliente de cada app.
//
// Áreas (derivadas, sin campo `area`):
//   DOCUMENTS → managedBy = slug de app (read-only, poblado por las apps)
//   SHARED    → managedBy null, visibility ORG    ("Espacio compartido")
//   PERSONAL  → managedBy null, visibility PRIVATE ("Mi espacio")

import type { StorageClient } from './storage';

export type DriveArea = 'DOCUMENTS' | 'SHARED' | 'PERSONAL';

export interface DriveNodeRecord {
  id: string;
  orgId: string;
  parentId: string | null;
  type: 'FILE' | 'FOLDER';
  name: string;
  visibility: string;
  ownerUserId: string | null;
  managedBy: string | null;
  rootKey: string | null;
  gcsBucket: string | null;
  gcsPath: string | null;
  mimeType: string | null;
  sizeBytes: bigint | null;
  sha256: string | null;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  createdBy: string | null;
  trashedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Campos escribibles (subconjunto). Da seguridad de nombres sin acoplarse al
// tipo generado por Prisma de cada app.
export interface DriveNodeWriteData {
  orgId?: string;
  parentId?: string | null;
  type?: 'FILE' | 'FOLDER';
  name?: string;
  visibility?: string;
  ownerUserId?: string | null;
  managedBy?: string | null;
  rootKey?: string | null;
  gcsBucket?: string | null;
  gcsPath?: string | null;
  mimeType?: string | null;
  sizeBytes?: bigint | number | null;
  sha256?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  createdBy?: string | null;
  trashedAt?: Date | null;
}

/** Delegate mínimo compatible con `prisma.driveNode` (o el de una tx) de cualquier app. */
export interface DriveNodeDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<DriveNodeRecord | null>;
  findUnique(args: { where: Record<string, unknown> }): Promise<DriveNodeRecord | null>;
  create(args: { data: DriveNodeWriteData }): Promise<DriveNodeRecord>;
  update(args: { where: Record<string, unknown>; data: DriveNodeWriteData }): Promise<DriveNodeRecord>;
  updateMany(args: { where: Record<string, unknown>; data: DriveNodeWriteData }): Promise<{ count: number }>;
}
export interface DriveDb {
  driveNode: DriveNodeDelegate;
}

// ---- Raíces y prefijos físicos por área ------------------------------------

function rootKeyFor(area: DriveArea, app?: string, userId?: string): string {
  if (area === 'DOCUMENTS') return `APP:${app}`;
  if (area === 'PERSONAL') return `MIESPACIO:${userId}`;
  return 'COMPARTIDO';
}

/** Prefijo físico dentro de `{orgId}/…` (sin el orgId). */
function rootPrefixFor(area: DriveArea, app?: string, userId?: string): string {
  if (area === 'DOCUMENTS') return app!;
  if (area === 'PERSONAL') return `_users/${userId}`;
  return '_shared';
}

function areaVisibility(area: DriveArea): string {
  return area === 'PERSONAL' ? 'PRIVATE' : 'ORG';
}

function sanitizeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200) || '_';
}

// ---- Materialización de carpetas (mkdir -p) --------------------------------

export interface AreaContext {
  orgId: string;
  area: DriveArea;
  app?: string; // requerido si area=DOCUMENTS
  userId?: string; // requerido si area=PERSONAL
  createdBy?: string | null;
}

/** Garantiza la raíz del área (FOLDER con rootKey) y devuelve su id. */
async function ensureRoot(db: DriveDb, ctx: AreaContext): Promise<string> {
  const rootKey = rootKeyFor(ctx.area, ctx.app, ctx.userId);
  const existing = await db.driveNode.findFirst({ where: { orgId: ctx.orgId, rootKey } });
  if (existing) return existing.id;
  const created = await db.driveNode.create({
    data: {
      orgId: ctx.orgId,
      parentId: null,
      type: 'FOLDER',
      name: rootKey,
      rootKey,
      visibility: areaVisibility(ctx.area),
      ownerUserId: ctx.area === 'PERSONAL' ? ctx.userId ?? null : null,
      managedBy: ctx.area === 'DOCUMENTS' ? ctx.app ?? null : null,
      createdBy: ctx.createdBy ?? null,
    },
  });
  return created.id;
}

/**
 * mkdir -p: garantiza la cadena de carpetas `segments` bajo la raíz del área y
 * devuelve el id de la carpeta hoja (parentId para el fichero). Segmentos vacíos
 * → devuelve la raíz.
 */
export async function ensureFolderChain(
  db: DriveDb,
  ctx: AreaContext,
  segments: string[],
): Promise<string> {
  let parentId = await ensureRoot(db, ctx);
  for (const raw of segments) {
    const name = raw.trim();
    if (!name) continue;
    const found = await db.driveNode.findFirst({
      where: { orgId: ctx.orgId, parentId, type: 'FOLDER', name, trashedAt: null },
    });
    if (found) {
      parentId = found.id;
      continue;
    }
    const created = await db.driveNode.create({
      data: {
        orgId: ctx.orgId,
        parentId,
        type: 'FOLDER',
        name,
        visibility: areaVisibility(ctx.area),
        ownerUserId: ctx.area === 'PERSONAL' ? ctx.userId ?? null : null,
        managedBy: ctx.area === 'DOCUMENTS' ? ctx.app ?? null : null,
        createdBy: ctx.createdBy ?? null,
      },
    });
    parentId = created.id;
  }
  return parentId;
}

/** Crea una carpeta (posiblemente vacía). Idempotente por (parentId, name). */
export async function mkdir(
  db: DriveDb,
  input: AreaContext & { folderPath?: string[]; name: string },
): Promise<string> {
  const parentId = await ensureFolderChain(db, input, input.folderPath ?? []);
  const existing = await db.driveNode.findFirst({
    where: { orgId: input.orgId, parentId, type: 'FOLDER', name: input.name, trashedAt: null },
  });
  if (existing) return existing.id;
  const created = await db.driveNode.create({
    data: {
      orgId: input.orgId,
      parentId,
      type: 'FOLDER',
      name: input.name,
      visibility: areaVisibility(input.area),
      ownerUserId: input.area === 'PERSONAL' ? input.userId ?? null : null,
      managedBy: input.area === 'DOCUMENTS' ? input.app ?? null : null,
      createdBy: input.createdBy ?? null,
    },
  });
  return created.id;
}

// ---- Alta de ficheros -------------------------------------------------------

export interface StoreFileInput extends AreaContext {
  /** Carpetas (relativas a la raíz del área) donde cuelga el fichero. */
  folderPath?: string[];
  /** Nombre visible del fichero. */
  name: string;
  /** Bytes a subir (server-side) — mutuamente excluyente con `gcsPath`. */
  bytes?: Buffer;
  /** Objeto YA subido (signed-URL) o existente (backfill legacy). */
  gcsPath?: string;
  gcsBucket?: string;
  mime?: string;
  sizeBytes?: bigint | number;
  sha256?: string;
  entity?: { type: string; id: string; label?: string };
  visibility?: string;
}

export interface StoreFileResult {
  nodeId: string;
  gcsPath: string;
}

/**
 * Sube (o registra) un fichero y lo cataloga, atómico con el dominio (la app
 * envuelve su escritura + esta llamada en la misma tx). Idempotente por gcsPath.
 *
 * - `bytes` → sube server-side por el cliente sharedlib (obtiene size+sha256).
 * - `gcsPath` sin bytes → el objeto ya está (signed-URL confirmado o backfill);
 *   si no se pasa `sizeBytes`, se lee de GCS con `confirmUpload`.
 */
export async function storeFile(
  db: DriveDb,
  storage: StorageClient,
  input: StoreFileInput,
): Promise<StoreFileResult> {
  const prefix = rootPrefixFor(input.area, input.app, input.userId);
  const safeName = sanitizeSegment(input.name);

  let gcsPath = input.gcsPath;
  let size: bigint | null = input.sizeBytes != null ? BigInt(input.sizeBytes) : null;
  let sha = input.sha256 ?? null;

  if (input.bytes) {
    // Path físico determinista: {orgId}/{prefix}/{folderPath}/{stamp}-{name}
    const folder = (input.folderPath ?? []).map(sanitizeSegment).join('/');
    gcsPath = [input.orgId, prefix, folder, `${Date.now()}-${safeName}`].filter(Boolean).join('/');
    const up = await storage.uploadBuffer({
      path: gcsPath,
      buffer: input.bytes,
      contentType: input.mime,
      orgId: input.orgId,
    });
    if (!up.ok) throw new Error(`storeFile upload failed: ${up.error}`);
    size = BigInt(up.size ?? input.bytes.length);
    sha = up.sha256 ?? sha;
  } else {
    if (!gcsPath) throw new Error('storeFile requires `bytes` or `gcsPath`');
    if (size == null) {
      const c = await storage.confirmUpload({ path: gcsPath, orgId: input.orgId });
      if (c.ok && c.size != null) size = BigInt(c.size);
    }
  }

  // Carpetas + upsert idempotente por gcsPath.
  const parentId = await ensureFolderChain(db, input, input.folderPath ?? []);
  const existing = await db.driveNode.findUnique({ where: { gcsPath } });
  const data: DriveNodeWriteData = {
    orgId: input.orgId,
    parentId,
    type: 'FILE',
    name: input.name,
    visibility: input.visibility ?? areaVisibility(input.area),
    ownerUserId: input.area === 'PERSONAL' ? input.userId ?? null : null,
    managedBy: input.area === 'DOCUMENTS' ? input.app ?? null : null,
    gcsBucket: input.gcsBucket ?? null,
    gcsPath,
    mimeType: input.mime ?? null,
    sizeBytes: size,
    sha256: sha,
    entityType: input.entity?.type ?? null,
    entityId: input.entity?.id ?? null,
    entityLabel: input.entity?.label ?? null,
    createdBy: input.createdBy ?? null,
    trashedAt: null,
  };

  const node = existing
    ? await db.driveNode.update({ where: { id: existing.id }, data })
    : await db.driveNode.create({ data });
  return { nodeId: node.id, gcsPath: gcsPath! };
}

/**
 * Registra en el catálogo un objeto que YA existe en GCS, sin subir nada
 * (backfill del legacy: 669 GB que no se mueven). El `gcsPath` es el físico real.
 */
export async function linkExisting(
  db: DriveDb,
  input: StoreFileInput & { gcsPath: string },
): Promise<StoreFileResult> {
  const parentId = await ensureFolderChain(db, input, input.folderPath ?? []);
  const existing = await db.driveNode.findUnique({ where: { gcsPath: input.gcsPath } });
  const data: DriveNodeWriteData = {
    orgId: input.orgId,
    parentId,
    type: 'FILE',
    name: input.name,
    visibility: input.visibility ?? areaVisibility(input.area),
    ownerUserId: input.area === 'PERSONAL' ? input.userId ?? null : null,
    managedBy: input.area === 'DOCUMENTS' ? input.app ?? null : null,
    gcsBucket: input.gcsBucket ?? null,
    gcsPath: input.gcsPath,
    mimeType: input.mime ?? null,
    sizeBytes: input.sizeBytes != null ? BigInt(input.sizeBytes) : null,
    sha256: input.sha256 ?? null,
    entityType: input.entity?.type ?? null,
    entityId: input.entity?.id ?? null,
    entityLabel: input.entity?.label ?? null,
    createdBy: input.createdBy ?? null,
    trashedAt: null,
  };
  const node = existing
    ? await db.driveNode.update({ where: { id: existing.id }, data })
    : await db.driveNode.create({ data });
  return { nodeId: node.id, gcsPath: input.gcsPath };
}

// ---- Mover / renombrar / papelera / borrar ---------------------------------

export async function moveNode(
  db: DriveDb,
  input: { id: string; toParentId?: string; name?: string },
): Promise<void> {
  const data: DriveNodeWriteData = {};
  if (input.toParentId !== undefined) data.parentId = input.toParentId;
  if (input.name !== undefined) data.name = input.name;
  await db.driveNode.update({ where: { id: input.id }, data });
}

/** Envía a la papelera (soft-delete). Un job purga según la retención de Config. */
export async function trashNode(db: DriveDb, id: string, at: Date): Promise<void> {
  await db.driveNode.update({ where: { id }, data: { trashedAt: at } });
}

export async function restoreNode(db: DriveDb, id: string): Promise<void> {
  await db.driveNode.update({ where: { id }, data: { trashedAt: null } });
}

/**
 * Borrado definitivo: quita la fila del catálogo y borra el objeto de GCS.
 * (Para carpetas, el borrado del subárbol lo arrastra el `onDelete: Cascade` de
 * parentId; los objetos de sus ficheros hay que borrarlos por separado — el
 * llamante recorre los hijos FILE.)
 */
export async function deleteFileNode(db: DriveDb, storage: StorageClient, node: DriveNodeRecord): Promise<void> {
  if (node.type === 'FILE' && node.gcsPath) {
    await storage.delete(node.gcsPath, { bucket: node.gcsBucket ?? undefined, orgId: node.orgId });
  }
  // La fila se borra por el llamante (con su Prisma) o por cascade de carpeta.
}
