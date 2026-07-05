import { Storage } from '@google-cloud/storage';
import { createHash } from 'crypto';
import { Agent } from 'node:https';

/**
 * Cloud Run con `vpc-egress=all-traffic`: el NAT cierra sockets TCP ociosos y
 * con keep-alive las llamadas de googleapis fallan con `ERR_STREAM_PREMATURE_CLOSE`
 * ("Premature close"). En GCS esto rompe la **firma V4 sin clave privada** (SA de
 * compute), que llama a `iamcredentials.googleapis.com/...:signBlob` a través del
 * transporter del auth client → "Invalid response body ... signBlob: Premature close".
 *
 * Igual que en auth/consultor, desactivamos keep-alive en ese transporter. Lo
 * inyectamos vía `clientOptions.transporterOptions.agent`, que GoogleAuth propaga
 * al auth client (Compute/etc.) que realiza el signBlob, no sólo a las llamadas a GCS.
 */
const noKeepAliveAgent = new Agent({ keepAlive: false });

/**
 * StorageService compartido — cliente GCS unificado para todas las apps.
 *
 * Reemplaza las copias casi idénticas de `gcs.ts`/`storage.ts` que vivían en
 * cancelaciones, archivo, auth y platform. Es **bucket-agnóstico**: recibe la
 * configuración por factory (no lee `process.env` por su cuenta), así cada app
 * inyecta su bucket y credenciales como ya hace hoy.
 *
 * Contrato de degradación: NO lanza. Si las credenciales no están disponibles
 * (local sin ADC) o GCS falla, los métodos devuelven `{ ok: false, error }`
 * para que el endpoint llamante responda 503 con un mensaje claro.
 *
 * Las funciones de *path* (convenciones `{orgId}/{expedienteId}/...`) son de
 * dominio y se quedan en cada app; aquí solo está el transporte.
 *
 * Local/dev: pasar `apiEndpoint` (fake-gcs-server). NO usar el antiguo
 * `STORAGE_EMULATOR_HOST`: omite el prefijo `/storage/v1` y rompe las descargas
 * en @google-cloud/storage v7.
 */

/** Motivo de un delta de almacenamiento (para el libro mayor de platform). */
export type StorageUsageReason = 'upload' | 'confirm' | 'delete' | 'reconcile' | 'adjust';

export interface StorageUsageDelta {
  orgId: string;
  /** + al subir/confirmar, − al borrar. */
  deltaBytes: number;
  gcsPath: string;
  bucket: string;
  reason: StorageUsageReason;
}

export interface StorageClientConfig {
  /** Bucket por defecto para todas las operaciones. */
  bucket: string;
  /** Project ID (opcional; en Cloud Run lo da el ADC). */
  projectId?: string;
  /** Local/dev: ruta a un keyfile de service account. */
  keyFilename?: string;
  /**
   * Local/dev: endpoint de un emulador GCS (fake-gcs-server). Cuando está
   * presente, el cliente no exige credenciales. Vacío en GCP → SA por defecto.
   */
  apiEndpoint?: string;
  /**
   * Contabilidad de almacenamiento (opcional). Se invoca best-effort tras cada
   * upload server-side, `confirmUpload` (subidas por signed-URL) y delete. La app
   * la cablea normalmente con `createStorageUsageReporter` → POST /internal/storage/record.
   * Si se omite, el cliente NO contabiliza (apps sin facturación de storage).
   */
  onUsageDelta?: (delta: StorageUsageDelta) => Promise<void>;
  /**
   * Resuelve el `orgId` a partir del path (y bucket) del objeto, para atribuir el
   * delta. Devolver `null` = objeto no facturable (p.ej. plantillas compartidas o
   * incidencias) → no se contabiliza. Solo se usa cuando la operación no recibe un
   * `orgId` explícito. Cada app aporta su convención (`{orgId}/…`, `orgs/{orgId}/…`).
   */
  resolveOrgId?: (path: string, bucket: string) => string | null;
}

export interface OpResult {
  ok: boolean;
  error?: string;
}

export interface SignResult extends OpResult {
  url?: string;
}

export interface UploadResult extends OpResult {
  /** `gs://bucket/path` del objeto escrito. */
  gcsUri?: string;
  size?: number;
  sha256?: string;
}

export interface DownloadResult extends OpResult {
  body?: Buffer;
}

