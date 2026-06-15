// @mycolegal-app/sharedlib/permission-resolver — resolución resiliente de los
// permisos centralizados que las apps de usuario final piden al servicio auth
// en CADA request (`GET {AUTH_INTERNAL_URL}/auth/me/permissions/<appSlug>`).
//
// Problema que resuelve (incidencia #113):
//   Cada deploy reinicia el servicio auth. Durante esa ventana el fetch falla y
//   el `getAuthContext` de cada app degradaba `permissions` a `[]`, cayendo al
//   fallback por rol local. Eso DENIEGA (403) a los usuarios cuyo acceso viene
//   de un grant POR-USUARIO (no del rol) — p.ej. un TRAMITADOR con
//   `protocolos:read` —, dejando la pantalla en blanco hasta que auth se
//   estabiliza. El fallback por rol local no puede reproducir grants por-usuario.
//
// Política:
//   - auth responde (2xx, incluso con set vacío) → resultado en vivo + se cachea
//     el último set "bueno" (con algo que conceder) por (usuario, org, app).
//   - auth responde 4xx (sin asignación) → set vacío en vivo (definitivo); NO
//     pisa la cache buena previa.
//   - auth inalcanzable (5xx / red / timeout) → se reusa el último set bueno
//     reciente (TTL) en vez de vaciar. Si no hay cache → null (fallback por rol,
//     comportamiento histórico).
//
// Módulo puro (sólo `fetch` global de Node/Next). La cache es por proceso de la
// app (cada app es su propio proceso); module-level Map basta y es correcto.

export interface CentralizedPermissions {
  appRoleKey: string | null;
  permissions: string[];
}

/**
 * Telemetría de Fase 0 (migración a roles centralizados): info emitida cuando la
 * resolución central NO puede conceder y la app caerá a su fallback por rol local
 * (`ROLE_PERMISSIONS`). El objetivo es medir en prod si esa rama llega a usarse
 * — el baseline dice que ~0 — y, sobre todo, cazar el caso `auth_unreachable_no_cache`
 * (cold-start de proceso durante un deploy de auth), que es el único papel que el
 * fallback sigue cubriendo de verdad.
 */
export interface PermissionFallbackInfo {
  appSlug: string;
  userId: string;
  orgId: string;
  reason:
    | 'auth_unreachable_no_cache' // auth caído/red + sin cache → resiliencia (el que importa)
    | 'no_central_grant'          // auth responde pero el usuario no tiene grant en la app
    | 'central_role_empty';       // grant con rol cuyo set de permisos es vacío
  appRoleKey: string | null;
  ts: number;
}

export interface ResolvePermissionsOpts {
  /** Base interna del servicio auth (p.ej. `AUTH_INTERNAL_URL`). */
  authInternalUrl: string;
  /** Slug de la app (`notaria`, `legifirma`, …) — segmento del endpoint. */
  appSlug: string;
  /** JWT del usuario (valor de la cookie de sesión). */
  token: string;
  /** Id del usuario en auth (para la clave de cache). */
  userId: string;
  /** Org activa (para la clave de cache). */
  orgId: string;
  /** Inyectable en tests; por defecto `Date.now()`. */
  now?: number;
  /** Hook de telemetría Fase 0. Default: `console.warn` estructurado y grep-able
   *  (`[perm-fallback] {...}`). Inyectable para tests o para enrutar a un logger
   *  propio de la app. Se invoca SOLO cuando la app va a caer al fallback local. */
  onFallback?: (info: PermissionFallbackInfo) => void;
}

/** 15 min: suficiente para cubrir la ventana de un deploy sin servir permisos
 *  obsoletos demasiado tiempo (sólo se sirven mientras auth está caído). */
export const PERM_CACHE_TTL_MS = 15 * 60 * 1000;

const cache = new Map<string, CentralizedPermissions & { ts: number }>();

// Throttle de telemetría: una línea por (usuario, org, app, motivo) cada 60 s,
// para no inundar el log durante un outage prolongado de auth (cada request en
// frío caería al fallback). Estado por proceso, igual que `cache`.
const FALLBACK_LOG_THROTTLE_MS = 60 * 1000;
const lastFallbackLog = new Map<string, number>();

function defaultOnFallback(info: PermissionFallbackInfo): void {
  // Línea grep-able en Cloud Logging (filtrar por `[perm-fallback]`).
  console.warn(`[perm-fallback] ${JSON.stringify(info)}`);
}

function reportFallback(
  opts: ResolvePermissionsOpts,
  reason: PermissionFallbackInfo['reason'],
  appRoleKey: string | null,
  now: number,
): void {
  const key = `${opts.userId}:${opts.orgId}:${opts.appSlug}:${reason}`;
  const last = lastFallbackLog.get(key);
  if (last !== undefined && now - last < FALLBACK_LOG_THROTTLE_MS) return;
  lastFallbackLog.set(key, now);
  (opts.onFallback ?? defaultOnFallback)({
    appSlug: opts.appSlug,
    userId: opts.userId,
    orgId: opts.orgId,
    reason,
    appRoleKey,
    ts: now,
  });
}

type Fetched =
  | ({ reachable: true } & CentralizedPermissions)
  | { reachable: false };

/** Timeout por intento. Generoso a propósito: Cloud Run encola el request contra
 *  un auth dormido (min-instances 0) y lo sirve tras su cold-start (1-3 s); no
 *  queremos abortar ese caso legítimo, solo cortar cuelgues patológicos. */
const FETCH_TIMEOUT_MS = 8000;
/** Reintentos extra ante fallo transitorio (3 intentos en total). Cubren la
 *  ventana de segundos del switch de revisión en un deploy de auth. */
const FETCH_BACKOFF_MS = [200, 500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(
  authInternalUrl: string,
  appSlug: string,
  token: string,
): Promise<Fetched> {
  // Reintenta ante fallo TRANSITORIO (5xx / red / timeout) con backoff corto,
  // para no caer al fallback por un blip de deploy de auth. Un 4xx (sin
  // asignación) es respuesta DEFINITIVA → no se reintenta.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${authInternalUrl}/auth/me/permissions/${appSlug}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      // 5xx = auth caído/reiniciándose → transitorio, reintentable.
      if (res.status >= 500) {
        if (attempt < FETCH_BACKOFF_MS.length) {
          await sleep(FETCH_BACKOFF_MS[attempt]);
          continue;
        }
        return { reachable: false };
      }
      // 4xx = definitivo (sin asignación) → alcanzable con set vacío.
      if (!res.ok) return { reachable: true, appRoleKey: null, permissions: [] };
      const data = await res.json();
      return {
        reachable: true,
        appRoleKey: data?.data?.appRoleKey || null,
        permissions: data?.data?.permissions || [],
      };
    } catch {
      // red / timeout / abort → transitorio, reintentable.
      if (attempt < FETCH_BACKOFF_MS.length) {
        await sleep(FETCH_BACKOFF_MS[attempt]);
        continue;
      }
      return { reachable: false };
    }
  }
}

/**
 * Devuelve los permisos centralizados del usuario en la app, resistente a
 * caídas transitorias de auth. `null` ⇒ ni en vivo ni en cache (el caller debe
 * caer a su fallback por rol local, como antes).
 */
export async function resolveCentralizedPermissions(
  opts: ResolvePermissionsOpts,
): Promise<CentralizedPermissions | null> {
  const { authInternalUrl, appSlug, token, userId, orgId } = opts;
  const now = opts.now ?? Date.now();
  const cacheKey = `${userId}:${orgId}:${appSlug}`;

  const fetched = await fetchOnce(authInternalUrl, appSlug, token);

  if (fetched.reachable) {
    const value: CentralizedPermissions = {
      appRoleKey: fetched.appRoleKey,
      permissions: fetched.permissions,
    };
    // Sólo cacheamos sets con contenido: un set vacío no debe pisar uno bueno.
    if (value.permissions.length > 0 || value.appRoleKey) {
      cache.set(cacheKey, { ...value, ts: now });
    }
    // Telemetría Fase 0: alcanzable pero sin permisos efectivos → la app usará
    // su fallback por rol local (caso "cobertura").
    if (value.permissions.length === 0) {
      reportFallback(
        opts,
        value.appRoleKey ? 'central_role_empty' : 'no_central_grant',
        value.appRoleKey,
        now,
      );
    }
    return value;
  }

  const cached = cache.get(cacheKey);
  if (cached && now - cached.ts < PERM_CACHE_TTL_MS) {
    return { appRoleKey: cached.appRoleKey, permissions: cached.permissions };
  }
  if (cached) cache.delete(cacheKey);
  // Telemetría Fase 0: auth inalcanzable y sin cache → fallback por rol local.
  // Es el caso "resiliencia/cold-start", el único papel que el fallback aún
  // cubre de verdad y el que decidirá cómo reemplazarlo en Fase 1.
  reportFallback(opts, 'auth_unreachable_no_cache', null, now);
  return null;
}