export interface SignOptions {
  /** Path absoluto dentro del bucket. */
  path: string;
  action: 'read' | 'write';
  /** Validez en segundos (default 15 min). */
  expiresInSeconds?: number;
  /** Sólo `write`: Content-Type del fichero a subir. */
  contentType?: string;
  /** Sólo `read`: fuerza `Content-Disposition` (`inline` preview / `attachment` descarga). */
  disposition?: 'inline' | 'attachment';
  /** Nombre de fichero sugerido (sólo con `attachment`). */
  filename?: string;
  /** Override del bucket por defecto (p.ej. plantillas en blanco). */
  bucket?: string;
}

export interface UploadOptions {
  path: string;
  buffer: Buffer;
  contentType?: string;
  /** Metadatos GCS extra (p.ej. `cacheControl`). */
  metadata?: Record<string, string>;
  bucket?: string;
  /** Contabilidad: orgId explícito (si se omite, se usa `resolveOrgId`). */
  orgId?: string;
}

export interface ConfirmUploadOptions {
  path: string;
  bucket?: string;
  /** Contabilidad: orgId explícito (si se omite, se usa `resolveOrgId`). */
  orgId?: string;
}

export interface ConfirmUploadResult extends OpResult {
  /** Tamaño real del objeto en GCS (bytes), leído de la metadata. */
  size?: number;
}

export interface VersionInfo {
  /** Generación GCS (identifica la versión del objeto). */
  generation: string;
  size: number;
  /** ISO timestamp de creación de esta generación. */
  updated?: string;
  /** Si la versión está marcada como borrada (noncurrent por borrado). */
  timeDeleted?: string;
  contentType?: string;
}

export interface StorageClient {
  /** ¿Hay almacenamiento configurado? (para degradar con gracia en la UI). */
  enabled(): boolean;
  /** Firma una URL V4 para leer (descarga directa) o escribir (upload directo). */
  getSignedUrl(opts: SignOptions): Promise<SignResult>;
  /** Sube un buffer (flujo server-side; el directo preferido es signed URL). */
  uploadBuffer(opts: UploadOptions): Promise<UploadResult>;
  /**
   * Confirma una subida hecha por signed-URL (navegador→GCS directo): lee el
   * tamaño real del objeto vía `getMetadata` y contabiliza el delta (`reason:'confirm'`).
   * Debe llamarse desde el endpoint de confirmación tras el PUT del cliente.
   */
  confirmUpload(opts: ConfirmUploadOptions): Promise<ConfirmUploadResult>;
  /** Descarga el objeto como Buffer (flujo server-side; preferir signed URL). */
  download(path: string, opts?: { bucket?: string; generation?: string }): Promise<DownloadResult>;
  /** Borra un objeto. Best-effort: false si no se pudo. Contabiliza el delta negativo. */
  delete(path: string, opts?: { bucket?: string; orgId?: string }): Promise<boolean>;
  /** ¿Existe el objeto (versión actual)? */
  exists(path: string, opts?: { bucket?: string }): Promise<boolean>;
  /**
   * Lista las versiones (generaciones) de un objeto, más reciente primero.
   * Requiere Object Versioning activado en el bucket. Devuelve `[]` si no hay.
   */
  listVersions(path: string, opts?: { bucket?: string }): Promise<VersionInfo[]>;
  /**
   * Restaura una versión anterior copiándola sobre la versión actual (que a su
   * vez pasa a ser noncurrent). No destruye historial.
   */
  restoreVersion(path: string, generation: string, opts?: { bucket?: string }): Promise<OpResult>;
}

/**
 * Crea un cliente de almacenamiento. Cliente GCS perezoso y memorizado; si la
 * inicialización falla se recuerda el error y los métodos degradan a
 * `{ ok: false, error }` en vez de lanzar.
 */
export function createStorageClient(config: StorageClientConfig): StorageClient {
  let storage: Storage | null = null;
  let storageError: string | null = null;

  function getStorage(): Storage | null {
    if (storage) return storage;
    if (storageError) return null;
    try {
      if (config.apiEndpoint) {
        storage = new Storage({
          apiEndpoint: config.apiEndpoint,
          projectId: config.projectId || 'dev',
        });
      } else {
        storage = new Storage({
          projectId: config.projectId || undefined,
          keyFilename: config.keyFilename || undefined,
          // Desactiva keep-alive en el transporter del auth client → evita el
          // `Premature close` del signBlob al firmar URLs V4 desde Cloud Run.
          clientOptions: { transporterOptions: { agent: noKeepAliveAgent } },
        });
      }
      return storage;
    } catch (e) {
      storageError = e instanceof Error ? e.message : 'GCS init failed';
      console.warn('[storage] cliente no inicializado:', storageError);
      return null;
    }
  }

  function resolveBucket(override?: string): { name: string } | { error: string } {
    const name = override ?? config.bucket;
    if (!name) return { error: 'GCS bucket no configurado' };
    return { name };
  }

  /**
   * Contabiliza un delta de bytes (best-effort, NUNCA lanza). Resuelve el orgId
   * del `orgId` explícito o de `resolveOrgId`; si no hay atribución (objeto no
   * facturable: plantillas, incidencias) o no hay reporter, no hace nada.
   */
  async function emitUsage(
    reason: StorageUsageReason,
    path: string,
    bucket: string,
    deltaBytes: number,
    explicitOrgId?: string,
  ): Promise<void> {
    if (!config.onUsageDelta || deltaBytes === 0) return;
    const orgId = explicitOrgId ?? config.resolveOrgId?.(path, bucket) ?? null;
    if (!orgId) return;
    try {
      await config.onUsageDelta({ orgId, deltaBytes, gcsPath: path, bucket, reason });
    } catch (e) {
      console.warn('[storage] usage report failed:', e instanceof Error ? e.message : e);
    }
  }

  return {
    enabled() {
      return !!config.bucket && getStorage() !== null;
    },

    async getSignedUrl(opts) {
      const s = getStorage();
      if (!s) return { ok: false, error: storageError ?? 'GCS not configured' };
      const b = resolveBucket(opts.bucket);
      if ('error' in b) return { ok: false, error: b.error };
      try {
        let responseDisposition: string | undefined;
        if (opts.disposition === 'inline') {
          responseDisposition = 'inline';
        } else if (opts.disposition === 'attachment') {
          const safe = (opts.filename ?? '').replace(/["\\]/g, '');
          responseDisposition = safe ? `attachment; filename="${safe}"` : 'attachment';
        }
        const [url] = await s
          .bucket(b.name)
          .file(opts.path)
          .getSignedUrl({
            version: 'v4',
            action: opts.action,
            expires: Date.now() + (opts.expiresInSeconds ?? 15 * 60) * 1000,
            ...(opts.action === 'write'
              ? { contentType: opts.contentType ?? 'application/octet-stream' }
              : {}),
            ...(responseDisposition ? { responseDisposition } : {}),
          });
        return { ok: true, url };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'sign failed' };
      }
    },

    async uploadBuffer(opts) {
      const s = getStorage();
      if (!s) return { ok: false, error: storageError ?? 'GCS not configured' };
      const b = resolveBucket(opts.bucket);
      if ('error' in b) return { ok: false, error: b.error };
      try {
        await s
          .bucket(b.name)
          .file(opts.path)
          .save(opts.buffer, {
            resumable: false,
            contentType: opts.contentType ?? 'application/octet-stream',
            metadata: { cacheControl: 'private, max-age=0', ...(opts.metadata ?? {}) },
          });
        const sha256 = createHash('sha256').update(opts.buffer).digest('hex');
        await emitUsage('upload', opts.path, b.name, opts.buffer.length, opts.orgId);
        return { ok: true, gcsUri: `gs://${b.name}/${opts.path}`, size: opts.buffer.length, sha256 };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'upload failed' };
      }
    },

    async confirmUpload(opts) {
      const s = getStorage();
      if (!s) return { ok: false, error: storageError ?? 'GCS not configured' };
      const b = resolveBucket(opts.bucket);
      if ('error' in b) return { ok: false, error: b.error };
      try {
        const [meta] = await s.bucket(b.name).file(opts.path).getMetadata();
        const size = Number(meta.size ?? 0);
        await emitUsage('confirm', opts.path, b.name, size, opts.orgId);
        return { ok: true, size };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'confirm failed' };
      }
    },

    async download(path, opts) {
      const s = getStorage();
      if (!s) return { ok: false, error: storageError ?? 'GCS not configured' };
      const b = resolveBucket(opts?.bucket);
      if ('error' in b) return { ok: false, error: b.error };
      try {
        const file = opts?.generation
          ? s.bucket(b.name).file(path, { generation: opts.generation })
          : s.bucket(b.name).file(path);
        const [body] = await file.download();
        return { ok: true, body };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'download failed' };
      }
    },

    async delete(path, opts) {
      const s = getStorage();
      const b = resolveBucket(opts?.bucket);
      if (!s || 'error' in b) return false;
      try {
        // Tamaño ANTES de borrar (para el delta negativo). Si el objeto ya no
        // existe, size=0 y no se contabiliza nada.
        let size = 0;
        if (config.onUsageDelta) {
          try {
            const [meta] = await s.bucket(b.name).file(path).getMetadata();
            size = Number(meta.size ?? 0);
          } catch {
            size = 0;
          }
        }
        await s.bucket(b.name).file(path).delete({ ignoreNotFound: true });
        if (size > 0) await emitUsage('delete', path, b.name, -size, opts?.orgId);
        return true;
      } catch (e) {
        console.warn('[storage] delete failed:', e instanceof Error ? e.message : e);
        return false;
      }
    },

    async exists(path, opts) {
      const s = getStorage();
      const b = resolveBucket(opts?.bucket);
      if (!s || 'error' in b) return false;
      try {
        const [ok] = await s.bucket(b.name).file(path).exists();
        return ok;
      } catch {
        return false;
      }
    },

    async listVersions(path, opts) {
      const s = getStorage();
      const b = resolveBucket(opts?.bucket);
      if (!s || 'error' in b) return [];
      try {
        const [files] = await s.bucket(b.name).getFiles({ prefix: path, versions: true });
        return files
          .filter((f) => f.name === path)
          .map((f) => ({
            generation: String(f.metadata.generation ?? ''),
            size: Number(f.metadata.size ?? 0),
            updated: f.metadata.updated as string | undefined,
            timeDeleted: f.metadata.timeDeleted as string | undefined,
            contentType: f.metadata.contentType as string | undefined,
          }))
          .sort((a, b2) => Number(b2.generation) - Number(a.generation));
      } catch (e) {
        console.warn('[storage] listVersions failed:', e instanceof Error ? e.message : e);
        return [];
      }
    },

    async restoreVersion(path, generation, opts) {
      const s = getStorage();
      if (!s) return { ok: false, error: storageError ?? 'GCS not configured' };
      const b = resolveBucket(opts?.bucket);
      if ('error' in b) return { ok: false, error: b.error };
      try {
        const bucket = s.bucket(b.name);
        // Copiar la generación pedida sobre la versión viva: la actual pasa a
        // noncurrent (si el bucket tiene versioning), sin destruir historial.
        await bucket.file(path, { generation }).copy(bucket.file(path));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'restore failed' };
      }
    },
  };
}

export interface StorageUsageReporterConfig {
  /** Base URL interna de mycolegal-platform. */
  platformUrl: string;
  /** X-Service-Key (APPS_REGISTER_SECRET). */
  serviceKey: string;
  /** appSlug de quien consume (atribución por app en el libro mayor). */
  app: string;
}

/**
 * @deprecated NO USAR. El endpoint `POST /internal/storage/record` fue RETIRADO:
 * la contabilidad de almacenamiento pasó al catálogo `DriveNode` (`getUsage` en
 * platform = Σ `DriveNode.sizeBytes`; ver PLAN_TECNICO_UNIDAD_ARCHIVO §9). Las
 * subidas se contabilizan al escribir el nodo del catálogo, no por delta. Se
 * conserva la firma solo para no romper builds hasta el próximo bump de sharedlib
 * que la elimine; cablearla hoy solo genera POSTs 404.
 *
 * Construye el callback `onUsageDelta` que reportaba los deltas a platform.
 */
export function createStorageUsageReporter(
  config: StorageUsageReporterConfig,
): (delta: StorageUsageDelta) => Promise<void> {
  const base = config.platformUrl.replace(/\/$/, '');
  return async (delta) => {
    const res = await fetch(`${base}/internal/storage/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Key': config.serviceKey },
      body: JSON.stringify({ ...delta, app: config.app }),
    });
    if (!res.ok) throw new Error(`storage/record → ${res.status}`);
  };
}
